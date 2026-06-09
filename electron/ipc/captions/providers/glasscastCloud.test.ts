import { describe, expect, it } from "vitest";
import { buildGlasscastTranscriptionForm } from "./glasscastCloud";

function bytes(text: string): ArrayBuffer {
	return new TextEncoder().encode(text).buffer;
}

describe("buildGlasscastTranscriptionForm", () => {
	it("includes the file, model and a real language", () => {
		const form = buildGlasscastTranscriptionForm(bytes("wav"), "clip.wav", "fast", "en");
		expect(form.get("model")).toBe("fast");
		expect(form.get("language")).toBe("en");
		const file = form.get("file");
		expect(file).toBeInstanceOf(Blob);
		expect((file as File).name ?? "clip.wav").toBeTruthy();
	});

	it("omits the language field when auto-detecting", () => {
		const form = buildGlasscastTranscriptionForm(bytes("wav"), "clip.wav", "auto", "auto");
		expect(form.has("language")).toBe(false);
	});

	it("omits the language field when none is supplied", () => {
		const form = buildGlasscastTranscriptionForm(bytes("wav"), "clip.wav", "auto");
		expect(form.has("language")).toBe(false);
	});
});
