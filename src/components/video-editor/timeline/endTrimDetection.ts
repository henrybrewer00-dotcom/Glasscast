import type { CursorTelemetryPoint } from "../types";

/**
 * Smart "you're done" end-trim detection.
 *
 * When a screen recording ends, the user almost always makes a final deliberate
 * move toward the recorder's Stop/Cancel control (a bottom-centre HUD) and clicks
 * it. That "walking to the stop button" tail is dead footage. This pure function
 * spots it from cursor telemetry so the editor can drop an *adjustable* trim at
 * the end IN POST — it never affects the live recording.
 *
 * Heuristic: the final cursor position sits in the bottom band of the frame
 * (where the Stop control lives); walk back to the last moment the cursor was
 * clearly up in the content area — that's where the "go to stop" move began, and
 * where we cut. Only fires for a small, plausible tail; otherwise returns null so
 * we never trim aggressively or on a false positive.
 */
export interface EndTrimSuggestion {
	/** Cut here — keep [0, trimStartMs], drop [trimStartMs, trimEndMs]. */
	trimStartMs: number;
	/** End of the recording. */
	trimEndMs: number;
	reason: string;
}

export interface EndTrimOptions {
	/** Don't suggest if the tail to remove is shorter than this (ms). */
	minTailMs?: number;
	/** Don't suggest if the tail to remove is longer than this (ms). */
	maxTailMs?: number;
	/** cy at/above which the cursor is considered to be at the bottom Stop/HUD band (0–1). */
	bottomBandCy?: number;
	/** Hysteresis: how far above the band counts as "clearly in content". */
	contentExitHysteresis?: number;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

export function detectEndTrim(
	telemetry: CursorTelemetryPoint[],
	durationMs: number,
	options: EndTrimOptions = {},
): EndTrimSuggestion | null {
	const minTailMs = options.minTailMs ?? 500;
	const maxTailMs = options.maxTailMs ?? 9000;
	const bottomBandCy = options.bottomBandCy ?? 0.72;
	const hysteresis = options.contentExitHysteresis ?? 0.12;

	if (!isFiniteNumber(durationMs) || durationMs <= 0) {
		return null;
	}

	const pts = telemetry
		.filter((p) => isFiniteNumber(p.timeMs) && isFiniteNumber(p.cx) && isFiniteNumber(p.cy))
		.sort((a, b) => a.timeMs - b.timeMs);

	if (pts.length < 4) {
		return null;
	}

	const last = pts[pts.length - 1];
	const endMs = durationMs;

	// The user must have ended down at the Stop/Cancel band. If the final position
	// isn't near the bottom, they likely stopped via keyboard or a relocated HUD —
	// don't guess.
	if (last.cy < bottomBandCy) {
		return null;
	}

	// Walk backward to the last sample clearly up in the content area; the move to
	// the Stop control began right after it.
	const contentCy = bottomBandCy - hysteresis;
	let trimStartMs: number | null = null;
	for (let i = pts.length - 2; i >= 0; i -= 1) {
		const p = pts[i];
		if (endMs - p.timeMs > maxTailMs + 3000) {
			break; // too far back to be a single "go to stop" move
		}
		if (p.cy < contentCy) {
			trimStartMs = pts[i + 1].timeMs;
			break;
		}
	}

	if (trimStartMs === null) {
		return null;
	}

	const tail = endMs - trimStartMs;
	if (tail < minTailMs || tail > maxTailMs) {
		return null;
	}

	return {
		trimStartMs: Math.round(trimStartMs),
		trimEndMs: Math.round(endMs),
		reason: "cursor moved to the stop control",
	};
}
