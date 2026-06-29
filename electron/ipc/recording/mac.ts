import { execFile } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { BrowserWindow } from "electron";
import {
	persistPendingCursorTelemetry,
	snapshotCursorTelemetryForPersistence,
} from "../cursor/telemetry";
import { persistWebcamLayout } from "../webcam/layout";
import {
	type InlineAudioProbe,
	decideMacAudioMux,
	parseInlineAudioProbeOutput,
} from "./audioMuxDecision";
import { getFfprobeBinaryPath } from "../ffmpeg/binary";
import {
	lastNativeCaptureDiagnostics,
	nativeCaptureMicrophonePath,
	nativeCaptureOutputBuffer,
	nativeCaptureStopRequested,
	nativeCaptureSystemAudioPath,
	nativeCaptureTargetPath,
	nativeScreenRecordingActive,
	selectedSource,
	setCurrentProjectPath,
	setCurrentVideoPath,
	setNativeCaptureMicrophonePath,
	setNativeCaptureProcess,
	setNativeCaptureStopRequested,
	setNativeCaptureSystemAudioPath,
	setNativeCaptureTargetPath,
	setNativeScreenRecordingActive,
} from "../state";
import { isAutoRecordingPath, moveFileWithOverwrite } from "../utils";
import {
	getFileSizeIfPresent,
	recordNativeCaptureDiagnostics,
	validateRecordedVideo,
} from "./diagnostics";
import { emitRecordingInterrupted } from "./events";
import { getFinalMacCompanionAudioPath } from "./macCompanionAudio";
import { pruneAutoRecordings } from "./prune";

export function waitForNativeCaptureStart(process: ChildProcessWithoutNullStreams) {
	return new Promise<void>((resolve, reject) => {
		// A helper that never signals "Recording started" is wedged inside
		// SCStream.startCapture(); if we leave it alive it keeps holding a
		// ScreenCaptureKit session and blocks every subsequent recording attempt
		// (the jam compounds with each retry). Always kill it on timeout/error.
		const killHelper = () => {
			try {
				process.kill("SIGKILL");
			} catch {
				// already gone
			}
		};

		const timer = setTimeout(() => {
			cleanup();
			killHelper();
			const helperOutput = nativeCaptureOutputBuffer.trim();
			console.error("[mac-capture] start timed out. Helper output:\n", helperOutput);
			reject(
				new Error(
					`Timed out waiting for ScreenCaptureKit recorder to start${
						helperOutput ? ` — helper output: ${helperOutput}` : " (helper produced no output)"
					}`,
				),
			);
		}, 12000);

		let stdoutBuffer = "";
		const onStdout = (chunk: Buffer) => {
			const text = chunk.toString();
			console.error("[mac-capture stdout]", text.trimEnd());
			stdoutBuffer += text;
			if (stdoutBuffer.includes("Recording started")) {
				cleanup();
				resolve();
			}
		};

		const onError = (error: Error) => {
			cleanup();
			killHelper();
			reject(error);
		};

		const onExit = (code: number | null) => {
			cleanup();
			reject(
				new Error(
					nativeCaptureOutputBuffer.trim() ||
						`Native capture helper exited before recording started (code ${code ?? "unknown"})`,
				),
			);
		};

		const cleanup = () => {
			clearTimeout(timer);
			process.stdout.off("data", onStdout);
			process.off("error", onError);
			process.off("exit", onExit);
		};

		process.stdout.on("data", onStdout);
		process.once("error", onError);
		process.once("exit", onExit);
	});
}

export function waitForNativeCaptureStop(process: ChildProcessWithoutNullStreams) {
	return new Promise<string>((resolve, reject) => {
		const onClose = (code: number | null) => {
			cleanup();
			const match = nativeCaptureOutputBuffer.match(/Recording stopped\. Output path: (.+)/);
			if (match?.[1]) {
				resolve(match[1].trim());
				return;
			}
			if (code === 0 && nativeCaptureTargetPath) {
				resolve(nativeCaptureTargetPath);
				return;
			}
			reject(
				new Error(
					nativeCaptureOutputBuffer.trim() ||
						`Native capture helper exited with code ${code ?? "unknown"}`,
				),
			);
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const cleanup = () => {
			process.off("close", onClose);
			process.off("error", onError);
		};

		process.once("close", onClose);
		process.once("error", onError);
	});
}

const execFileAsync = promisify(execFile);

/**
 * Probe the recorded video container for an inline audio stream. The Swift
 * ScreenCaptureKit helper can write the microphone track inline; when it does,
 * folding the sidecar mic back in causes the duplicated-audio / echo bug
 * (#628) and the ~20s mic dropouts reported in #636/#602/#642. ffprobe is the
 * explicit source of truth.
 *
 * On any probe failure we conservatively report `hasInlineAudio: false` so the
 * sidecar mic is preserved — losing a mic track is worse than a benign extra
 * copy, and the decision layer logs the fallback.
 */
export async function probeInlineAudioPresence(videoPath: string): Promise<InlineAudioProbe> {
	let ffprobePath: string;
	try {
		ffprobePath = getFfprobeBinaryPath();
	} catch (err) {
		console.warn(
			"[mac-mux] ffprobe unavailable; assuming no inline audio (will keep sidecar mic):",
			err,
		);
		return { hasInlineAudio: false, inlineAudioCodec: null };
	}

	try {
		const { stdout } = await execFileAsync(
			ffprobePath,
			[
				"-v",
				"error",
				"-select_streams",
				"a",
				"-show_entries",
				"stream=codec_type,codec_name",
				"-of",
				"default=noprint_wrappers=0",
				videoPath,
			],
			{ timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
		);
		return parseInlineAudioProbeOutput(stdout);
	} catch (err) {
		console.warn(
			"[mac-mux] Inline audio probe failed; assuming no inline audio (will keep sidecar mic):",
			err,
		);
		return { hasInlineAudio: false, inlineAudioCodec: null };
	}
}

export async function muxNativeMacRecordingWithAudio(
	videoPath: string,
	systemAudioPath?: string | null,
	microphonePath?: string | null,
) {
	// The Swift helper writes inline audio while this path keeps tracks separate
	// for the editor. The source of truth for the mic is explicit: probe the
	// recorded video, and only keep the sidecar mic when there is no inline
	// audio — never add the same mic twice (fixes echo/dup, #628/#636/#602/#642).
	const probe = await probeInlineAudioPresence(videoPath);
	const decision = decideMacAudioMux({
		probe,
		systemAudioPath,
		microphonePath,
	});

	console.log("[mac-mux] Audio mux decision:", {
		hasInlineAudio: probe.hasInlineAudio,
		inlineAudioCodec: probe.inlineAudioCodec ?? null,
		muxMicrophone: decision.muxMicrophone,
		keepSystemAudio: decision.keepSystemAudio,
		skipMicReason: decision.skipMicReason,
	});

	if (decision.keepSystemAudio && systemAudioPath) {
		const finalSystemPath = getFinalMacCompanionAudioPath(videoPath, systemAudioPath, "system");
		try {
			const stat = await fs.stat(systemAudioPath);
			if (stat.size > 0 && systemAudioPath !== finalSystemPath) {
				await moveFileWithOverwrite(systemAudioPath, finalSystemPath);
			}
		} catch (err) {
			console.error(`[mac-mux] Failed to handle system audio:`, err);
		}
	}

	if (decision.muxMicrophone && microphonePath) {
		const finalMicPath = getFinalMacCompanionAudioPath(videoPath, microphonePath, "mic");
		try {
			const stat = await fs.stat(microphonePath);
			if (stat.size > 0 && microphonePath !== finalMicPath) {
				await moveFileWithOverwrite(microphonePath, finalMicPath);
			}
		} catch (err) {
			console.error(`[mac-mux] Failed to handle mic audio:`, err);
		}
	} else if (microphonePath && decision.skipMicReason === "inline-audio-present") {
		// Inline audio already covers the mic; drop the redundant sidecar so the
		// editor never picks it up and double-plays it.
		const finalMicPath = getFinalMacCompanionAudioPath(videoPath, microphonePath, "mic");
		await fs.rm(microphonePath, { force: true }).catch(() => undefined);
		if (microphonePath !== finalMicPath) {
			await fs.rm(finalMicPath, { force: true }).catch(() => undefined);
		}
	}
}

export function attachNativeCaptureLifecycle(process: ChildProcessWithoutNullStreams) {
	process.once("close", () => {
		const wasActive = nativeScreenRecordingActive;
		setNativeCaptureProcess(null);

		if (!wasActive || nativeCaptureStopRequested) {
			return;
		}

		setNativeScreenRecordingActive(false);
		console.log("[mac-finalize] Optimization active: skipping safety-net muxing.");
		setNativeCaptureTargetPath(null);
		setNativeCaptureStopRequested(false);
		setNativeCaptureSystemAudioPath(null);
		setNativeCaptureMicrophonePath(null);

		const sourceName = selectedSource?.name ?? "Screen";
		BrowserWindow.getAllWindows().forEach((window) => {
			if (!window.isDestroyed()) {
				window.webContents.send("recording-state-changed", {
					recording: false,
					sourceName,
				});
			}
		});

		const reason = nativeCaptureOutputBuffer.includes("WINDOW_UNAVAILABLE")
			? "window-unavailable"
			: "capture-stopped";
		const message =
			reason === "window-unavailable"
				? "The selected window is no longer capturable. Please reselect a window."
				: "Recording stopped unexpectedly.";

		emitRecordingInterrupted(reason, message);
	});
}

export async function finalizeStoredVideo(videoPath: string) {
	console.log("[finalize] Optimization active: skipping safety-net muxing.");

	let validation: { fileSizeBytes: number; durationSeconds: number | null };
	try {
		validation = await validateRecordedVideo(videoPath);
	} catch (error) {
		if (
			lastNativeCaptureDiagnostics?.backend === "mac-screencapturekit" ||
			lastNativeCaptureDiagnostics?.backend === "windows-wgc"
		) {
			recordNativeCaptureDiagnostics({
				backend: lastNativeCaptureDiagnostics.backend,
				phase: lastNativeCaptureDiagnostics.phase === "mux" ? "mux" : "stop",
				sourceId: lastNativeCaptureDiagnostics.sourceId ?? null,
				sourceType: lastNativeCaptureDiagnostics.sourceType ?? "unknown",
				displayId: lastNativeCaptureDiagnostics.displayId ?? null,
				displayBounds: lastNativeCaptureDiagnostics.displayBounds ?? null,
				windowHandle: lastNativeCaptureDiagnostics.windowHandle ?? null,
				helperPath: lastNativeCaptureDiagnostics.helperPath ?? null,
				outputPath: videoPath,
				systemAudioPath: lastNativeCaptureDiagnostics.systemAudioPath ?? null,
				microphonePath: lastNativeCaptureDiagnostics.microphonePath ?? null,
				osRelease: lastNativeCaptureDiagnostics.osRelease,
				supported: lastNativeCaptureDiagnostics.supported,
				helperExists: lastNativeCaptureDiagnostics.helperExists,
				processOutput: lastNativeCaptureDiagnostics.processOutput,
				fileSizeBytes: await getFileSizeIfPresent(videoPath),
				error: error instanceof Error ? error.message : String(error),
			});
		}
		throw error;
	}

	snapshotCursorTelemetryForPersistence();
	setCurrentVideoPath(videoPath);
	setCurrentProjectPath(null);
	try {
		await persistPendingCursorTelemetry(videoPath);
	} catch (error) {
		console.warn("[mac-stop] Failed to persist cursor telemetry:", error);
	}
	try {
		await persistWebcamLayout(videoPath);
	} catch (error) {
		console.warn("[mac-stop] Failed to persist webcam layout:", error);
	}
	if (isAutoRecordingPath(videoPath)) {
		await pruneAutoRecordings([videoPath]);
	}

	if (
		lastNativeCaptureDiagnostics?.backend === "mac-screencapturekit" ||
		lastNativeCaptureDiagnostics?.backend === "windows-wgc"
	) {
		recordNativeCaptureDiagnostics({
			backend: lastNativeCaptureDiagnostics.backend,
			phase: lastNativeCaptureDiagnostics.phase === "mux" ? "mux" : "stop",
			sourceId: lastNativeCaptureDiagnostics.sourceId ?? null,
			sourceType: lastNativeCaptureDiagnostics.sourceType ?? "unknown",
			displayId: lastNativeCaptureDiagnostics.displayId ?? null,
			displayBounds: lastNativeCaptureDiagnostics.displayBounds ?? null,
			windowHandle: lastNativeCaptureDiagnostics.windowHandle ?? null,
			helperPath: lastNativeCaptureDiagnostics.helperPath ?? null,
			outputPath: videoPath,
			systemAudioPath: lastNativeCaptureDiagnostics.systemAudioPath ?? null,
			microphonePath: lastNativeCaptureDiagnostics.microphonePath ?? null,
			osRelease: lastNativeCaptureDiagnostics.osRelease,
			supported: lastNativeCaptureDiagnostics.supported,
			helperExists: lastNativeCaptureDiagnostics.helperExists,
			processOutput: lastNativeCaptureDiagnostics.processOutput,
			fileSizeBytes: validation.fileSizeBytes,
		});
	}

	return {
		success: true,
		path: videoPath,
		message:
			validation.durationSeconds !== null
				? `Video stored successfully (${validation.fileSizeBytes} bytes, ${validation.durationSeconds.toFixed(2)}s)`
				: `Video stored successfully`,
	};
}

export async function recoverNativeMacCaptureOutput() {
	const macDiagnostics =
		lastNativeCaptureDiagnostics?.backend === "mac-screencapturekit"
			? lastNativeCaptureDiagnostics
			: null;
	const diagnosticsPath = macDiagnostics?.outputPath ?? null;
	const candidatePath = nativeCaptureTargetPath ?? diagnosticsPath;
	const systemAudioPath = nativeCaptureSystemAudioPath ?? macDiagnostics?.systemAudioPath ?? null;
	const microphonePath = nativeCaptureMicrophonePath ?? macDiagnostics?.microphonePath ?? null;

	if (!candidatePath) {
		return null;
	}

	try {
		if (systemAudioPath || microphonePath) {
			try {
				await muxNativeMacRecordingWithAudio(
					candidatePath,
					systemAudioPath,
					microphonePath,
				);
			} catch (muxError) {
				console.warn("Failed to mux audio during recovery:", muxError);
			}
		}

		return await finalizeStoredVideo(candidatePath);
	} catch (error) {
		recordNativeCaptureDiagnostics({
			backend: "mac-screencapturekit",
			phase: "stop",
			outputPath: candidatePath,
			systemAudioPath,
			microphonePath,
			processOutput: nativeCaptureOutputBuffer.trim() || undefined,
			fileSizeBytes: await getFileSizeIfPresent(candidatePath),
			error: String(error),
		});
		return null;
	}
}
