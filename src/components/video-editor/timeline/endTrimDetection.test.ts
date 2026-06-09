import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint } from "../types";
import { detectEndTrim } from "./endTrimDetection";

function pt(timeMs: number, cx: number, cy: number): CursorTelemetryPoint {
	return { timeMs, cx, cy };
}

describe("detectEndTrim", () => {
	it("trims the 'walking to the stop button' tail", () => {
		// Content activity up top, then a clear move down to the bottom Stop band.
		const telemetry: CursorTelemetryPoint[] = [
			pt(0, 0.4, 0.4),
			pt(1000, 0.5, 0.45),
			pt(2000, 0.45, 0.4),
			pt(3000, 0.5, 0.5),
			pt(8000, 0.5, 0.45), // last content moment up top
			pt(8300, 0.5, 0.7), // starting to descend
			pt(8600, 0.5, 0.9), // arrived at the bottom Stop control
			pt(8900, 0.5, 0.95),
		];
		const result = detectEndTrim(telemetry, 9000);
		expect(result).not.toBeNull();
		// Cut at the moment it left the content area (the 8300 sample).
		expect(result?.trimStartMs).toBe(8300);
		expect(result?.trimEndMs).toBe(9000);
	});

	it("returns null when the cursor doesn't end at the bottom", () => {
		const telemetry: CursorTelemetryPoint[] = [
			pt(0, 0.4, 0.4),
			pt(3000, 0.5, 0.45),
			pt(6000, 0.5, 0.4),
			pt(9000, 0.5, 0.42), // ends in content, not at a stop control
		];
		expect(detectEndTrim(telemetry, 9000)).toBeNull();
	});

	it("returns null when the tail would be too long (avoids over-trimming)", () => {
		// Cursor descended very early and stayed at the bottom the whole time.
		const telemetry: CursorTelemetryPoint[] = [
			pt(0, 0.5, 0.4),
			pt(500, 0.5, 0.9),
			pt(3000, 0.5, 0.92),
			pt(6000, 0.5, 0.93),
			pt(9000, 0.5, 0.95),
		];
		// tail would be ~8500ms from the 500 sample; maxTailMs default 9000 keeps it,
		// but here the only "content" sample is at 0, so tail = 9000-500 = 8500 < 9000.
		// Tighten maxTail to prove the guard works.
		expect(detectEndTrim(telemetry, 9000, { maxTailMs: 4000 })).toBeNull();
	});

	it("returns null when the tail is too short to matter", () => {
		const telemetry: CursorTelemetryPoint[] = [
			pt(0, 0.5, 0.4),
			pt(3000, 0.5, 0.4),
			pt(8950, 0.5, 0.45),
			pt(9000, 0.5, 0.9), // descended in the last 50ms
		];
		expect(detectEndTrim(telemetry, 9000, { minTailMs: 500 })).toBeNull();
	});

	it("returns null for sparse telemetry or bad duration", () => {
		expect(detectEndTrim([pt(0, 0.5, 0.9)], 9000)).toBeNull();
		expect(detectEndTrim([], 9000)).toBeNull();
		expect(
			detectEndTrim([pt(0, 0.5, 0.4), pt(1, 0.5, 0.5), pt(2, 0.5, 0.6), pt(3, 0.5, 0.95)], 0),
		).toBeNull();
	});

	it("ignores malformed samples and still works", () => {
		const telemetry: CursorTelemetryPoint[] = [
			pt(0, 0.4, 0.4),
			{ timeMs: Number.NaN, cx: 0.5, cy: 0.5 },
			pt(4000, 0.5, 0.45),
			pt(8000, 0.5, 0.45),
			pt(8400, 0.5, 0.8),
			pt(8800, 0.5, 0.92),
		];
		const result = detectEndTrim(telemetry, 9000);
		expect(result?.trimStartMs).toBe(8400);
	});

	it("respects a custom bottom band", () => {
		const telemetry: CursorTelemetryPoint[] = [
			pt(0, 0.5, 0.3),
			pt(4000, 0.5, 0.35),
			pt(8000, 0.5, 0.4),
			pt(8500, 0.5, 0.55),
			pt(8900, 0.5, 0.62), // only reaches 0.62
		];
		// Default band 0.72 -> not detected.
		expect(detectEndTrim(telemetry, 9000)).toBeNull();
		// Lower band 0.6 -> detected.
		const result = detectEndTrim(telemetry, 9000, {
			bottomBandCy: 0.6,
			contentExitHysteresis: 0.1,
		});
		expect(result?.trimStartMs).toBe(8500);
	});
});
