/**
 * Native export heartbeat helpers.
 *
 * The renderer-side {@link ExportWatchdog} needs a liveness signal from the
 * native (ffmpeg) backend so it can tell "stuck on Preparing forever" (issue
 * #653) apart from "slowly making progress". The streaming native export does
 * not emit per-frame progress over IPC during the prepare phase, so we derive a
 * heartbeat from ffmpeg's own stderr/`-progress` chatter: any line ffmpeg
 * writes while it is alive counts as liveness.
 *
 * This module is pure (no timers, no IPC, no process handles) so it can be unit
 * tested. The owning IPC handler is expected to:
 *   1. create a {@link NativeExportHeartbeatEmitter} per session,
 *   2. feed every ffmpeg stderr chunk through {@link NativeExportHeartbeatEmitter.ingest},
 *   3. forward the returned heartbeats to the renderer via
 *      `sender.send("native-video-export-heartbeat", heartbeat)`.
 */

export interface NativeExportHeartbeat {
	sessionId: string;
	/** Monotonic-ish counter so the watchdog can treat it as increasing progress. */
	sequence: number;
	/** Wall-clock timestamp (ms) the heartbeat was produced. */
	atMs: number;
	/** Coarse stage hint parsed from ffmpeg output, when available. */
	stage: "prepare" | "encode" | "mux";
	/** Optional parsed output-time in microseconds from `-progress` lines. */
	outTimeUs?: number;
	/** Optional parsed frame count from `-progress` lines. */
	frame?: number;
}

export interface HeartbeatThrottleOptions {
	/**
	 * Minimum gap between emitted heartbeats. ffmpeg can emit many stderr lines
	 * per second; the watchdog only needs liveness, so we throttle. Defaults to
	 * 1000ms.
	 */
	minIntervalMs?: number;
}

const DEFAULT_HEARTBEAT_MIN_INTERVAL_MS = 1000;

/**
 * Parse an ffmpeg `-progress`-style chunk for the fields the heartbeat cares
 * about. Returns `null` when nothing useful is present (the chunk still counts
 * as liveness — see {@link NativeExportHeartbeatEmitter.ingest}).
 */
export function parseFfmpegProgressChunk(chunk: string): {
	frame?: number;
	outTimeUs?: number;
	completed: boolean;
} | null {
	if (typeof chunk !== "string" || chunk.length === 0) {
		return null;
	}

	let frame: number | undefined;
	let outTimeUs: number | undefined;
	let completed = false;
	let matched = false;

	for (const rawLine of chunk.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0) {
			continue;
		}

		const frameMatch = line.match(/^frame=\s*([0-9]+)/i);
		if (frameMatch) {
			const value = Number(frameMatch[1]);
			if (Number.isFinite(value)) {
				frame = value;
				matched = true;
			}
			continue;
		}

		const outTimeUsMatch = line.match(/^out_time_us=\s*(-?[0-9]+)/i);
		if (outTimeUsMatch) {
			const value = Number(outTimeUsMatch[1]);
			if (Number.isFinite(value) && value >= 0) {
				outTimeUs = value;
				matched = true;
			}
			continue;
		}

		if (/^progress=end$/i.test(line)) {
			completed = true;
			matched = true;
		}
	}

	return matched ? { frame, outTimeUs, completed } : null;
}

/**
 * Infer a coarse stage from the most recent parsed progress. Before any frame /
 * output time has been seen we are still preparing; once frames are flowing we
 * are encoding; `progress=end` means ffmpeg is finalizing the container (mux).
 */
export function inferHeartbeatStage(parsed: {
	frame?: number;
	outTimeUs?: number;
	completed: boolean;
} | null): "prepare" | "encode" | "mux" {
	if (parsed?.completed) {
		return "mux";
	}
	if (
		(typeof parsed?.frame === "number" && parsed.frame > 0) ||
		(typeof parsed?.outTimeUs === "number" && parsed.outTimeUs > 0)
	) {
		return "encode";
	}
	return "prepare";
}

export class NativeExportHeartbeatEmitter {
	private readonly sessionId: string;
	private readonly minIntervalMs: number;
	private sequence = 0;
	private lastEmittedAtMs = Number.NEGATIVE_INFINITY;

	constructor(sessionId: string, options: HeartbeatThrottleOptions = {}) {
		this.sessionId = sessionId;
		this.minIntervalMs =
			typeof options.minIntervalMs === "number" &&
			Number.isFinite(options.minIntervalMs) &&
			options.minIntervalMs >= 0
				? options.minIntervalMs
				: DEFAULT_HEARTBEAT_MIN_INTERVAL_MS;
	}

	/**
	 * Feed a raw ffmpeg stderr/stdout chunk. Returns a heartbeat to forward to
	 * the renderer, or `null` if throttled. Any non-empty chunk is liveness, even
	 * if no progress fields parse.
	 */
	ingest(chunk: string, nowMs: number): NativeExportHeartbeat | null {
		if (typeof chunk !== "string" || chunk.trim().length === 0) {
			return null;
		}

		const parsed = parseFfmpegProgressChunk(chunk);
		const completed = parsed?.completed === true;

		// Always emit immediately on completion; otherwise throttle.
		if (!completed && nowMs - this.lastEmittedAtMs < this.minIntervalMs) {
			return null;
		}

		this.lastEmittedAtMs = nowMs;
		this.sequence += 1;

		const heartbeat: NativeExportHeartbeat = {
			sessionId: this.sessionId,
			sequence: this.sequence,
			atMs: nowMs,
			stage: inferHeartbeatStage(parsed),
		};

		if (typeof parsed?.frame === "number") {
			heartbeat.frame = parsed.frame;
		}
		if (typeof parsed?.outTimeUs === "number") {
			heartbeat.outTimeUs = parsed.outTimeUs;
		}

		return heartbeat;
	}
}
