import type { CropRegion, WebcamLayoutEvent, WebcamLayoutMode } from "./types";
import { getWebcamCropSourceRect } from "./webcamOverlay";

/**
 * Pure helpers for the webcam fullscreen/bubble layout timeline.
 *
 * The timeline is a list of switch points captured live during recording (keys
 * 1 = fullscreen, 2 = bubble), each timestamped on the recording-start clock
 * (the same origin cursor telemetry uses). Both the editor preview and the
 * exporter resolve the framing for a given playback time from this list, so the
 * exported video reproduces exactly what the user toggled while recording.
 */

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
	return clamp(value, 0, 1);
}

function easeInOutCubic(t: number): number {
	const x = clamp01(t);
	return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

function isLayoutMode(value: unknown): value is WebcamLayoutMode {
	return value === "fullscreen" || value === "bubble";
}

/**
 * Sort, validate and collapse a raw layout timeline. Drops invalid entries,
 * clamps negative times to 0, and removes consecutive events that don't change
 * the mode (a no-op switch leaves a single event).
 */
export function normalizeWebcamLayout(
	events: WebcamLayoutEvent[] | null | undefined,
): WebcamLayoutEvent[] {
	if (!events || events.length === 0) {
		return [];
	}

	const sorted = events
		.filter((event) => event && Number.isFinite(event.timeMs) && isLayoutMode(event.mode))
		.map((event) => ({ timeMs: Math.max(0, event.timeMs), mode: event.mode }))
		.sort((a, b) => a.timeMs - b.timeMs);

	const collapsed: WebcamLayoutEvent[] = [];
	for (const event of sorted) {
		const previous = collapsed[collapsed.length - 1];
		if (previous && previous.mode === event.mode) {
			continue;
		}
		// If two switches share a timestamp, the later one wins.
		if (previous && previous.timeMs === event.timeMs) {
			collapsed[collapsed.length - 1] = event;
			continue;
		}
		collapsed.push(event);
	}

	return collapsed;
}

/** The framing mode active at a given time (bubble when there is no timeline). */
export function getWebcamLayoutModeAtTime(
	events: WebcamLayoutEvent[] | null | undefined,
	timeMs: number,
): WebcamLayoutMode {
	const normalized = normalizeWebcamLayout(events);
	if (normalized.length === 0) {
		return "bubble";
	}

	let mode: WebcamLayoutMode = normalized[0].mode;
	for (const event of normalized) {
		if (event.timeMs <= timeMs) {
			mode = event.mode;
		} else {
			break;
		}
	}
	return mode;
}

/**
 * Eased 0..1 "fullscreen-ness" at a given time: 0 = bubble, 1 = fullscreen.
 * Switches animate over `transitionMs`. The opening event snaps (no fade-in) so
 * a recording that starts fullscreen opens directly on the talking-head shot.
 */
export function getWebcamFullscreenProgressAtTime(
	events: WebcamLayoutEvent[] | null | undefined,
	timeMs: number,
	transitionMs: number,
): number {
	const normalized = normalizeWebcamLayout(events);
	if (normalized.length === 0) {
		return 0;
	}

	const targetFor = (mode: WebcamLayoutMode): number => (mode === "fullscreen" ? 1 : 0);

	// Find the active event index (last event at or before timeMs).
	let activeIndex = 0;
	for (let i = 0; i < normalized.length; i++) {
		if (normalized[i].timeMs <= timeMs) {
			activeIndex = i;
		} else {
			break;
		}
	}

	const active = normalized[activeIndex];
	const activeTarget = targetFor(active.mode);

	// Before the first switch, or with no transition window, snap to the target.
	if (activeIndex === 0 || transitionMs <= 0) {
		return activeTarget;
	}

	const previousTarget = targetFor(normalized[activeIndex - 1].mode);
	const elapsed = timeMs - active.timeMs;
	const progress = easeInOutCubic(elapsed / transitionMs);
	return previousTarget + (activeTarget - previousTarget) * progress;
}

export interface WebcamLayoutRect {
	x: number;
	y: number;
	width: number;
	height: number;
	/** Corner radius as a percent (0-100), matching WebcamOverlaySettings.cornerRadius. */
	radiusPercent: number;
}

/**
 * Morph the bubble rect toward a full-frame rect by `fullscreenProgress`.
 * At progress 1 the webcam covers the entire frame with square corners.
 */
export function getWebcamLayoutRect({
	bubbleX,
	bubbleY,
	bubbleSize,
	bubbleRadiusPercent,
	frameWidth,
	frameHeight,
	fullscreenProgress,
}: {
	bubbleX: number;
	bubbleY: number;
	bubbleSize: number;
	bubbleRadiusPercent: number;
	frameWidth: number;
	frameHeight: number;
	fullscreenProgress: number;
}): WebcamLayoutRect {
	const p = clamp01(fullscreenProgress);
	const lerp = (a: number, b: number) => a + (b - a) * p;
	return {
		x: lerp(bubbleX, 0),
		y: lerp(bubbleY, 0),
		width: lerp(bubbleSize, frameWidth),
		height: lerp(bubbleSize, frameHeight),
		radiusPercent: lerp(bubbleRadiusPercent, 0),
	};
}

export interface WebcamCoverContentRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * Object-fit:cover placement of a (possibly cropped) webcam source inside an
 * arbitrary container rect, in container pixels. Generalizes the square-bubble
 * cover math to non-square rects so the same path drives the bubble and the
 * fullscreen framing (and every frame of the morph between them).
 */
export function getWebcamCoverContentRect({
	containerWidth,
	containerHeight,
	sourceWidth,
	sourceHeight,
	crop,
}: {
	containerWidth: number;
	containerHeight: number;
	sourceWidth: number;
	sourceHeight: number;
	crop?: Partial<CropRegion> | null;
}): WebcamCoverContentRect {
	const safeContainerW = Math.max(1, containerWidth);
	const safeContainerH = Math.max(1, containerHeight);
	const safeSourceW = Math.max(1, sourceWidth);
	const safeSourceH = Math.max(1, sourceHeight);
	const { sx, sy, sw, sh } = getWebcamCropSourceRect(crop, safeSourceW, safeSourceH);

	// Scale the full source so the cropped region covers the container.
	const coverScale = Math.max(safeContainerW / sw, safeContainerH / sh);
	const fullWidth = safeSourceW * coverScale;
	const fullHeight = safeSourceH * coverScale;
	// Center the cropped region within the container.
	const left = (safeContainerW - sw * coverScale) / 2 - sx * coverScale;
	const top = (safeContainerH - sh * coverScale) / 2 - sy * coverScale;

	return { left, top, width: fullWidth, height: fullHeight };
}

/**
 * Effective ring-light strength for the current framing. The fullscreen shot
 * gets a guaranteed ring (the "light ring around the display") even when the
 * bubble ring light is off, fading in with the morph.
 */
export function getWebcamLayoutRingLight({
	baseRingLight,
	fullscreenRingLight,
	fullscreenProgress,
}: {
	baseRingLight: number;
	fullscreenRingLight: number;
	fullscreenProgress: number;
}): number {
	const p = clamp01(fullscreenProgress);
	const fullscreenTarget = Math.max(baseRingLight, fullscreenRingLight);
	return baseRingLight + (fullscreenTarget - baseRingLight) * p;
}
