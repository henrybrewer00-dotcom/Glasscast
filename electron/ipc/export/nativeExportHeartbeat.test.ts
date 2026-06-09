import { describe, expect, it } from "vitest";
import {
	NativeExportHeartbeatEmitter,
	inferHeartbeatStage,
	parseFfmpegProgressChunk,
} from "./nativeExportHeartbeat";

describe("parseFfmpegProgressChunk", () => {
	it("parses frame and out_time_us from a -progress chunk", () => {
		const parsed = parseFfmpegProgressChunk("frame=120\nout_time_us=2000000\nprogress=continue\n");
		expect(parsed).not.toBeNull();
		expect(parsed?.frame).toBe(120);
		expect(parsed?.outTimeUs).toBe(2_000_000);
		expect(parsed?.completed).toBe(false);
	});

	it("detects progress=end as completion", () => {
		const parsed = parseFfmpegProgressChunk("frame=500\nprogress=end\n");
		expect(parsed?.completed).toBe(true);
	});

	it("returns null when no progress fields are present", () => {
		expect(parseFfmpegProgressChunk("Input #0, rawvideo, from 'pipe:0'")).toBeNull();
		expect(parseFfmpegProgressChunk("")).toBeNull();
	});
});

describe("inferHeartbeatStage", () => {
	it("treats no progress as prepare", () => {
		expect(inferHeartbeatStage(null)).toBe("prepare");
		expect(inferHeartbeatStage({ frame: 0, outTimeUs: 0, completed: false })).toBe("prepare");
	});

	it("treats flowing frames as encode", () => {
		expect(inferHeartbeatStage({ frame: 10, completed: false })).toBe("encode");
		expect(inferHeartbeatStage({ outTimeUs: 5000, completed: false })).toBe("encode");
	});

	it("treats completion as mux", () => {
		expect(inferHeartbeatStage({ frame: 999, completed: true })).toBe("mux");
	});
});

describe("NativeExportHeartbeatEmitter", () => {
	it("emits an increasing sequence for liveness", () => {
		const emitter = new NativeExportHeartbeatEmitter("s1", { minIntervalMs: 100 });
		const first = emitter.ingest("Opening encoder...", 0);
		const second = emitter.ingest("frame=10\nout_time_us=100000\n", 200);
		expect(first?.sequence).toBe(1);
		expect(second?.sequence).toBe(2);
		expect(second?.sessionId).toBe("s1");
	});

	it("throttles bursts of stderr chatter", () => {
		const emitter = new NativeExportHeartbeatEmitter("s1", { minIntervalMs: 1000 });
		expect(emitter.ingest("line a", 0)).not.toBeNull();
		expect(emitter.ingest("line b", 200)).toBeNull();
		expect(emitter.ingest("line c", 500)).toBeNull();
		expect(emitter.ingest("line d", 1100)).not.toBeNull();
	});

	it("counts bare ffmpeg output as a prepare heartbeat", () => {
		const emitter = new NativeExportHeartbeatEmitter("s1", { minIntervalMs: 0 });
		const hb = emitter.ingest("Stream mapping:", 0);
		expect(hb?.stage).toBe("prepare");
		expect(hb?.frame).toBeUndefined();
	});

	it("always emits on completion even when throttled", () => {
		const emitter = new NativeExportHeartbeatEmitter("s1", { minIntervalMs: 10_000 });
		expect(emitter.ingest("frame=1\n", 0)).not.toBeNull();
		const end = emitter.ingest("progress=end\n", 50);
		expect(end).not.toBeNull();
		expect(end?.stage).toBe("mux");
	});

	it("ignores empty chunks", () => {
		const emitter = new NativeExportHeartbeatEmitter("s1", { minIntervalMs: 0 });
		expect(emitter.ingest("", 0)).toBeNull();
		expect(emitter.ingest("   \n ", 0)).toBeNull();
	});
});
