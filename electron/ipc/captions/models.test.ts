import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => process.env.TEMP ?? process.cwd()),
		setPath: vi.fn(),
		getAppPath: vi.fn(() => process.cwd()),
	},
}));

import {
	DEFAULT_WHISPER_MODEL_ID,
	getWhisperModel,
	getWhisperModelPath,
	isWhisperModelId,
	WHISPER_MODEL_IDS,
	WHISPER_MODELS,
} from "./models";

describe("WHISPER_MODELS registry", () => {
	it("exposes the expected model ids", () => {
		expect(WHISPER_MODEL_IDS).toEqual([
			"tiny",
			"base",
			"small",
			"medium",
			"large-v3-turbo",
		]);
	});

	it("gives every descriptor a complete, well-formed shape", () => {
		for (const id of WHISPER_MODEL_IDS) {
			const model = WHISPER_MODELS[id];
			expect(model.id).toBe(id);
			expect(typeof model.label).toBe("string");
			expect(model.label.length).toBeGreaterThan(0);
			expect(model.fileName).toMatch(/^ggml-.*\.bin$/);
			expect(model.downloadUrl).toBe(
				`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${model.fileName}`,
			);
			expect(model.sizeBytes).toBeGreaterThan(0);
			expect(Number.isInteger(model.sizeBytes)).toBe(true);
		}
	});

	it("keeps the legacy small model file name + default", () => {
		expect(DEFAULT_WHISPER_MODEL_ID).toBe("small");
		expect(WHISPER_MODELS.small.fileName).toBe("ggml-small.bin");
	});

	it("resolves the small model to the legacy on-disk path", () => {
		const smallPath = getWhisperModelPath("small");
		expect(smallPath.endsWith("ggml-small.bin")).toBe(true);
	});

	it("resolves non-small models into the whisper model directory", () => {
		const tinyPath = getWhisperModelPath("tiny");
		expect(tinyPath.endsWith("ggml-tiny.bin")).toBe(true);
	});

	it("validates model ids", () => {
		expect(isWhisperModelId("small")).toBe(true);
		expect(isWhisperModelId("large-v3-turbo")).toBe(true);
		expect(isWhisperModelId("nope")).toBe(false);
		expect(isWhisperModelId(undefined)).toBe(false);
	});

	it("throws for unknown model ids", () => {
		expect(() => getWhisperModel("bogus")).toThrow(/Unknown Whisper model/);
	});
});
