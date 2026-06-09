/**
 * Stage-level export watchdog state machine.
 *
 * Mission: "exports must never hang". The orchestrator drives a multi-stage
 * pipeline (prepare → encode → mux/finalize). If any stage makes no observable
 * progress for a configurable timeout, the active backend is considered stuck;
 * the watchdog signals an abort and tells the caller whether a safe fallback
 * retry is still available (issue #653 — export stuck on "Preparing" forever
 * on macOS).
 *
 * This module is pure (it owns no timers and performs no I/O) so it can be unit
 * tested deterministically. The caller supplies the current monotonic clock via
 * {@link ExportWatchdog.observe} / {@link ExportWatchdog.check} and is
 * responsible for actually aborting the backend and launching the fallback when
 * instructed.
 */

export type ExportStage = "prepare" | "encode" | "mux";

/**
 * Map an {@link ExportProgress}-style phase string onto a watchdog stage. The
 * exporter reports phases like "preparing" / "extracting" / "finalizing"; the
 * watchdog only cares about the three coarse stages.
 */
export function mapExportPhaseToStage(phase: string): ExportStage {
	switch (phase) {
		case "preparing":
			return "prepare";
		case "finalizing":
			return "mux";
		default:
			// "extracting" and any encode/render phase.
			return "encode";
	}
}

export const DEFAULT_STAGE_IDLE_TIMEOUT_MS = 90_000;

export interface ExportWatchdogOptions {
	/**
	 * No-progress timeout per stage, in milliseconds. A stage that does not
	 * report progress within this window is considered stuck. Defaults to
	 * {@link DEFAULT_STAGE_IDLE_TIMEOUT_MS}.
	 */
	stageIdleTimeoutMs?: number;
	/**
	 * Optional per-stage overrides. "prepare" on macOS in particular can legitimately
	 * sit at 0% while ScreenCaptureKit / ffmpeg spins up, so callers may widen it.
	 */
	stageTimeoutOverridesMs?: Partial<Record<ExportStage, number>>;
}

export type ExportWatchdogStatus =
	| { kind: "ok" }
	| {
			kind: "stuck";
			stage: ExportStage;
			idleMs: number;
			timeoutMs: number;
			/** True when a safe fallback retry has not yet been used. */
			fallbackAvailable: boolean;
	  };

export interface ExportWatchdogSnapshot {
	stage: ExportStage | null;
	lastProgressAtMs: number;
	lastProgressValue: number;
	fallbackUsed: boolean;
	aborted: boolean;
}

function normalizeTimeout(value: number | undefined, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return value;
}

export class ExportWatchdog {
	private readonly defaultTimeoutMs: number;
	private readonly overrides: Partial<Record<ExportStage, number>>;

	private stage: ExportStage | null = null;
	private lastProgressAtMs = 0;
	private lastProgressValue = Number.NEGATIVE_INFINITY;
	private fallbackUsed = false;
	private aborted = false;

	constructor(options: ExportWatchdogOptions = {}) {
		this.defaultTimeoutMs = normalizeTimeout(
			options.stageIdleTimeoutMs,
			DEFAULT_STAGE_IDLE_TIMEOUT_MS,
		);
		this.overrides = { ...options.stageTimeoutOverridesMs };
	}

	/** Timeout that applies to a given stage. */
	getStageTimeoutMs(stage: ExportStage): number {
		return normalizeTimeout(this.overrides[stage], this.defaultTimeoutMs);
	}

	/**
	 * Begin (or switch to) a stage. Resets the idle clock so a fresh stage is not
	 * immediately considered stuck. Switching stages always counts as progress.
	 */
	enterStage(stage: ExportStage, nowMs: number): void {
		this.stage = stage;
		this.lastProgressAtMs = nowMs;
		this.lastProgressValue = Number.NEGATIVE_INFINITY;
	}

	/**
	 * Record an observation for the current stage. `progressValue` is any
	 * monotonic-ish signal (percentage, frame count, bytes written, or a
	 * heartbeat counter). A value strictly greater than the last observed value —
	 * OR the very first observation in a stage — refreshes the idle clock.
	 * Heartbeats with no numeric meaning may pass `progressValue` as the previous
	 * value + any positive delta, or omit it to force a refresh.
	 */
	observe(nowMs: number, progressValue?: number): void {
		if (this.stage === null) {
			return;
		}

		if (progressValue === undefined) {
			// Bare heartbeat: liveness signal with no numeric progress. Refresh.
			this.lastProgressAtMs = nowMs;
			return;
		}

		if (!Number.isFinite(progressValue)) {
			return;
		}

		if (
			this.lastProgressValue === Number.NEGATIVE_INFINITY ||
			progressValue > this.lastProgressValue
		) {
			this.lastProgressValue = progressValue;
			this.lastProgressAtMs = nowMs;
		}
	}

	/**
	 * Evaluate whether the current stage is stuck at `nowMs`. Returns an "ok"
	 * status while progress is fresh, or a "stuck" status (with whether a
	 * fallback retry is still available) once the idle window is exceeded.
	 */
	check(nowMs: number): ExportWatchdogStatus {
		if (this.stage === null || this.aborted) {
			return { kind: "ok" };
		}

		const timeoutMs = this.getStageTimeoutMs(this.stage);
		const idleMs = nowMs - this.lastProgressAtMs;
		if (idleMs >= timeoutMs) {
			return {
				kind: "stuck",
				stage: this.stage,
				idleMs,
				timeoutMs,
				fallbackAvailable: !this.fallbackUsed,
			};
		}

		return { kind: "ok" };
	}

	/**
	 * Mark that the watchdog tripped and the backend is being torn down. After
	 * an abort the watchdog reports "ok" until {@link enterStage} starts the
	 * fallback pipeline, preventing repeated abort signals for the same hang.
	 */
	markAborted(usedFallback: boolean): void {
		this.aborted = true;
		if (usedFallback) {
			this.fallbackUsed = true;
		}
	}

	/** Begin the fallback pipeline run; clears the aborted flag and resets timing. */
	beginFallback(stage: ExportStage, nowMs: number): void {
		this.fallbackUsed = true;
		this.aborted = false;
		this.enterStage(stage, nowMs);
	}

	get hasUsedFallback(): boolean {
		return this.fallbackUsed;
	}

	snapshot(): ExportWatchdogSnapshot {
		return {
			stage: this.stage,
			lastProgressAtMs: this.lastProgressAtMs,
			lastProgressValue:
				this.lastProgressValue === Number.NEGATIVE_INFINITY ? 0 : this.lastProgressValue,
			fallbackUsed: this.fallbackUsed,
			aborted: this.aborted,
		};
	}
}

/**
 * Build a clear, user-facing error message for an export that exhausted its
 * fallback. Surfaces the stuck stage and a log path so the failure is
 * actionable rather than a silent hang.
 */
export function describeExhaustedExport({
	stage,
	timeoutMs,
	logPath,
}: {
	stage: ExportStage;
	timeoutMs: number;
	logPath?: string | null;
}): string {
	const seconds = Math.ceil(timeoutMs / 1000);
	const base = `Export stalled during the ${stage} stage for over ${seconds}s, and the safe fallback pipeline also failed.`;
	if (logPath) {
		return `${base} See the export log for details: ${logPath}`;
	}
	return `${base} Please retry; if it keeps stalling, check the export log.`;
}
