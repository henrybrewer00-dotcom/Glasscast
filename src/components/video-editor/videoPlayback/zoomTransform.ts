import { Container } from "pixi.js";
import { MotionBlurFilter } from "pixi-filters/motion-blur";
import { ZoomBlurFilter } from "pixi-filters/zoom-blur";
import {
	DEFAULT_ZOOM_3D_INTENSITY,
	DEFAULT_ZOOM_MOTION_BLUR_TUNING,
	type ZoomMotionBlurTuning,
	type ZoomStyle,
} from "../types";

// Maximum perspective shear (radians) applied at full zoom + full intensity (~8°).
const MAX_TILT_SKEW_RAD = 0.14;
// Maximum axis compression on the receding side at full effect.
const MAX_TILT_COMPRESS = 0.05;
// Maximum cinematic roll (radians) for the "dolly" style (~1.7°).
const MAX_DOLLY_ROLL_RAD = 0.03;
// Extra punch-in multiplier applied by the "dolly" style at full effect.
const MAX_DOLLY_PUNCH = 0.06;

const MIN_DIRECTIONAL_BLUR_MAGNITUDE = 0.01;
const DIRECTIONAL_BLUR_KERNEL_SIZE = 13;
const DIRECTIONAL_BLUR_OFFSET_DIVISOR = 32;

export interface MotionBlurState {
	lastFrameTimeMs: number;
	prevCamX: number;
	prevCamY: number;
	prevCamScale: number;
	initialized: boolean;
}

export function createMotionBlurState(): MotionBlurState {
	return {
		lastFrameTimeMs: 0,
		prevCamX: 0,
		prevCamY: 0,
		prevCamScale: 1,
		initialized: false,
	};
}

interface TransformParams {
	cameraContainer: Container;
	zoomBlurFilter?: ZoomBlurFilter | null;
	motionBlurFilter?: MotionBlurFilter | null;
	stageSize: { width: number; height: number };
	baseMask: { x: number; y: number; width: number; height: number };
	zoomScale: number;
	zoomProgress?: number;
	focusX: number;
	focusY: number;
	isPlaying: boolean;
	motionBlurAmount?: number;
	motionBlurTuning?: ZoomMotionBlurTuning;
	transformOverride?: AppliedTransform;
	motionBlurState?: MotionBlurState;
	frameTimeMs?: number;
	zoomStyle?: ZoomStyle;
	zoomIntensity?: number;
}

interface AppliedTransform {
	scale: number;
	x: number;
	y: number;
}

interface Point2D {
	x: number;
	y: number;
}

interface TransformQuad {
	center: Point2D;
	corners: [Point2D, Point2D, Point2D, Point2D];
	diagonal: number;
	size: Point2D;
}

interface CameraStepAnalysis {
	mode: "move" | "zoom" | null;
	moveVelocity: Point2D;
	moveBlurVelocity: Point2D;
	moveBlurOffset: number;
	zoomCenter: Point2D;
	zoomStrength: number;
}

interface FocusFromTransformGeometry {
	stageSize: { width: number; height: number };
	baseMask: { x: number; y: number; width: number; height: number };
	zoomScale: number;
	x: number;
	y: number;
}

interface ZoomTransformGeometry {
	stageSize: { width: number; height: number };
	baseMask: { x: number; y: number; width: number; height: number };
	zoomScale: number;
	zoomProgress?: number;
	focusX: number;
	focusY: number;
}

function resetMotionEffects(
	zoomBlurFilter?: ZoomBlurFilter | null,
	motionBlurFilter?: MotionBlurFilter | null,
	motionBlurState?: MotionBlurState,
) {
	if (motionBlurFilter) {
		motionBlurFilter.velocity = { x: 0, y: 0 };
		motionBlurFilter.kernelSize = 5;
		motionBlurFilter.offset = 0;
	}

	if (zoomBlurFilter) {
		zoomBlurFilter.strength = 0;
		zoomBlurFilter.innerRadius = 0;
		zoomBlurFilter.radius = -1;
	}

	if (motionBlurState) {
		motionBlurState.lastFrameTimeMs = 0;
		motionBlurState.prevCamX = 0;
		motionBlurState.prevCamY = 0;
		motionBlurState.prevCamScale = 1;
		motionBlurState.initialized = false;
	}
}

function resolveMotionBlurTuning(motionBlurTuning?: ZoomMotionBlurTuning): ZoomMotionBlurTuning {
	if (!motionBlurTuning) {
		return DEFAULT_ZOOM_MOTION_BLUR_TUNING;
	}

	return {
		...DEFAULT_ZOOM_MOTION_BLUR_TUNING,
		...motionBlurTuning,
	};
}

function computeTransformQuad(
	baseMask: { x: number; y: number; width: number; height: number },
	transform: AppliedTransform,
): TransformQuad {
	const topLeft = {
		x: transform.x + baseMask.x * transform.scale,
		y: transform.y + baseMask.y * transform.scale,
	};
	const topRight = {
		x: transform.x + (baseMask.x + baseMask.width) * transform.scale,
		y: transform.y + baseMask.y * transform.scale,
	};
	const bottomRight = {
		x: transform.x + (baseMask.x + baseMask.width) * transform.scale,
		y: transform.y + (baseMask.y + baseMask.height) * transform.scale,
	};
	const bottomLeft = {
		x: transform.x + baseMask.x * transform.scale,
		y: transform.y + (baseMask.y + baseMask.height) * transform.scale,
	};
	const center = {
		x: (topLeft.x + bottomRight.x) * 0.5,
		y: (topLeft.y + bottomRight.y) * 0.5,
	};

	return {
		center,
		corners: [topLeft, topRight, bottomRight, bottomLeft],
		diagonal: Math.hypot(bottomRight.x - topLeft.x, bottomRight.y - topLeft.y),
		size: {
			x: Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y),
			y: Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y),
		},
	};
}

function crossProduct(a: Point2D, b: Point2D) {
	return a.x * b.y - a.y * b.x;
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function intersectInfiniteLines(
	aStart: Point2D,
	aEnd: Point2D,
	bStart: Point2D,
	bEnd: Point2D,
): Point2D | null {
	const aDelta = { x: aEnd.x - aStart.x, y: aEnd.y - aStart.y };
	const bDelta = { x: bEnd.x - bStart.x, y: bEnd.y - bStart.y };
	const denominator = crossProduct(aDelta, bDelta);

	if (Math.abs(denominator) < 0.0001) {
		return null;
	}

	const originDelta = { x: bStart.x - aStart.x, y: bStart.y - aStart.y };
	const t = crossProduct(originDelta, bDelta) / denominator;

	return {
		x: aStart.x + aDelta.x * t,
		y: aStart.y + aDelta.y * t,
	};
}

function inferZoomCenterFromQuads(
	previousQuad: TransformQuad,
	currentQuad: TransformQuad,
	stageSize: { width: number; height: number },
) {
	const hasMeaningfulChange =
		Math.abs(currentQuad.center.x - previousQuad.center.x) > 0.001 ||
		Math.abs(currentQuad.center.y - previousQuad.center.y) > 0.001 ||
		Math.abs(currentQuad.diagonal - previousQuad.diagonal) > 0.001;

	if (!hasMeaningfulChange) {
		return previousQuad.center;
	}

	const motionSegments: Array<{ start: Point2D; end: Point2D }> = [];

	for (let i = 0; i < previousQuad.corners.length; i += 1) {
		const start = previousQuad.corners[i];
		const end = currentQuad.corners[i];
		if (Math.hypot(end.x - start.x, end.y - start.y) < 0.5) {
			continue;
		}
		motionSegments.push({ start, end });
	}

	for (let i = 0; i < motionSegments.length; i += 1) {
		for (let j = i + 1; j < motionSegments.length; j += 1) {
			const intersection = intersectInfiniteLines(
				motionSegments[i].start,
				motionSegments[i].end,
				motionSegments[j].start,
				motionSegments[j].end,
			);

			if (!intersection) {
				continue;
			}

			const marginX = stageSize.width;
			const marginY = stageSize.height;

			return {
				x: clamp(intersection.x, -marginX, stageSize.width + marginX),
				y: clamp(intersection.y, -marginY, stageSize.height + marginY),
			};
		}
	}

	return currentQuad.center;
}

function resolveFpsScale(deltaSeconds: number) {
	const fps = 1 / Math.max(1 / 240, deltaSeconds);
	return fps / 60;
}

function resolveBlurChannels(
	motionBlurAmount: number,
	motionBlurTuning: ZoomMotionBlurTuning,
	deltaSeconds: number,
) {
	const fpsScale = resolveFpsScale(deltaSeconds);

	return {
		motion:
			motionBlurAmount *
			fpsScale *
			(motionBlurTuning.maxDirectionalBlurPx /
				DEFAULT_ZOOM_MOTION_BLUR_TUNING.maxDirectionalBlurPx),
		zoom:
			motionBlurAmount *
			fpsScale *
			(motionBlurTuning.maxRadialBlurStrength /
				DEFAULT_ZOOM_MOTION_BLUR_TUNING.maxRadialBlurStrength),
	};
}

function computeMoveDelta(previousQuad: TransformQuad, currentQuad: TransformQuad) {
	return {
		x: currentQuad.center.x - previousQuad.center.x,
		y: currentQuad.center.y - previousQuad.center.y,
	};
}

function computeSizeDelta(previousQuad: TransformQuad, currentQuad: TransformQuad) {
	return {
		x: Math.abs(currentQuad.size.x - previousQuad.size.x),
		y: Math.abs(currentQuad.size.y - previousQuad.size.y),
	};
}

function computeZoomStrength(previousQuad: TransformQuad, currentQuad: TransformQuad) {
	return Math.abs(1 - currentQuad.diagonal / Math.max(0.0001, previousQuad.diagonal));
}

function classifyMotionMode(
	previousQuad: TransformQuad,
	currentQuad: TransformQuad,
	motionBlurTuning: ZoomMotionBlurTuning,
	deltaSeconds: number,
) {
	const moveDelta = computeMoveDelta(previousQuad, currentQuad);
	const sizeDelta = computeSizeDelta(previousQuad, currentQuad);
	const moveDistance = Math.hypot(moveDelta.x, moveDelta.y);
	const zoomDistance = Math.hypot(sizeDelta.x, sizeDelta.y);
	const moveVelocity = Math.hypot(moveDelta.x, moveDelta.y) / Math.max(0.0001, deltaSeconds);
	const zoomVelocity =
		Math.abs(
			Math.log(
				Math.max(0.0001, currentQuad.diagonal) / Math.max(0.0001, previousQuad.diagonal),
			),
		) / Math.max(0.0001, deltaSeconds);
	const moveActive = moveVelocity >= motionBlurTuning.panVelocityThreshold;
	const zoomActive = zoomVelocity >= motionBlurTuning.zoomVelocityThreshold;

	if (!moveActive && !zoomActive) {
		return null;
	}

	if (moveActive && !zoomActive) {
		return "move";
	}

	if (zoomActive && !moveActive) {
		return "zoom";
	}

	return zoomDistance > moveDistance ? "zoom" : "move";
}

function createZeroPoint(): Point2D {
	return { x: 0, y: 0 };
}

function analyzeCameraStep({
	previousQuad,
	currentQuad,
	stageSize,
	motionBlurAmount,
	motionBlurTuning,
	deltaSeconds,
}: {
	previousQuad: TransformQuad;
	currentQuad: TransformQuad;
	stageSize: { width: number; height: number };
	motionBlurAmount: number;
	motionBlurTuning: ZoomMotionBlurTuning;
	deltaSeconds: number;
}): CameraStepAnalysis {
	const mode = classifyMotionMode(
		previousQuad,
		currentQuad,
		motionBlurTuning,
		deltaSeconds,
	);
	const moveDelta = computeMoveDelta(previousQuad, currentQuad);
	const blurChannels = resolveBlurChannels(
		motionBlurAmount,
		motionBlurTuning,
		deltaSeconds,
	);
	const moveBlurVelocity = {
		x: moveDelta.x * blurChannels.motion,
		y: moveDelta.y * blurChannels.motion,
	};
	const moveBlurMagnitude = Math.hypot(moveBlurVelocity.x, moveBlurVelocity.y);

	return {
		mode,
		moveVelocity: moveDelta,
		moveBlurVelocity:
			mode === "move" && moveBlurMagnitude >= MIN_DIRECTIONAL_BLUR_MAGNITUDE
				? moveBlurVelocity
				: createZeroPoint(),
		moveBlurOffset:
			mode === "move" && moveBlurMagnitude >= MIN_DIRECTIONAL_BLUR_MAGNITUDE
				? -moveBlurMagnitude / DIRECTIONAL_BLUR_OFFSET_DIVISOR
				: 0,
		zoomCenter: inferZoomCenterFromQuads(previousQuad, currentQuad, stageSize),
		zoomStrength:
			mode === "zoom"
				? computeZoomStrength(previousQuad, currentQuad) * blurChannels.zoom
				: 0,
	};
}

function applyCameraStepBlur({
	analysis,
	motionBlurFilter,
	zoomBlurFilter,
}: {
	analysis: CameraStepAnalysis;
	motionBlurFilter: MotionBlurFilter;
	zoomBlurFilter?: ZoomBlurFilter | null;
}) {
	motionBlurFilter.velocity = analysis.moveBlurVelocity;
	motionBlurFilter.kernelSize = DIRECTIONAL_BLUR_KERNEL_SIZE;
	motionBlurFilter.offset = analysis.moveBlurOffset;

	if (zoomBlurFilter) {
		zoomBlurFilter.center = analysis.zoomCenter;
		zoomBlurFilter.strength = analysis.zoomStrength;
		zoomBlurFilter.innerRadius = 0;
		zoomBlurFilter.radius = -1;
	}
}

export function computeZoomTransform({
	stageSize,
	baseMask,
	zoomScale,
	zoomProgress = 1,
	focusX,
	focusY,
}: ZoomTransformGeometry): AppliedTransform {
	if (
		stageSize.width <= 0 ||
		stageSize.height <= 0 ||
		baseMask.width <= 0 ||
		baseMask.height <= 0
	) {
		return { scale: 1, x: 0, y: 0 };
	}

	const progress = Math.min(1, Math.max(0, zoomProgress));
	const focusStagePxX = baseMask.x + focusX * baseMask.width;
	const focusStagePxY = baseMask.y + focusY * baseMask.height;
	const stageCenterX = stageSize.width / 2;
	const stageCenterY = stageSize.height / 2;
	const scale = 1 + (zoomScale - 1) * progress;
	const finalX = stageCenterX - focusStagePxX * zoomScale;
	const finalY = stageCenterY - focusStagePxY * zoomScale;

	return {
		scale,
		x: finalX * progress,
		y: finalY * progress,
	};
}

export interface PerspectiveAdjustment {
	scaleX: number;
	scaleY: number;
	skewX: number;
	skewY: number;
	rotation: number;
	x: number;
	y: number;
}

interface Perspective3DGeometry {
	baseTransform: AppliedTransform;
	stageSize: { width: number; height: number };
	baseMask: { x: number; y: number; width: number; height: number };
	zoomScale: number;
	focusX: number;
	focusY: number;
	style?: ZoomStyle;
	intensity?: number;
}

/**
 * Computes the 3D / cinematic adjustment layered on top of the flat zoom transform.
 *
 * The flat transform already places the focus point at the stage centre via a uniform
 * scale + translate. This function tilts / rolls the plane *around that focus point* so the
 * focus never drifts — it derives a corrected translation from Pixi's exact local-transform
 * matrix so the rendered result matches the math precisely.
 *
 * For style "flat" (the default) it returns the identity of the base transform, so existing
 * zooms are byte-identical and carry zero regression risk.
 */
export function compute3DAdjustment({
	baseTransform,
	stageSize,
	baseMask,
	zoomScale,
	focusX,
	focusY,
	style = "flat",
	intensity = DEFAULT_ZOOM_3D_INTENSITY,
}: Perspective3DGeometry): PerspectiveAdjustment {
	const flat: PerspectiveAdjustment = {
		scaleX: baseTransform.scale,
		scaleY: baseTransform.scale,
		skewX: 0,
		skewY: 0,
		rotation: 0,
		x: baseTransform.x,
		y: baseTransform.y,
	};

	if (
		style === "flat" ||
		stageSize.width <= 0 ||
		stageSize.height <= 0 ||
		baseMask.width <= 0 ||
		baseMask.height <= 0
	) {
		return flat;
	}

	// How "deep" into the zoom we currently are (0 at rest, 1 fully zoomed in).
	const zoomSpan = zoomScale - 1;
	const amountRaw = zoomSpan > 0.0001 ? (baseTransform.scale - 1) / zoomSpan : 0;
	const amount = clamp(amountRaw, 0, 1) * clamp(intensity, 0, 1);

	if (amount <= 0) {
		return flat;
	}

	// Direction of the focus relative to the frame centre, in -1..1.
	const yaw = clamp((focusX - 0.5) * 2, -1, 1); // left / right
	const pitch = clamp((focusY - 0.5) * 2, -1, 1); // up / down

	let scaleX = baseTransform.scale;
	let scaleY = baseTransform.scale;
	let skewX = 0;
	let skewY = 0;
	let rotation = 0;

	if (style === "tilt3d") {
		// Card-tilt toward the focus: shear + compress the receding axis.
		skewX = pitch * MAX_TILT_SKEW_RAD * amount;
		skewY = yaw * MAX_TILT_SKEW_RAD * amount;
		scaleX = baseTransform.scale * (1 - Math.abs(yaw) * MAX_TILT_COMPRESS * amount);
		scaleY = baseTransform.scale * (1 - Math.abs(pitch) * MAX_TILT_COMPRESS * amount);
	} else if (style === "dolly") {
		// Vertigo push: a gentle roll plus an extra punch-in, no shear.
		rotation = yaw * MAX_DOLLY_ROLL_RAD * amount;
		const punch = 1 + MAX_DOLLY_PUNCH * amount;
		scaleX = baseTransform.scale * punch;
		scaleY = baseTransform.scale * punch;
	}

	// Pixi composes the local matrix as:
	//   a =  cos(rotation + skewY) * scaleX
	//   b =  sin(rotation + skewY) * scaleX
	//   c = -sin(rotation - skewX) * scaleY
	//   d =  cos(rotation - skewX) * scaleY
	// and screen = M * local + position (pivot is 0).
	const a = Math.cos(rotation + skewY) * scaleX;
	const b = Math.sin(rotation + skewY) * scaleX;
	const c = -Math.sin(rotation - skewX) * scaleY;
	const d = Math.cos(rotation - skewX) * scaleY;

	// Focus point in container-local (stage) coordinates.
	const focusLocalX = baseMask.x + focusX * baseMask.width;
	const focusLocalY = baseMask.y + focusY * baseMask.height;

	// Where the flat transform already put the focus point on screen.
	const targetX = baseTransform.scale * focusLocalX + baseTransform.x;
	const targetY = baseTransform.scale * focusLocalY + baseTransform.y;

	// Solve position so the focus point lands at exactly the same screen spot:
	//   target = M * focusLocal + position  =>  position = target - M * focusLocal
	const x = targetX - (a * focusLocalX + c * focusLocalY);
	const y = targetY - (b * focusLocalX + d * focusLocalY);

	if (
		!Number.isFinite(x) ||
		!Number.isFinite(y) ||
		!Number.isFinite(scaleX) ||
		!Number.isFinite(scaleY)
	) {
		return flat;
	}

	return { scaleX, scaleY, skewX, skewY, rotation, x, y };
}

export function computeFocusFromTransform({
	stageSize,
	baseMask,
	zoomScale,
	x,
	y,
}: FocusFromTransformGeometry) {
	if (
		stageSize.width <= 0 ||
		stageSize.height <= 0 ||
		baseMask.width <= 0 ||
		baseMask.height <= 0 ||
		zoomScale <= 0
	) {
		return { cx: 0.5, cy: 0.5 };
	}

	const stageCenterX = stageSize.width / 2;
	const stageCenterY = stageSize.height / 2;
	const focusStagePxX = (stageCenterX - x) / zoomScale;
	const focusStagePxY = (stageCenterY - y) / zoomScale;

	return {
		cx: (focusStagePxX - baseMask.x) / baseMask.width,
		cy: (focusStagePxY - baseMask.y) / baseMask.height,
	};
}

export function applyZoomTransform({
	cameraContainer,
	zoomBlurFilter,
	motionBlurFilter,
	stageSize,
	baseMask,
	zoomScale,
	zoomProgress = 1,
	focusX,
	focusY,
	isPlaying,
	motionBlurAmount = 0,
	motionBlurTuning,
	transformOverride,
	motionBlurState,
	frameTimeMs,
	zoomStyle = "flat",
	zoomIntensity,
}: TransformParams): AppliedTransform {
	if (
		stageSize.width <= 0 ||
		stageSize.height <= 0 ||
		baseMask.width <= 0 ||
		baseMask.height <= 0
	) {
		cameraContainer.scale.set(1);
		cameraContainer.position.set(0, 0);
		cameraContainer.skew.set(0, 0);
		cameraContainer.rotation = 0;
		resetMotionEffects(zoomBlurFilter, motionBlurFilter, motionBlurState);
		return { scale: 1, x: 0, y: 0 };
	}

	const transform =
		transformOverride ??
		computeZoomTransform({
			stageSize,
			baseMask,
			zoomScale,
			zoomProgress,
			focusX,
			focusY,
		});

	// Layer the cinematic 3D / dolly adjustment on top of the flat transform.
	// For "flat" this returns the identity of `transform`, leaving behaviour unchanged.
	const adjustment = compute3DAdjustment({
		baseTransform: transform,
		stageSize,
		baseMask,
		zoomScale,
		focusX,
		focusY,
		style: zoomStyle,
		intensity: zoomIntensity,
	});

	// Apply position, scale, skew & rotation to camera container
	cameraContainer.scale.set(adjustment.scaleX, adjustment.scaleY);
	cameraContainer.skew.set(adjustment.skewX, adjustment.skewY);
	cameraContainer.rotation = adjustment.rotation;
	cameraContainer.position.set(adjustment.x, adjustment.y);
	const resolvedTuning = resolveMotionBlurTuning(motionBlurTuning);

	if (motionBlurState && motionBlurFilter && motionBlurAmount > 0 && isPlaying) {
		const now = frameTimeMs ?? performance.now();

		if (!motionBlurState.initialized) {
			motionBlurState.prevCamX = transform.x;
			motionBlurState.prevCamY = transform.y;
			motionBlurState.prevCamScale = transform.scale;
			motionBlurState.lastFrameTimeMs = now;
			motionBlurState.initialized = true;
			motionBlurFilter.velocity = { x: 0, y: 0 };
			motionBlurFilter.kernelSize = DIRECTIONAL_BLUR_KERNEL_SIZE;
			motionBlurFilter.offset = 0;
			if (zoomBlurFilter) {
				zoomBlurFilter.strength = 0;
			}
		} else {
			const dtMs = Math.min(80, Math.max(1, now - motionBlurState.lastFrameTimeMs));
			const dtSeconds = dtMs / 1000;
			motionBlurState.lastFrameTimeMs = now;

			const previousTransform = {
				scale: motionBlurState.prevCamScale,
				x: motionBlurState.prevCamX,
				y: motionBlurState.prevCamY,
			};
			const previousQuad = computeTransformQuad(baseMask, previousTransform);
			const currentQuad = computeTransformQuad(baseMask, transform);
			const analysis = analyzeCameraStep({
				previousQuad,
				currentQuad,
				stageSize,
				motionBlurAmount,
				motionBlurTuning: resolvedTuning,
				deltaSeconds: dtSeconds,
			});

			motionBlurState.prevCamX = transform.x;
			motionBlurState.prevCamY = transform.y;
			motionBlurState.prevCamScale = transform.scale;
			applyCameraStepBlur({ analysis, motionBlurFilter, zoomBlurFilter });
		}
	} else {
		resetMotionEffects(zoomBlurFilter, motionBlurFilter, motionBlurState);
	}

	return {
		scale: transform.scale,
		x: transform.x,
		y: transform.y,
	};
}
