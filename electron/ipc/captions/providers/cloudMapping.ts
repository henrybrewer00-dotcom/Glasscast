import type { CaptionCuePayload, CaptionWordPayload } from "../../types";

/**
 * Shape of an OpenAI / Groq `verbose_json` audio transcription response.
 * Both providers expose the same Whisper-derived schema: top-level `text`,
 * an array of `segments` (with second-based start/end), and optionally a
 * flat array of `words` with their own timings.
 */
export interface VerboseTranscriptionSegment {
	id?: number;
	start?: number;
	end?: number;
	text?: string;
}

export interface VerboseTranscriptionWord {
	word?: string;
	start?: number;
	end?: number;
}

export interface VerboseTranscriptionResponse {
	text?: string;
	segments?: VerboseTranscriptionSegment[];
	words?: VerboseTranscriptionWord[];
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function secondsToMs(value: number): number {
	return Math.round(value * 1000);
}

/**
 * Distribute the word-level timings (which are flat across the whole response)
 * into the cues whose [startMs, endMs] window contains the word's midpoint.
 */
function assignWordsToCues(
	cues: CaptionCuePayload[],
	words: VerboseTranscriptionWord[],
): void {
	if (cues.length === 0 || words.length === 0) {
		return;
	}

	const buckets: CaptionWordPayload[][] = cues.map(() => []);

	for (const word of words) {
		const text = typeof word.word === "string" ? word.word.trim() : "";
		if (!text || !isFiniteNumber(word.start) || !isFiniteNumber(word.end)) {
			continue;
		}

		const startMs = secondsToMs(word.start);
		const endMs = secondsToMs(word.end);
		if (endMs <= startMs) {
			continue;
		}

		const midpoint = (startMs + endMs) / 2;
		let targetIndex = cues.findIndex(
			(cue) => midpoint >= cue.startMs && midpoint <= cue.endMs,
		);
		if (targetIndex === -1) {
			// Fall back to the nearest cue by start time.
			targetIndex = cues.reduce((best, cue, index) => {
				const bestDelta = Math.abs(cues[best].startMs - startMs);
				const delta = Math.abs(cue.startMs - startMs);
				return delta < bestDelta ? index : best;
			}, 0);
		}

		buckets[targetIndex].push({
			text,
			startMs,
			endMs,
			...(buckets[targetIndex].length > 0 ? { leadingSpace: true } : {}),
		});
	}

	cues.forEach((cue, index) => {
		if (buckets[index].length > 0) {
			cue.words = buckets[index];
		}
	});
}

/**
 * Map an OpenAI/Groq verbose_json transcription response into caption cues.
 * Used by both the OpenAI and Groq providers since they share the schema.
 */
export function mapVerboseTranscriptionToCues(
	response: VerboseTranscriptionResponse,
): CaptionCuePayload[] {
	const segments = Array.isArray(response.segments) ? response.segments : [];

	const cues: CaptionCuePayload[] = [];
	segments.forEach((segment, index) => {
		const text = typeof segment.text === "string" ? segment.text.trim() : "";
		if (!text || !isFiniteNumber(segment.start) || !isFiniteNumber(segment.end)) {
			return;
		}

		const startMs = secondsToMs(segment.start);
		const endMs = secondsToMs(segment.end);
		if (endMs <= startMs) {
			return;
		}

		cues.push({
			id: `caption-${index + 1}`,
			startMs,
			endMs,
			text,
		});
	});

	if (Array.isArray(response.words)) {
		assignWordsToCues(cues, response.words);
	}

	return cues;
}
