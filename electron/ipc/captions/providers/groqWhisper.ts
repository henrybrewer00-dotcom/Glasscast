import fs from "node:fs/promises";
import path from "node:path";
import type { CaptionCuePayload } from "../../types";
import {
	mapVerboseTranscriptionToCues,
	type VerboseTranscriptionResponse,
} from "./cloudMapping";
import type { CaptionProvider, CaptionProviderModel, TranscribeOptions } from "./types";

const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

const GROQ_MODELS: CaptionProviderModel[] = [
	{ id: "whisper-large-v3-turbo", label: "Whisper Large v3 Turbo" },
	{ id: "whisper-large-v3", label: "Whisper Large v3" },
	{ id: "distil-whisper-large-v3-en", label: "Distil Whisper Large v3 (EN)" },
];

const DEFAULT_GROQ_MODEL = "whisper-large-v3-turbo";

function resolveGroqModel(modelId: string): string {
	const match = GROQ_MODELS.find((model) => model.id === modelId);
	return match ? match.id : DEFAULT_GROQ_MODEL;
}

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
	form.append("response_format", "verbose_json");
	form.append("timestamp_granularities[]", "segment");
	form.append("timestamp_granularities[]", "word");

	if (language && language.trim() && language.trim().toLowerCase() !== "auto") {
		form.append("language", language.trim());
	}

	return form;
}

export async function transcribeWithGroq(
	wavPath: string,
	options: TranscribeOptions,
): Promise<CaptionCuePayload[]> {
	const apiKey = options.apiKey?.trim();
	if (!apiKey) {
		throw new Error("A Groq API key is required for cloud captions.");
	}

	const model = resolveGroqModel(options.modelId);
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

	const response = await fetch(GROQ_TRANSCRIPTION_URL, {
		method: "POST",
		headers: { Authorization: `Bearer ${apiKey}` },
		body: form,
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(`Groq transcription failed (${response.status}). ${detail}`.trim());
	}

	const payload = (await response.json()) as VerboseTranscriptionResponse;
	const cues = mapVerboseTranscriptionToCues(payload);
	if (cues.length === 0) {
		throw new Error("Groq transcription completed, but no caption cues were produced.");
	}

	return cues;
}

export const groqWhisperProvider: CaptionProvider = {
	id: "groq",
	label: "Groq",
	kind: "cloud",
	listModels: () => GROQ_MODELS,
	transcribe: transcribeWithGroq,
};
