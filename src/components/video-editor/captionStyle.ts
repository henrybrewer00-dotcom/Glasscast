import type { CaptionWordState } from "./captionLayout";
import {
	type CaptionCue,
	type CaptionTextTransform,
	DEFAULT_AUTO_CAPTION_SETTINGS,
} from "./types";

export const CAPTION_FONT_WEIGHT = 400;
export const CAPTION_LINE_HEIGHT = 1.32;

export function applyCaptionTextTransform(text: string, transform: CaptionTextTransform) {
	switch (transform) {
		case "uppercase":
			return text.toUpperCase();
		case "lowercase":
			return text.toLowerCase();
		default:
			return text;
	}
}

/**
 * Apply the configured text transform to cues BEFORE layout so line measurement
 * sees the same glyphs that get drawn (uppercase runs wider than mixed case).
 */
export function transformCaptionCuesForDisplay(
	cues: CaptionCue[],
	transform: CaptionTextTransform,
): CaptionCue[] {
	if (transform === "none") {
		return cues;
	}

	return cues.map((cue) => ({
		...cue,
		text: applyCaptionTextTransform(cue.text, transform),
		words: cue.words?.map((word) => ({
			...word,
			text: applyCaptionTextTransform(word.text, transform),
		})),
	}));
}

/** Convert a #rrggbb hex color + alpha into an rgba() string for canvas/CSS. */
export function getCaptionBackgroundColor(hex: string, opacity: number) {
	const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!match) {
		return `rgba(0, 0, 0, ${opacity})`;
	}
	const value = Number.parseInt(match[1], 16);
	const r = (value >> 16) & 0xff;
	const g = (value >> 8) & 0xff;
	const b = value & 0xff;
	return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

const DEFAULT_CAPTION_REFERENCE_WIDTH = 1920 * (DEFAULT_AUTO_CAPTION_SETTINGS.maxWidth / 100);

export function getCaptionTargetWidth(containerWidth: number, maxWidthPercent: number) {
	return Math.max(1, containerWidth * (maxWidthPercent / 100));
}

export function getCaptionScaledFontSize(
	fontSize: number,
	containerWidth: number,
	maxWidthPercent: number,
) {
	return Math.max(
		14,
		fontSize *
			(getCaptionTargetWidth(containerWidth, maxWidthPercent) /
				DEFAULT_CAPTION_REFERENCE_WIDTH),
	);
}

export function getCaptionPadding(fontSize: number) {
	return {
		x: fontSize * 1.1,
		y: fontSize * 0.78,
	};
}

export function getCaptionScaledRadius(radius: number, fontSize: number) {
	const baseline = Math.max(1, DEFAULT_AUTO_CAPTION_SETTINGS.fontSize);
	return Math.max(0, radius * (fontSize / baseline));
}

export function getCaptionTextMaxWidth(
	containerWidth: number,
	maxWidthPercent: number,
	fontSize: number,
) {
	const padding = getCaptionPadding(fontSize);
	return Math.max(
		fontSize * 4,
		getCaptionTargetWidth(containerWidth, maxWidthPercent) - padding.x * 2,
	);
}

export function getCaptionWordVisualState(hasWordTimings: boolean, state: CaptionWordState) {
	if (!hasWordTimings) {
		return {
			isInactive: false,
			opacity: 1,
		};
	}

	switch (state) {
		case "upcoming":
			return {
				isInactive: true,
				opacity: 0.82,
			};
		case "spoken":
			return {
				isInactive: false,
				opacity: 0.72,
			};
		case "active":
		default:
			return {
				isInactive: false,
				opacity: 1,
			};
	}
}
