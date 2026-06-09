import { describe, expect, it } from "vitest";
import {
	DEFAULT_STAGE_IDLE_TIMEOUT_MS,
	describeExhaustedExport,
	ExportWatchdog,
	mapExportPhaseToStage,
} from "./exportWatchdog";

describe("mapExportPhaseToStage", () => {
	it("maps known phases to coarse stages", () => {
		expect(mapExportPhaseToStage("preparing")).toBe("prepare");
		expect(mapExportPhaseToStage("finalizing")).toBe("mux");
		expect(mapExportPhaseToStage("extracting")).toBe("encode");
		expect(mapExportPhaseToStage("anything-else")).toBe("encode");
	});
});

describe("ExportWatchdog", () => {
	it("uses the default 90s idle timeout", () => {
		const wd = new ExportWatchdog();
		wd.enterStage("prepare", 0);
		expect(wd.getStageTimeoutMs("prepare")).toBe(DEFAULT_STAGE_IDLE_TIMEOUT_MS);
		expect(DEFAULT_STAGE_IDLE_TIMEOUT_MS).toBe(90_000);
	});

	it("reports ok while progress stays fresh", () => {
		const wd = new ExportWatchdog({ stageIdleTimeoutMs: 1000 });
		wd.enterStage("prepare", 0);
		wd.observe(500, 10);
		expect(wd.check(900).kind).toBe("ok");
		wd.observe(900, 20);
		expect(wd.check(1800).kind).toBe("ok");
	});

	it("flags a stuck stage once the idle window is exceeded", () => {
		const wd = new ExportWatchdog({ stageIdleTimeoutMs: 1000 });
		wd.enterStage("encode", 0);
		wd.observe(100, 5);
		const status = wd.check(1100);
		expect(status.kind).toBe("stuck");
		if (status.kind === "stuck") {
			expect(status.stage).toBe("encode");
			expect(status.fallbackAvailable).toBe(true);
			expect(status.timeoutMs).toBe(1000);
			expect(status.idleMs).toBeGreaterThanOrEqual(1000);
		}
	});

	it("does not refresh on non-increasing progress values", () => {
		const wd = new ExportWatchdog({ stageIdleTimeoutMs: 1000 });
		wd.enterStage("encode", 0);
		wd.observe(100, 50);
		// stale repeats of the same value should NOT reset the idle clock
		wd.observe(500, 50);
		wd.observe(900, 40);
		expect(wd.check(1100).kind).toBe("stuck");
	});

	it("treats a bare heartbeat as liveness and refreshes the clock", () => {
		const wd = new ExportWatchdog({ stageIdleTimeoutMs: 1000 });
		wd.enterStage("mux", 0);
		wd.observe(900); // heartbeat, no numeric progress
		expect(wd.check(1500).kind).toBe("ok");
		expect(wd.check(2000).kind).toBe("stuck");
	});

	it("resets the idle clock when entering a new stage", () => {
		const wd = new ExportWatchdog({ stageIdleTimeoutMs: 1000 });
		wd.enterStage("prepare", 0);
		wd.observe(100, 1);
		wd.enterStage("encode", 5000);
		expect(wd.check(5500).kind).toBe("ok");
	});

	it("honors per-stage timeout overrides", () => {
		const wd = new ExportWatchdog({
			stageIdleTimeoutMs: 1000,
			stageTimeoutOverridesMs: { prepare: 5000 },
		});
		wd.enterStage("prepare", 0);
		expect(wd.getStageTimeoutMs("prepare")).toBe(5000);
		expect(wd.getStageTimeoutMs("encode")).toBe(1000);
		expect(wd.check(3000).kind).toBe("ok");
		expect(wd.check(5000).kind).toBe("stuck");
	});

	it("marks fallback unavailable after the fallback run begins", () => {
		const wd = new ExportWatchdog({ stageIdleTimeoutMs: 1000 });
		wd.enterStage("encode", 0);
		const first = wd.check(2000);
		expect(first.kind === "stuck" && first.fallbackAvailable).toBe(true);

		wd.markAborted(false);
		// after abort, no repeated stuck signals until the fallback re-enters a stage
		expect(wd.check(3000).kind).toBe("ok");

		wd.beginFallback("encode", 4000);
		expect(wd.hasUsedFallback).toBe(true);
		const second = wd.check(6000);
		expect(second.kind).toBe("stuck");
		if (second.kind === "stuck") {
			expect(second.fallbackAvailable).toBe(false);
		}
	});

	it("ignores observations and checks before any stage is entered", () => {
		const wd = new ExportWatchdog();
		wd.observe(1000, 5);
		expect(wd.check(1_000_000).kind).toBe("ok");
	});
});

describe("describeExhaustedExport", () => {
	it("includes the stage, timeout seconds and log path", () => {
		const message = describeExhaustedExport({
			stage: "prepare",
			timeoutMs: 90_000,
			logPath: "/tmp/glasscast-export.log",
		});
		expect(message).toContain("prepare");
		expect(message).toContain("90s");
		expect(message).toContain("/tmp/glasscast-export.log");
	});

	it("falls back to a retry hint when no log path is known", () => {
		const message = describeExhaustedExport({ stage: "mux", timeoutMs: 90_000 });
		expect(message).toContain("retry");
	});
});
