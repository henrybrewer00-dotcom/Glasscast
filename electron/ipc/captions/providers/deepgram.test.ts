import { describe, expect, it } from "vitest";
import { mapVerboseTranscriptionToCues } from "./cloudMapping";
import { type DeepgramResponse, mapDeepgramResponseToVerbose } from "./deepgram";

describe("mapDeepgramResponseToVerbose", () => {
	it("maps utterances into verbose segments with second-based timings", () => {
		const payload: DeepgramResponse = {
			results: {
				utterances: [
					{
						transcript: "Hello there.",
						start: 0,
						end: 1.2,
						words: [
							{ punctuated_word: "Hello", start: 0, end: 0.5 },
							{ punctuated_word: "there.", start: 0.6, end: 1.2 },
						],
					},
					{
						transcript: "General Kenobi.",
						start: 1.5,
						end: 2.8,
						words: [
							{ word: "General", start: 1.5, end: 2.0 },
							{ word: "Kenobi", start: 2.1, end: 2.8 },
						],
					},
				],
			},
		};

		const verbose = mapDeepgramResponseToVerbose(payload);
		expect(verbose.segments).toHaveLength(2);
		expect(verbose.segments?.[0]).toMatchObject({ start: 0, end: 1.2, text: "Hello there." });
		expect(verbose.words).toHaveLength(4);
		// Prefers punctuated_word when present.
		expect(verbose.words?.[1]?.word).toBe("there.");

		// And the shared mapper turns it into real cues with word-level timing.
		const cues = mapVerboseTranscriptionToCues(verbose);
		expect(cues).toHaveLength(2);
		expect(cues[0].startMs).toBe(0);
		expect(cues[0].endMs).toBe(1200);
		expect(cues[0].words?.length).toBe(2);
	});

	it("falls back to the channel alternative when there are no utterances", () => {
		const payload: DeepgramResponse = {
			results: {
				channels: [
					{
						alternatives: [
							{
								transcript: "single line transcript",
								words: [
									{ word: "single", start: 0.1, end: 0.4 },
									{ word: "line", start: 0.4, end: 0.7 },
									{ word: "transcript", start: 0.7, end: 1.3 },
								],
							},
						],
					},
				],
			},
		};

		const verbose = mapDeepgramResponseToVerbose(payload);
		expect(verbose.segments).toHaveLength(1);
		expect(verbose.segments?.[0]?.start).toBe(0.1);
		expect(verbose.segments?.[0]?.end).toBe(1.3);
		expect(verbose.segments?.[0]?.text).toBe("single line transcript");
		expect(verbose.words).toHaveLength(3);
	});

	it("returns empty output for an empty response", () => {
		expect(mapDeepgramResponseToVerbose({}).segments).toEqual([]);
		expect(mapDeepgramResponseToVerbose({ results: {} }).segments).toEqual([]);
		expect(
			mapDeepgramResponseToVerbose({
				results: { channels: [{ alternatives: [{ transcript: "" }] }] },
			}).segments,
		).toEqual([]);
	});

	it("drops blank words and skips utterances without valid timings", () => {
		const payload: DeepgramResponse = {
			results: {
				utterances: [
					{
						transcript: "ok",
						start: 0,
						end: 0.5,
						words: [{ word: "  ", start: 0, end: 0.5 }],
					},
					{ transcript: "no timing" },
				],
			},
		};
		const verbose = mapDeepgramResponseToVerbose(payload);
		expect(verbose.segments).toHaveLength(1);
		expect(verbose.words).toHaveLength(0);
	});
});
