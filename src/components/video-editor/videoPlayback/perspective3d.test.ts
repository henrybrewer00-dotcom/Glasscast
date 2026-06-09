import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ZoomStyle, ZOOM_DEPTH_SCALES } from "../types";
import { compute3DAdjustment, computeZoomTransform } from "./zoomTransform";

const stageSize = { width: 1280, height: 720 };
const baseMask = { x: 80, y: 60, width: 1120, height: 600 };

/**
 * Re-implements Pixi's local-transform matrix so the test verifies the *rendered*
 * placement, not just the numbers compute3DAdjustment returns.
 *   a =  cos(rotation + skewY) * scaleX
 *   b =  sin(rotation + skewY) * scaleX
 *   c = -sin(rotation - skewX) * scaleY
 *   d =  cos(rotation - skewX) * scaleY
 *   screen = (a*lx + c*ly + x, b*lx + d*ly + y)
 */
function projectPoint(adj: ReturnType<typeof compute3DAdjustment>, localX: number, localY: number) {
	const a = Math.cos(adj.rotation + adj.skewY) * adj.scaleX;
	const b = Math.sin(adj.rotation + adj.skewY) * adj.scaleX;
	const c = -Math.sin(adj.rotation - adj.skewX) * adj.scaleY;
	const d = Math.cos(adj.rotation - adj.skewX) * adj.scaleY;
	return {
		x: a * localX + c * localY + adj.x,
		y: b * localX + d * localY + adj.y,
	};
}

function focusLocal(focusX: number, focusY: number) {
	return {
		x: baseMask.x + focusX * baseMask.width,
		y: baseMask.y + focusY * baseMask.height,
	};
}

describe("compute3DAdjustment", () => {
	it("is an exact identity of the base transform for the flat style", () => {
		const base = computeZoomTransform({
			stageSize,
			baseMask,
			zoomScale: 1.8,
			zoomProgress: 1,
			focusX: 0.3,
			focusY: 0.7,
		});
		const adj = compute3DAdjustment({
			baseTransform: base,
			stageSize,
			baseMask,
			zoomScale: 1.8,
			focusX: 0.3,
			focusY: 0.7,
			style: "flat",
		});
		expect(adj.scaleX).toBe(base.scale);
		expect(adj.scaleY).toBe(base.scale);
		expect(adj.skewX).toBe(0);
		expect(adj.skewY).toBe(0);
		expect(adj.rotation).toBe(0);
		expect(adj.x).toBe(base.x);
		expect(adj.y).toBe(base.y);
	});

	it("keeps the focus point pinned to the same screen pixel as the flat transform (tilt3d)", () => {
		const focusX = 0.25;
		const focusY = 0.8;
		const zoomScale = 2.2;
		const base = computeZoomTransform({
			stageSize,
			baseMask,
			zoomScale,
			zoomProgress: 1,
			focusX,
			focusY,
		});
		const adj = compute3DAdjustment({
			baseTransform: base,
			stageSize,
			baseMask,
			zoomScale,
			focusX,
			focusY,
			style: "tilt3d",
			intensity: 1,
		});

		const { x: lx, y: ly } = focusLocal(focusX, focusY);
		const flatScreen = { x: base.scale * lx + base.x, y: base.scale * ly + base.y };
		const tiltedScreen = projectPoint(adj, lx, ly);

		// The focus must land at exactly the same place — only the surrounding plane tilts.
		expect(tiltedScreen.x).toBeCloseTo(flatScreen.x, 4);
		expect(tiltedScreen.y).toBeCloseTo(flatScreen.y, 4);
		// And the flat transform already centres the focus on the stage.
		expect(tiltedScreen.x).toBeCloseTo(stageSize.width / 2, 3);
		expect(tiltedScreen.y).toBeCloseTo(stageSize.height / 2, 3);
	});

	it("actually applies shear when the focus is off-centre (tilt3d)", () => {
		const base = computeZoomTransform({
			stageSize,
			baseMask,
			zoomScale: 2.2,
			zoomProgress: 1,
			focusX: 0.1,
			focusY: 0.9,
		});
		const adj = compute3DAdjustment({
			baseTransform: base,
			stageSize,
			baseMask,
			zoomScale: 2.2,
			focusX: 0.1,
			focusY: 0.9,
			style: "tilt3d",
			intensity: 1,
		});
		// Off-centre focus => non-zero skew on both axes and receding-edge compression.
		expect(Math.abs(adj.skewX)).toBeGreaterThan(0);
		expect(Math.abs(adj.skewY)).toBeGreaterThan(0);
		expect(adj.scaleX).toBeLessThan(base.scale);
		expect(adj.scaleY).toBeLessThan(base.scale);
	});

	it("does not tilt a perfectly centred focus", () => {
		const base = computeZoomTransform({
			stageSize,
			baseMask,
			zoomScale: 2.2,
			zoomProgress: 1,
			focusX: 0.5,
			focusY: 0.5,
		});
		const adj = compute3DAdjustment({
			baseTransform: base,
			stageSize,
			baseMask,
			zoomScale: 2.2,
			focusX: 0.5,
			focusY: 0.5,
			style: "tilt3d",
			intensity: 1,
		});
		expect(adj.skewX).toBeCloseTo(0, 6);
		expect(adj.skewY).toBeCloseTo(0, 6);
		expect(adj.scaleX).toBeCloseTo(base.scale, 6);
		expect(adj.scaleY).toBeCloseTo(base.scale, 6);
	});

	it("fades the effect out as the zoom returns to rest (progress -> 0)", () => {
		const zoomScale = 2.2;
		// Half-way through the zoom-in (progress 0.5) => base scale ~ 1 + 0.6.
		const partial = computeZoomTransform({
			stageSize,
			baseMask,
			zoomScale,
			zoomProgress: 0.5,
			focusX: 0.2,
			focusY: 0.8,
		});
		const rest = computeZoomTransform({
			stageSize,
			baseMask,
			zoomScale,
			zoomProgress: 0,
			focusX: 0.2,
			focusY: 0.8,
		});
		const adjPartial = compute3DAdjustment({
			baseTransform: partial,
			stageSize,
			baseMask,
			zoomScale,
			focusX: 0.2,
			focusY: 0.8,
			style: "tilt3d",
			intensity: 1,
		});
		const adjRest = compute3DAdjustment({
			baseTransform: rest,
			stageSize,
			baseMask,
			zoomScale,
			focusX: 0.2,
			focusY: 0.8,
			style: "tilt3d",
			intensity: 1,
		});
		// At rest there is no zoom depth, so no tilt at all.
		expect(adjRest.skewX).toBeCloseTo(0, 6);
		expect(adjRest.skewY).toBeCloseTo(0, 6);
		// Partway in there is some, but less than at full depth.
		const full = compute3DAdjustment({
			baseTransform: computeZoomTransform({
				stageSize,
				baseMask,
				zoomScale,
				zoomProgress: 1,
				focusX: 0.2,
				focusY: 0.8,
			}),
			stageSize,
			baseMask,
			zoomScale,
			focusX: 0.2,
			focusY: 0.8,
			style: "tilt3d",
			intensity: 1,
		});
		expect(Math.abs(adjPartial.skewY)).toBeGreaterThan(0);
		expect(Math.abs(adjPartial.skewY)).toBeLessThan(Math.abs(full.skewY));
	});

	it("scales the effect with intensity", () => {
		const base = computeZoomTransform({
			stageSize,
			baseMask,
			zoomScale: 2.2,
			zoomProgress: 1,
			focusX: 0.15,
			focusY: 0.85,
		});
		const weak = compute3DAdjustment({
			baseTransform: base,
			stageSize,
			baseMask,
			zoomScale: 2.2,
			focusX: 0.15,
			focusY: 0.85,
			style: "tilt3d",
			intensity: 0.25,
		});
		const strong = compute3DAdjustment({
			baseTransform: base,
			stageSize,
			baseMask,
			zoomScale: 2.2,
			focusX: 0.15,
			focusY: 0.85,
			style: "tilt3d",
			intensity: 1,
		});
		expect(Math.abs(strong.skewY)).toBeGreaterThan(Math.abs(weak.skewY));
	});

	it("dolly style rolls and punches in without shearing", () => {
		const base = computeZoomTransform({
			stageSize,
			baseMask,
			zoomScale: 2.2,
			zoomProgress: 1,
			focusX: 0.2,
			focusY: 0.5,
		});
		const adj = compute3DAdjustment({
			baseTransform: base,
			stageSize,
			baseMask,
			zoomScale: 2.2,
			focusX: 0.2,
			focusY: 0.5,
			style: "dolly",
			intensity: 1,
		});
		expect(adj.skewX).toBe(0);
		expect(adj.skewY).toBe(0);
		expect(Math.abs(adj.rotation)).toBeGreaterThan(0);
		// Punch-in => uniform scale strictly larger than the flat base.
		expect(adj.scaleX).toBeGreaterThan(base.scale);
		expect(adj.scaleX).toBeCloseTo(adj.scaleY, 6);
		// The focus still stays put.
		const { x: lx, y: ly } = focusLocal(0.2, 0.5);
		const screen = projectPoint(adj, lx, ly);
		expect(screen.x).toBeCloseTo(base.scale * lx + base.x, 3);
		expect(screen.y).toBeCloseTo(base.scale * ly + base.y, 3);
	});

	it("falls back to flat when the stage is degenerate", () => {
		const adj = compute3DAdjustment({
			baseTransform: { scale: 1.5, x: 10, y: 20 },
			stageSize: { width: 0, height: 0 },
			baseMask,
			zoomScale: 1.8,
			focusX: 0.2,
			focusY: 0.2,
			style: "tilt3d",
			intensity: 1,
		});
		expect(adj.x).toBe(10);
		expect(adj.y).toBe(20);
		expect(adj.skewX).toBe(0);
	});
});

/**
 * Property-based stress test: across thousands of random camera states the two
 * load-bearing invariants must always hold —
 *   1. the focus point never drifts (it lands exactly where the flat transform put it), and
 *   2. every output value is finite (no NaN/Infinity ever reaches the renderer).
 */
describe("compute3DAdjustment — fuzzed invariants", () => {
	const STYLES: ZoomStyle[] = ["flat", "tilt3d", "dolly"];
	const depths = Object.values(ZOOM_DEPTH_SCALES);

	function project(adj: ReturnType<typeof compute3DAdjustment>, lx: number, ly: number) {
		const a = Math.cos(adj.rotation + adj.skewY) * adj.scaleX;
		const b = Math.sin(adj.rotation + adj.skewY) * adj.scaleX;
		const c = -Math.sin(adj.rotation - adj.skewX) * adj.scaleY;
		const d = Math.cos(adj.rotation - adj.skewX) * adj.scaleY;
		return { x: a * lx + c * ly + adj.x, y: b * lx + d * ly + adj.y };
	}

	it("keeps the focus pinned and outputs finite for any state", () => {
		fc.assert(
			fc.property(
				fc.double({ min: 0, max: 1, noNaN: true }), // focusX
				fc.double({ min: 0, max: 1, noNaN: true }), // focusY
				fc.double({ min: 0, max: 1, noNaN: true }), // progress
				fc.double({ min: 0, max: 1, noNaN: true }), // intensity
				fc.integer({ min: 0, max: depths.length - 1 }), // depth index
				fc.integer({ min: 0, max: STYLES.length - 1 }), // style index
				(focusX, focusY, progress, intensity, depthIdx, styleIdx) => {
					const stage = { width: 1920, height: 1080 };
					const mask = { x: 64, y: 48, width: 1792, height: 984 };
					const zoomScale = depths[depthIdx];
					const base = computeZoomTransform({
						stageSize: stage,
						baseMask: mask,
						zoomScale,
						zoomProgress: progress,
						focusX,
						focusY,
					});
					const adj = compute3DAdjustment({
						baseTransform: base,
						stageSize: stage,
						baseMask: mask,
						zoomScale,
						focusX,
						focusY,
						style: STYLES[styleIdx],
						intensity,
					});

					for (const v of [
						adj.scaleX,
						adj.scaleY,
						adj.skewX,
						adj.skewY,
						adj.rotation,
						adj.x,
						adj.y,
					]) {
						expect(Number.isFinite(v)).toBe(true);
					}

					const lx = mask.x + focusX * mask.width;
					const ly = mask.y + focusY * mask.height;
					const flat = { x: base.scale * lx + base.x, y: base.scale * ly + base.y };
					const projected = project(adj, lx, ly);
					// Focus stays put to within sub-pixel tolerance.
					expect(Math.abs(projected.x - flat.x)).toBeLessThan(0.01);
					expect(Math.abs(projected.y - flat.y)).toBeLessThan(0.01);
				},
			),
			{ numRuns: 2000 },
		);
	});
});
