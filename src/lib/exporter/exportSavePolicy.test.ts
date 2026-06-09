import { describe, expect, it } from "vitest";
import {
	canUseInMemoryExportSaveFallback,
	checkPreExportSize,
	describeBlockedInMemoryExportSave,
	estimateExportSizeBytes,
	isExportTooLargeForInMemorySave,
	MAX_IN_MEMORY_EXPORT_BYTES,
	normalizeExportExtension,
} from "./exportSavePolicy";

describe("exportSavePolicy", () => {
	it("normalizes export extensions before policy checks", () => {
		expect(normalizeExportExtension(" MP4 ")).toBe("mp4");
	});

	it("blocks the legacy in-memory save path above Node's Buffer limit", () => {
		expect(isExportTooLargeForInMemorySave(MAX_IN_MEMORY_EXPORT_BYTES + 1)).toBe(true);
		expect(
			canUseInMemoryExportSaveFallback({
				blobSize: MAX_IN_MEMORY_EXPORT_BYTES + 1,
				extension: "gif",
				hasExportStreamApi: false,
			}),
		).toBe(false);
	});

	it("keeps Electron MP4 exports on the temp-file save path", () => {
		expect(
			canUseInMemoryExportSaveFallback({
				blobSize: 1024,
				extension: "mp4",
				hasExportStreamApi: true,
			}),
		).toBe(false);
	});

	it("allows small non-MP4 exports to use the legacy save fallback", () => {
		expect(
			canUseInMemoryExportSaveFallback({
				blobSize: 1024,
				extension: "gif",
				hasExportStreamApi: false,
			}),
		).toBe(true);
	});

	it("explains blocked large saves without mentioning implementation stack traces", () => {
		expect(
			describeBlockedInMemoryExportSave({
				blobSize: MAX_IN_MEMORY_EXPORT_BYTES + 1,
				extension: "mp4",
			}),
		).toContain("too large");
	});
});

describe("estimateExportSizeBytes", () => {
	it("estimates from bitrate and duration with container overhead", () => {
		// 8 Mbit/s video + 128 kbit/s audio for 10s = ~10.16 MB before overhead
		const bytes = estimateExportSizeBytes({
			videoBitrateBitsPerSec: 8_000_000,
			audioBitrateBitsPerSec: 128_000,
			durationSec: 10,
			containerOverhead: 0,
		});
		expect(bytes).toBe(Math.ceil((8_128_000 * 10) / 8));
	});

	it("applies the overhead multiplier", () => {
		const base = estimateExportSizeBytes({
			videoBitrateBitsPerSec: 1_000_000,
			durationSec: 8,
			containerOverhead: 0,
		});
		const withOverhead = estimateExportSizeBytes({
			videoBitrateBitsPerSec: 1_000_000,
			durationSec: 8,
			containerOverhead: 0.04,
		});
		expect(withOverhead).toBeGreaterThan(base);
	});

	it("clamps invalid inputs to zero contribution", () => {
		expect(
			estimateExportSizeBytes({
				videoBitrateBitsPerSec: Number.NaN,
				durationSec: -5,
			}),
		).toBe(0);
	});
});

describe("checkPreExportSize", () => {
	it("allows exports under the in-memory cap", () => {
		const result = checkPreExportSize({
			estimatedBytes: 100 * 1024 * 1024,
			extension: "mp4",
			hasExportStreamApi: false,
		});
		expect(result.ok).toBe(true);
		expect(result.exceedsInMemoryCap).toBe(false);
		expect(result.reason).toBeNull();
	});

	it("allows oversized exports when a streaming save path exists", () => {
		const result = checkPreExportSize({
			estimatedBytes: MAX_IN_MEMORY_EXPORT_BYTES + 1,
			extension: "mp4",
			hasExportStreamApi: true,
		});
		expect(result.ok).toBe(true);
		expect(result.exceedsInMemoryCap).toBe(true);
		expect(result.reason).toBeNull();
	});

	it("blocks oversized exports before running when only in-memory save exists", () => {
		const result = checkPreExportSize({
			estimatedBytes: 3 * 1024 * 1024 * 1024,
			extension: "gif",
			hasExportStreamApi: false,
		});
		expect(result.ok).toBe(false);
		expect(result.exceedsInMemoryCap).toBe(true);
		expect(result.reason).toContain("GiB");
		expect(result.reason).toContain("GIF");
	});
});
