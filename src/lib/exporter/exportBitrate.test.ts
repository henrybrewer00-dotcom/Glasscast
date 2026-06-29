import { describe, expect, it } from "vitest";
import { getMp4ExportBitrate, getSourceQualityBitrate } from "./exportBitrate";

describe("export bitrate policy", () => {
	it("keeps the legacy source-quality bitrate unchanged", () => {
		expect(getSourceQualityBitrate(1920, 1080)).toBe(30_000_000);
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
			}),
		).toBe(27_000_000);
	});

	it("raises high-resolution 60fps source-quality exports above the 30fps budget", () => {
		const sharedOptions = {
			width: 2560,
			height: 1440,
			quality: "source" as const,
			encodingMode: "quality" as const,
		};

		const thirtyFpsBitrate = getMp4ExportBitrate({
			...sharedOptions,
			frameRate: 30,
		});
		const sixtyFpsBitrate = getMp4ExportBitrate({
			...sharedOptions,
			frameRate: 60,
		});

		expect(thirtyFpsBitrate).toBe(45_000_000);
		expect(sixtyFpsBitrate).toBeGreaterThan(thirtyFpsBitrate);
		expect(sixtyFpsBitrate).toBe(63_639_610);
	});

	it("keeps modern native static-layout source exports high enough for screen text", () => {
		// Source quality keeps a high effective bitrate even on the Balanced default
		// (the encoding toggle no longer silently halves "best settings").
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "balanced",
				useModernNativeStaticLayout: true,
			}),
		).toBe(25_500_000);
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
				useModernNativeStaticLayout: true,
			}),
		).toBe(27_000_000);
	});

	it("scales modern native static-layout source exports at 60fps", () => {
		const sharedOptions = {
			width: 1920,
			height: 1080,
			quality: "source" as const,
			encodingMode: "quality" as const,
			useModernNativeStaticLayout: true,
		};

		const thirtyFpsBitrate = getMp4ExportBitrate({
			...sharedOptions,
			frameRate: 30,
		});
		const sixtyFpsBitrate = getMp4ExportBitrate({
			...sharedOptions,
			frameRate: 60,
		});

		expect(thirtyFpsBitrate).toBe(27_000_000);
		expect(sixtyFpsBitrate).toBeGreaterThan(thirtyFpsBitrate);
		expect(sixtyFpsBitrate).toBe(38_183_766);
	});

	it("does not raise fast exports when the requested bitrate is already lower than the cap", () => {
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "fast",
				useModernNativeStaticLayout: true,
			}),
		).toBe(3_000_000);
	});

	it("keeps top quality presets sharp on the Balanced default (webcodecs path)", () => {
		// source: base 30M * fr 1.0 * floor 0.85 = 25.5M (vs 15M before the floor).
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "balanced",
			}),
		).toBe(25_500_000);
		// high: base 20M * fr 1.0 * floor 0.6 = 12M (vs 10M before the floor).
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "high",
				encodingMode: "balanced",
			}),
		).toBe(12_000_000);
	});

	it("leaves Fast as an explicit speed/size escape hatch even at top quality", () => {
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "fast",
			}),
		).toBe(3_000_000);
	});

	it("does not change lower quality presets", () => {
		// good: base 20M * 0.5 (no floor) = 10M.
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "good",
				encodingMode: "balanced",
			}),
		).toBe(10_000_000);
	});

	it("scales the modern native cap with output pixel rate", () => {
		expect(
			getMp4ExportBitrate({
				width: 3840,
				height: 2160,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
				useModernNativeStaticLayout: true,
			}),
		).toBe(72_000_000);
	});
});
