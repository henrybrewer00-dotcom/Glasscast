import fs from "node:fs/promises";
import path from "node:path";
import type { CaptionCuePayload } from "../../types";
import {
	mapVerboseTranscriptionToCues,
	type VerboseTranscriptionResponse,
} from "./cloudMapping";
import type { CaptionProvider, CaptionProviderModel, TranscribeOptions } from "./types";

const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";

const OPENAI_MODELS: CaptionProviderModel[] = [
	{ id: "whisper-1", label: "Whisper v2 (whisper-1)" },
	{ id: "gpt-4o-transcribe", label: "GPT-4o Transcribe" },
	{ id: "gpt-4o-mini-transcribe", label: "GPT-4o Mini Transcribe" },
];

const DEFAULT_OPENAI_MODEL = "whisper-1";

function resolveOpenAiModel(modelId: string): string {
	const match = OPENAI_MODELS.find((model) => model.id === modelId);
	return match ? match.id : DEFAULT_OPENAI_MODEL;
}

/**
 * Build the multipart body for an OpenAI transcription request. The gpt-4o
 * transcribe models do not support `verbose_json`; they only return segment-less
 * JSON, so we request `verbose_json` only for whisper-1 and gracefully fall back.
 */
function buildTranscriptionForm(
	wavBytes: ArrayBuffer,
	wavName: string,
	model: string,
	language?: string,
): FormData {
	const form = new FormData();
	const blob = new Blob([wavBytes], { type: "audio/wav" });
	form.append("file", blob, wavName);
	form.append("model", model);

	const supportsVerbose = model === "whisper-1";
	if (supportsVerbose) {
		form.append("response_format", "verbose_json");
		form.append("timestamp_granularities[]", "segment");
		form.append("timestamp_granularities[]", "word");
	} else {
		form.append("response_format", "json");
	}

	if (language && language.trim() && language.trim().toLowerCase() !== "auto") {
		form.append("language", language.trim());
	}

	return form;
}

export async function transcribeWithOpenAi(
	wavPath: string,
	options: TranscribeOptions,
): Promise<CaptionCuePayload[]> {
	const apiKey = options.apiKey?.trim();
	if (!apiKey) {
		throw new Error("An OpenAI API key is required for cloud captions.");
	}

	const model = resolveOpenAiModel(options.modelId);
	const wavBuffer = await fs.readFile(wavPath);
	const wavBytes = wavBuffer.buffer.slice(
		wavBuffer.byteOffset,
		wavBuffer.byteOffset + wavBuffer.byteLength,
	) as ArrayBuffer;
	const form = buildTranscriptionForm(
		wavBytes,
		path.basename(wavPath),
		model,
		options.language,
	);

	const response = await fetch(OPENAI_TRANSCRIPTION_URL, {
		method: "POST",
		headers: { Authorization: `Bearer ${apiKey}` },
		body: form,
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(
			`OpenAI transcription failed (${response.status}). ${detail}`.trim(),
		);
	}

	const payload = (await response.json()) as VerboseTranscriptionResponse;
	const cues = mapVerboseTranscriptionToCues(payload);
	if (cues.length === 0) {
		// Models without segment timings (e.g. gpt-4o-transcribe json) return a
		// single text blob; surface a clear error rather than empty captions.
		const text = typeof payload.text === "string" ? payload.text.trim() : "";
		if (text) {
			throw new Error(
				"The selected OpenAI model returned a transcript without timing data. Choose whisper-1 for timed captions.",
			);
		}
		throw new Error("OpenAI transcription completed, but no caption cues were produced.");
	}

	return cues;
}

export const openaiWhisperProvider: CaptionProvider = {
	id: "openai",
	label: "OpenAI",
	kind: "cloud",
	listModels: () => OPENAI_MODELS,
	transcribe: transcribeWithOpenAi,
};
