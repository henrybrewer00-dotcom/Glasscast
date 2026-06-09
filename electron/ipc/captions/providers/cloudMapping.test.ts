import { describe, expect, it } from "vitest";

import fixture from "./cloudMapping.fixture.json";
import {
	mapVerboseTranscriptionToCues,
	type VerboseTranscriptionResponse,
} from "./cloudMapping";

describe("mapVerboseTranscriptionToCues", () => {
	it("maps verbose_json segments into ms-based cues", () => {
		const cues = mapVerboseTranscriptionToCues(fixture as VerboseTranscriptionResponse);

		expect(cues).toHaveLength(2);
		expect(cues[0]).toMatchObject({
			id: "caption-1",
			startMs: 0,
			endMs: 1600,
			text: "Hello world.",
		});
		expect(cues[1]).toMatchObject({
			id: "caption-2",
			startMs: 1600,
			endMs: 4200,
			text: "This is a test.",
		});
	});

	it("distributes word timings into the containing cue", () => {
		const cues = mapVerboseTranscriptionToCues(fixture as VerboseTranscriptionResponse);

		expect(cues[0].words?.map((word) => word.text)).toEqual(["Hello", "world"]);
		expect(cues[1].words?.map((word) => word.text)).toEqual([
			"This",
			"is",
			"a",
			"test",
		]);
		expect(cues[0].words?.[0]).toMatchObject({ startMs: 0, endMs: 700 });
		expect(cues[0].words?.[1]).toMatchObject({
			startMs: 700,
			endMs: 1600,
			leadingSpace: true,
		});
	});

	it("ignores segments without valid timing", () => {
		const cues = mapVerboseTranscriptionToCues({
			segments: [
				{ start: 0, end: 0, text: "zero-length" },
				{ start: 1, end: 2, text: "valid" },
				{ start: 3, text: "missing end" },
			],
		});

		expect(cues).toHaveLength(1);
		expect(cues[0].text).toBe("valid");
	});

	it("returns an empty array when there are no segments", () => {
		expect(mapVerboseTranscriptionToCues({ text: "no segments" })).toEqual([]);
		expect(mapVerboseTranscriptionToCues({})).toEqual([]);
	});

	it("produces cues even when word timings are absent", () => {
		const cues = mapVerboseTranscriptionToCues({
			segments: [{ start: 0, end: 1.2, text: "no words" }],
		});

		expect(cues).toHaveLength(1);
		expect(cues[0].words).toBeUndefined();
	});
});
