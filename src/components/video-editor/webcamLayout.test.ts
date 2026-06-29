import { describe, expect, it } from "vitest";
import type { WebcamLayoutEvent } from "./types";
import {
	getWebcamCoverContentRect,
	getWebcamFullscreenProgressAtTime,
	getWebcamLayoutModeAtTime,
	getWebcamLayoutRect,
	getWebcamLayoutRingLight,
	normalizeWebcamLayout,
} from "./webcamLayout";

describe("normalizeWebcamLayout", () => {
	it("returns empty for no timeline", () => {
		expect(normalizeWebcamLayout(undefined)).toEqual([]);
		expect(normalizeWebcamLayout([])).toEqual([]);
	});

	it("sorts, clamps negatives, and collapses no-op repeats", () => {
		const raw: WebcamLayoutEvent[] = [
			{ timeMs: 5000, mode: "bubble" },
			{ timeMs: -10, mode: "fullscreen" },
			{ timeMs: 5000, mode: "bubble" }, // duplicate mode
			{ timeMs: 8000, mode: "fullscreen" },
		];
		expect(normalizeWebcamLayout(raw)).toEqual([
			{ timeMs: 0, mode: "fullscreen" },
			{ timeMs: 5000, mode: "bubble" },
			{ timeMs: 8000, mode: "fullscreen" },
		]);
	});

	it("drops invalid entries", () => {
		const raw = [
			{ timeMs: Number.NaN, mode: "fullscreen" },
			{ timeMs: 1000, mode: "sideways" },
			{ timeMs: 2000, mode: "bubble" },
		] as unknown as WebcamLayoutEvent[];
		expect(normalizeWebcamLayout(raw)).toEqual([{ timeMs: 2000, mode: "bubble" }]);
	});
});

describe("getWebcamLayoutModeAtTime", () => {
	const layout: WebcamLayoutEvent[] = [
		{ timeMs: 0, mode: "fullscreen" },
		{ timeMs: 4000, mode: "bubble" },
	];

	it("defaults to bubble with no timeline", () => {
		expect(getWebcamLayoutModeAtTime([], 1234)).toBe("bubble");
	});

	it("resolves the active mode for a time", () => {
		expect(getWebcamLayoutModeAtTime(layout, 0)).toBe("fullscreen");
		expect(getWebcamLayoutModeAtTime(layout, 3999)).toBe("fullscreen");
		expect(getWebcamLayoutModeAtTime(layout, 4000)).toBe("bubble");
		expect(getWebcamLayoutModeAtTime(layout, 99999)).toBe("bubble");
	});
});

describe("getWebcamFullscreenProgressAtTime", () => {
	const layout: WebcamLayoutEvent[] = [
		{ timeMs: 0, mode: "fullscreen" },
		{ timeMs: 4000, mode: "bubble" },
	];

	it("is 0 with no timeline", () => {
		expect(getWebcamFullscreenProgressAtTime([], 1000, 600)).toBe(0);
	});

	it("opens fullscreen with no fade-in on the first event", () => {
		expect(getWebcamFullscreenProgressAtTime(layout, 0, 600)).toBe(1);
		expect(getWebcamFullscreenProgressAtTime(layout, 2000, 600)).toBe(1);
	});

	it("eases from fullscreen to bubble across the transition window", () => {
		expect(getWebcamFullscreenProgressAtTime(layout, 4000, 600)).toBe(1);
		const mid = getWebcamFullscreenProgressAtTime(layout, 4300, 600);
		expect(mid).toBeGreaterThan(0);
		expect(mid).toBeLessThan(1);
		expect(getWebcamFullscreenProgressAtTime(layout, 4600, 600)).toBeCloseTo(0, 5);
		expect(getWebcamFullscreenProgressAtTime(layout, 9999, 600)).toBe(0);
	});

	it("snaps when transition duration is zero", () => {
		expect(getWebcamFullscreenProgressAtTime(layout, 4001, 0)).toBe(0);
	});
});

describe("getWebcamLayoutRect", () => {
	const base = {
		bubbleX: 1500,
		bubbleY: 800,
		bubbleSize: 300,
		bubbleRadiusPercent: 90,
		frameWidth: 1920,
		frameHeight: 1080,
	};

	it("is the bubble rect at progress 0", () => {
		expect(getWebcamLayoutRect({ ...base, fullscreenProgress: 0 })).toEqual({
			x: 1500,
			y: 800,
			width: 300,
			height: 300,
			radiusPercent: 90,
		});
	});

	it("covers the frame with square corners at progress 1", () => {
		expect(getWebcamLayoutRect({ ...base, fullscreenProgress: 1 })).toEqual({
			x: 0,
			y: 0,
			width: 1920,
			height: 1080,
			radiusPercent: 0,
		});
	});

	it("interpolates linearly at the midpoint", () => {
		const mid = getWebcamLayoutRect({ ...base, fullscreenProgress: 0.5 });
		expect(mid.x).toBe(750);
		expect(mid.width).toBe((300 + 1920) / 2);
		expect(mid.height).toBe((300 + 1080) / 2);
		expect(mid.radiusPercent).toBe(45);
	});
});

describe("getWebcamCoverContentRect", () => {
	it("matches the legacy square-cover formula for a square container, full source", () => {
		// No crop, square container: cover scale = 1, source fills exactly.
		const rect = getWebcamCoverContentRect({
			containerWidth: 300,
			containerHeight: 300,
			sourceWidth: 300,
			sourceHeight: 300,
		});
		expect(rect).toEqual({ left: 0, top: 0, width: 300, height: 300 });
	});

	it("covers a square container from a 16:9 source by cropping the sides", () => {
		const rect = getWebcamCoverContentRect({
			containerWidth: 300,
			containerHeight: 300,
			sourceWidth: 1280,
			sourceHeight: 720,
		});
		// Cover scale = max(300/1280, 300/720) = 300/720 → height fills, width overflows.
		expect(rect.height).toBeCloseTo(300, 5);
		expect(rect.width).toBeGreaterThan(300);
		expect(rect.top).toBeCloseTo(0, 5);
		expect(rect.left).toBeLessThan(0);
	});

	it("covers a 16:9 frame from a 16:9 source exactly", () => {
		const rect = getWebcamCoverContentRect({
			containerWidth: 1920,
			containerHeight: 1080,
			sourceWidth: 1280,
			sourceHeight: 720,
		});
		expect(rect.left).toBeCloseTo(0, 5);
		expect(rect.top).toBeCloseTo(0, 5);
		expect(rect.width).toBeCloseTo(1920, 5);
		expect(rect.height).toBeCloseTo(1080, 5);
	});
});

describe("getWebcamLayoutRingLight", () => {
	it("keeps the base ring when not fullscreen", () => {
		expect(
			getWebcamLayoutRingLight({
				baseRingLight: 0,
				fullscreenRingLight: 0.6,
				fullscreenProgress: 0,
			}),
		).toBe(0);
	});

	it("fades in the fullscreen ring even when the bubble ring is off", () => {
		expect(
			getWebcamLayoutRingLight({
				baseRingLight: 0,
				fullscreenRingLight: 0.6,
				fullscreenProgress: 1,
			}),
		).toBeCloseTo(0.6, 5);
	});

	it("never lowers an already-strong base ring", () => {
		expect(
			getWebcamLayoutRingLight({
				baseRingLight: 0.9,
				fullscreenRingLight: 0.6,
				fullscreenProgress: 1,
			}),
		).toBeCloseTo(0.9, 5);
	});
});
