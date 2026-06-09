import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { normalizeVideoSourcePath } from "../utils";
import { getCaptionProvider, DEFAULT_CAPTION_PROVIDER_ID } from "./providers";
import { extractCaptionAudioSource } from "./whisperRuntime";

// Re-export the shared runtime helpers so existing importers keep working.
export {
	ensureReadableFile,
	isExecutableFile,
	resolveWhisperExecutablePath,
	resolveCaptionAudioCandidates,
	extractCaptionAudioSource,
} from "./whisperRuntime";

export interface GenerateAutoCaptionsOptions {
	videoPath: string;
	/** Provider seam id; defaults to local whisper. */
	provider?: string;
	/** Provider-specific model id (whisper registry id or cloud model name). */
	modelId?: string;
	/** Cloud API key, fetched main-side. Never originates from the renderer. */
	apiKey?: string;
	/** Legacy/local: user-picked whisper executable. */
	whisperExecutablePath?: string | null;
	/** Legacy/local: explicit model path override. */
	whisperModelPath?: string | null;
	language?: string;
}

/**
 * Dispatcher: extracts a shared 16kHz mono WAV from the recording, then delegates
 * transcription to the selected CaptionProvider (local whisper.cpp or a cloud
 * provider). The WAV is always cleaned up afterwards.
 */
export async function generateAutoCaptionsFromVideo(options: GenerateAutoCaptionsOptions) {
	const ffmpegPath = getFfmpegBinaryPath();
	const normalizedVideoPath = normalizeVideoSourcePath(options.videoPath);
	if (!normalizedVideoPath) {
		throw new Error("Missing source video path.");
	}

	const provider = getCaptionProvider(options.provider ?? DEFAULT_CAPTION_PROVIDER_ID);

	const tempBase = path.join(
		app.getPath("temp"),
		`recordly-captions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	const wavPath = `${tempBase}.wav`;

	try {
		const audioSource = await extractCaptionAudioSource({
			videoPath: normalizedVideoPath,
			ffmpegPath,
			wavPath,
		});

		const cues = await provider.transcribe(wavPath, {
			language: options.language,
			modelId: options.modelId ?? "small",
			apiKey: options.apiKey,
			whisperExecutablePath: options.whisperExecutablePath,
			whisperModelPath: options.whisperModelPath,
		});

		if (cues.length === 0) {
			throw new Error("Transcription completed, but no caption cues were produced.");
		}

		return {
			cues,
			audioSourceLabel: audioSource.label,
		};
	} finally {
		await fs.rm(wavPath, { force: true }).catch(() => undefined);
	}
}
