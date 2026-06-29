import fs from "node:fs/promises";
import {
	setWebcamLayoutEvents,
	type WebcamLayoutCaptureEvent,
	webcamLayoutEvents,
} from "../state";
import { getCursorCaptureElapsedMs } from "../cursor/telemetry";

const WEBCAM_LAYOUT_VERSION = 1;
const MAX_WEBCAM_LAYOUT_EVENTS = 2000;

export function getWebcamLayoutPathForVideo(videoPath: string): string {
	return `${videoPath}.webcam-layout.json`;
}

function isLayoutMode(value: unknown): value is WebcamLayoutCaptureEvent["mode"] {
	return value === "fullscreen" || value === "bubble";
}

export function normalizeWebcamLayoutEvents(rawEvents: unknown): WebcamLayoutCaptureEvent[] {
	const events = Array.isArray(rawEvents)
		? rawEvents
		: Array.isArray((rawEvents as { events?: unknown[] } | null | undefined)?.events)
			? ((rawEvents as { events: unknown[] }).events ?? [])
			: [];

	return events
		.filter((event: unknown): event is WebcamLayoutCaptureEvent => {
			const candidate = event as Partial<WebcamLayoutCaptureEvent>;
			return (
				!!candidate &&
				typeof candidate.timeMs === "number" &&
				Number.isFinite(candidate.timeMs) &&
				isLayoutMode(candidate.mode)
			);
		})
		.map((event) => ({ timeMs: Math.max(0, event.timeMs), mode: event.mode }))
		.sort((a, b) => a.timeMs - b.timeMs);
}

/** Reset the captured timeline at the start of a recording. */
export function resetWebcamLayoutCapture(): void {
	setWebcamLayoutEvents([]);
}

/**
 * Record a fullscreen/bubble switch, timestamped on the cursor-capture clock so
 * it shares the cursor telemetry's recording-start origin. Consecutive no-op
 * switches (same mode) are ignored.
 */
export function recordWebcamLayoutEvent(mode: WebcamLayoutCaptureEvent["mode"]): void {
	if (!isLayoutMode(mode)) {
		return;
	}
	const previous = webcamLayoutEvents[webcamLayoutEvents.length - 1];
	if (previous && previous.mode === mode) {
		return;
	}
	if (webcamLayoutEvents.length >= MAX_WEBCAM_LAYOUT_EVENTS) {
		return;
	}
	setWebcamLayoutEvents([
		...webcamLayoutEvents,
		{ timeMs: Math.max(0, getCursorCaptureElapsedMs()), mode },
	]);
}

/** Write the captured timeline alongside the recording (removes the sidecar if empty). */
export async function persistWebcamLayout(videoPath: string): Promise<void> {
	const layoutPath = getWebcamLayoutPathForVideo(videoPath);
	const events = normalizeWebcamLayoutEvents(webcamLayoutEvents);
	if (events.length === 0) {
		await fs.rm(layoutPath, { force: true });
		return;
	}

	await fs.writeFile(
		layoutPath,
		JSON.stringify({ version: WEBCAM_LAYOUT_VERSION, events }, null, 2),
		"utf-8",
	);
}

export async function readWebcamLayout(videoPath: string): Promise<WebcamLayoutCaptureEvent[]> {
	const layoutPath = getWebcamLayoutPathForVideo(videoPath);
	try {
		const content = await fs.readFile(layoutPath, "utf-8");
		const parsed = JSON.parse(content.replace(/^﻿/, "")) as unknown;
		return normalizeWebcamLayoutEvents(parsed);
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code === "ENOENT") {
			return [];
		}
		console.error("Failed to load webcam layout:", error);
		return [];
	}
}
