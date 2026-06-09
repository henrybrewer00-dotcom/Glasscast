import fs from "node:fs/promises";
import type { CaptionCuePayload } from "../../types";
import { mapVerboseTranscriptionToCues, type VerboseTranscriptionResponse } from "./cloudMapping";
import type { CaptionProvider, CaptionProviderModel, TranscribeOptions } from "./types";

const DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen";

const DEEPGRAM_MODELS: CaptionProviderModel[] = [
	{ id: "nova-2", label: "Nova-2 (fast, accurate)" },
	{ id: "nova-3", label: "Nova-3 (latest)" },
	{ id: "enhanced", label: "Enhanced" },
	{ id: "base", label: "Base" },
];

const DEFAULT_DEEPGRAM_MODEL = "nova-2";

function resolveDeepgramModel(modelId: string): string {
	const match = DEEPGRAM_MODELS.find((model) => model.id === modelId);
	return match ? match.id : DEFAULT_DEEPGRAM_MODEL;
}

/** Minimal shape of the Deepgram `/v1/listen` JSON response we consume. */
export interface DeepgramWord {
	word?: string;
	punctuated_word?: string;
	start?: number;
	end?: number;
}

export interface DeepgramUtterance {
	transcript?: string;
	start?: number;
	end?: number;
	words?: DeepgramWord[];
}

export interface DeepgramAlternative {
	transcript?: string;
	words?: DeepgramWord[];
}

export interface DeepgramResponse {
	results?: {
		utterances?: DeepgramUtterance[];
		channels?: Array<{ alternatives?: DeepgramAlternative[] }>;
	};
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * Normalise a Deepgram response into the shared `verbose_json` schema so it can
 * flow through the same cue mapper as OpenAI / Groq.
 *
 * Prefers `utterances` (sentence-level segments) when present; otherwise falls
 * back to splitting the first channel alternative's words into a single segment.
 * Exported for unit testing.
 */
export function mapDeepgramResponseToVerbose(
	payload: DeepgramResponse,
): VerboseTranscriptionResponse {
	const utterances = payload.results?.utterances;
	const flattenWords = (words: DeepgramWord[] | undefined) =>
		(words ?? [])
			.map((word) => ({
				word: (word.punctuated_word ?? word.word ?? "").trim(),
				start: word.start,
				end: word.end,
			}))
			.filter((word) => word.word.length > 0);

	if (Array.isArray(utterances) && utterances.length > 0) {
		const segments = utterances
			.filter(
				(utterance) =>
					typeof utterance.transcript === "string" &&
					utterance.transcript.trim().length > 0 &&
					isFiniteNumber(utterance.start) &&
					isFiniteNumber(utterance.end),
			)
			.map((utterance, index) => ({
				id: index,
				start: utterance.start,
				end: utterance.end,
				text: (utterance.transcript ?? "").trim(),
			}));

		const words = utterances.flatMap((utterance) => flattenWords(utterance.words));

		return { segments, words, text: segments.map((s) => s.text).join(" ") };
	}

	// Fallback: single-channel alternative without utterance segmentation.
	const alternative = payload.results?.channels?.[0]?.alternatives?.[0];
	const transcript = (alternative?.transcript ?? "").trim();
	const words = flattenWords(alternative?.words);

	if (!transcript) {
		return { segments: [], words: [], text: "" };
	}

	const firstStart = words.find((w) => isFiniteNumber(w.start))?.start ?? 0;
	const lastEnd = [...words].reverse().find((w) => isFiniteNumber(w.end))?.end ?? firstStart + 1;

	return {
		text: transcript,
		segments: [{ id: 0, start: firstStart, end: lastEnd, text: transcript }],
		words,
	};
}

export async function transcribeWithDeepgram(
	wavPath: string,
	options: TranscribeOptions,
): Promise<CaptionCuePayload[]> {
	const apiKey = options.apiKey?.trim();
	if (!apiKey) {
		throw new Error("A Deepgram API key is required for cloud captions.");
	}

	const model = resolveDeepgramModel(options.modelId);
	const wavBuffer = await fs.readFile(wavPath);
	const wavBytes = wavBuffer.buffer.slice(
		wavBuffer.byteOffset,
		wavBuffer.byteOffset + wavBuffer.byteLength,
	) as ArrayBuffer;

	const params = new URLSearchParams({
		model,
		smart_format: "true",
		punctuate: "true",
		utterances: "true",
	});
	const language = options.language?.trim();
	if (language && language.toLowerCase() !== "auto") {
		params.set("language", language);
	} else {
		params.set("detect_language", "true");
	}

	const response = await fetch(`${DEEPGRAM_LISTEN_URL}?${params.toString()}`, {
		method: "POST",
		headers: {
			Authorization: `Token ${apiKey}`,
			"Content-Type": "audio/wav",
		},
		body: wavBytes,
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(`Deepgram transcription failed (${response.status}). ${detail}`.trim());
	}

	const payload = (await response.json()) as DeepgramResponse;
	const verbose = mapDeepgramResponseToVerbose(payload);
	const cues = mapVerboseTranscriptionToCues(verbose);
	if (cues.length === 0) {
		throw new Error("Deepgram transcription completed, but no caption cues were produced.");
	}

	return cues;
}

export const deepgramProvider: CaptionProvider = {
	id: "deepgram",
	label: "Deepgram",
	kind: "cloud",
	listModels: () => DEEPGRAM_MODELS,
	transcribe: transcribeWithDeepgram,
};
