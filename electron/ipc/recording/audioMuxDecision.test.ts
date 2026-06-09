import { describe, expect, it } from "vitest";
import {
	decideMacAudioMux,
	parseInlineAudioProbeOutput,
} from "./audioMuxDecision";

describe("decideMacAudioMux", () => {
	it("keeps the mic sidecar when the video has no inline audio", () => {
		const decision = decideMacAudioMux({
			probe: { hasInlineAudio: false },
			microphonePath: "/rec/clip.mic.m4a",
		});

		expect(decision.muxMicrophone).toBe(true);
		expect(decision.skipMicReason).toBeNull();
	});

	it("skips the mic sidecar when the video already carries inline audio (anti-echo)", () => {
		const decision = decideMacAudioMux({
			probe: { hasInlineAudio: true, inlineAudioCodec: "aac" },
			microphonePath: "/rec/clip.mic.m4a",
		});

		expect(decision.muxMicrophone).toBe(false);
		expect(decision.skipMicReason).toBe("inline-audio-present");
	});

	it("never marks a mux when there is no mic sidecar", () => {
		const decision = decideMacAudioMux({
			probe: { hasInlineAudio: false },
			microphonePath: null,
		});

		expect(decision.muxMicrophone).toBe(false);
		expect(decision.skipMicReason).toBe("no-sidecar");
	});

	it("keeps the system-audio sidecar regardless of inline audio", () => {
		const withInline = decideMacAudioMux({
			probe: { hasInlineAudio: true },
			systemAudioPath: "/rec/clip.system.m4a",
			microphonePath: "/rec/clip.mic.m4a",
		});
		const withoutInline = decideMacAudioMux({
			probe: { hasInlineAudio: false },
			systemAudioPath: "/rec/clip.system.m4a",
		});

		expect(withInline.keepSystemAudio).toBe(true);
		expect(withoutInline.keepSystemAudio).toBe(true);
	});

	it("does not keep system audio when no system sidecar exists", () => {
		const decision = decideMacAudioMux({
			probe: { hasInlineAudio: false },
			microphonePath: "/rec/clip.mic.m4a",
		});

		expect(decision.keepSystemAudio).toBe(false);
	});
});

describe("parseInlineAudioProbeOutput", () => {
	it("detects inline audio from ffprobe [STREAM] blocks", () => {
		const output = [
			"[STREAM]",
			"codec_name=h264",
			"codec_type=video",
			"[/STREAM]",
			"[STREAM]",
			"codec_name=aac",
			"codec_type=audio",
			"[/STREAM]",
		].join("\n");

		const probe = parseInlineAudioProbeOutput(output);
		expect(probe.hasInlineAudio).toBe(true);
		expect(probe.inlineAudioCodec).toBe("aac");
	});

	it("returns no inline audio for a video-only container", () => {
		const output = ["[STREAM]", "codec_name=h264", "codec_type=video", "[/STREAM]"].join(
			"\n",
		);

		const probe = parseInlineAudioProbeOutput(output);
		expect(probe.hasInlineAudio).toBe(false);
		expect(probe.inlineAudioCodec).toBeNull();
	});

	it("handles empty or whitespace output", () => {
		expect(parseInlineAudioProbeOutput("").hasInlineAudio).toBe(false);
		expect(parseInlineAudioProbeOutput("   \n  ").hasInlineAudio).toBe(false);
	});

	it("detects inline audio from compact codec_type token output", () => {
		const probe = parseInlineAudioProbeOutput("codec_type=audio");
		expect(probe.hasInlineAudio).toBe(true);
	});
});
