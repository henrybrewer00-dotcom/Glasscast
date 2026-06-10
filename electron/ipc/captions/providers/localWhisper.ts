import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app } from "electron";
import type { CaptionCuePayload } from "../../types";
import { parseSrtCues, parseWhisperJsonCues, shouldRetryWhisperWithoutJson } from "../parser";
import {
	DEFAULT_WHISPER_MODEL_ID,
	getWhisperModelPath,
	isWhisperModelId,
	WHISPER_MODELS,
} from "../models";
import { ensureReadableFile, resolveWhisperExecutablePath } from "../whisperRuntime";
import type { CaptionProvider, CaptionProviderModel, TranscribeOptions } from "./types";

const execFileAsync = promisify(execFile);

function listLocalModels(): CaptionProviderModel[] {
	return Object.values(WHISPER_MODELS).map((model) => ({
		id: model.id,
		label: model.label,
	}));
}

/**
 * Resolve the ggml model path for a local transcription request. An explicit
 * `whisperModelPath` override (user-picked file) wins; otherwise the registry
 * model id resolves to its on-disk path.
 */
function resolveModelPath(options: TranscribeOptions): string {
	if (options.whisperModelPath && options.whisperModelPath.trim()) {
		return path.resolve(options.whisperModelPath.trim());
	}

	const modelId = isWhisperModelId(options.modelId)
		? options.modelId
		: DEFAULT_WHISPER_MODEL_ID;
	return getWhisperModelPath(modelId);
}

/**
 * Run whisper.cpp over an already-extracted 16kHz mono WAV file and return cues.
 * This is the logic previously inline in generate.ts, now isolated behind the
 * CaptionProvider seam.
 */
export async function transcribeWithLocalWhisper(
	wavPath: string,
	options: TranscribeOptions,
): Promise<CaptionCuePayload[]> {
	const whisperExecutablePath = await resolveWhisperExecutablePath(
		options.whisperExecutablePath ?? undefined,
	);
	const whisperModelPath = resolveModelPath(options);
	await ensureReadableFile(whisperExecutablePath, { executable: true });
	await ensureReadableFile(whisperModelPath);

	const outputBase = path.join(
		app.getPath("temp"),
		`recordly-captions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-whisper`,
	);
	const srtPath = `${outputBase}.srt`;
	const jsonPath = `${outputBase}.json`;

	const language =
		options.language && options.language.trim() ? options.language.trim() : "auto";
	// Leave headroom for the UI: cap whisper's worker threads to half the cores
	// and run the process at low scheduling priority, otherwise transcription
	// saturates the machine and the app feels frozen.
	const threadCount = Math.max(2, Math.floor(os.cpus().length / 2));
	const whisperBaseArgs = [
		"-m",
		whisperModelPath,
		"-f",
		wavPath,
		"-osrt",
		"-of",
		outputBase,
		"-l",
		language,
		"-t",
		String(threadCount),
		"-np",
	];
	const useNice = process.platform === "darwin" || process.platform === "linux";
	const runWhisper = (args: string[]) =>
		execFileAsync(
			useNice ? "/usr/bin/nice" : whisperExecutablePath,
			useNice ? ["-n", "15", whisperExecutablePath, ...args] : args,
			{
				timeout: 30 * 60 * 1000,
				maxBuffer: 20 * 1024 * 1024,
			},
		);

	try {
		let jsonEnabled = true;
		try {
			await runWhisper([...whisperBaseArgs, "-ojf"]);
		} catch (error) {
			if (!shouldRetryWhisperWithoutJson(error)) {
				throw error;
			}

			jsonEnabled = false;
			console.warn(
				"[auto-captions] Whisper runtime does not support JSON full output, retrying with SRT only:",
				error,
			);
			await runWhisper(whisperBaseArgs);
		}

		const timedCues = jsonEnabled
			? parseWhisperJsonCues(await fs.readFile(jsonPath, "utf-8"))
			: [];
		const cues =
			timedCues.length > 0 ? timedCues : parseSrtCues(await fs.readFile(srtPath, "utf-8"));
		if (cues.length === 0) {
			throw new Error("Whisper completed, but no caption cues were produced.");
		}

		return cues;
	} finally {
		await Promise.allSettled([
			fs.rm(srtPath, { force: true }),
			fs.rm(jsonPath, { force: true }),
		]);
	}
}

export const localWhisperProvider: CaptionProvider = {
	id: "local",
	label: "Local Whisper",
	kind: "local",
	listModels: listLocalModels,
	transcribe: transcribeWithLocalWhisper,
};
