export const MAX_IN_MEMORY_EXPORT_BYTES = 0x7fffffff;

/**
 * Estimate the encoded output size (bytes) for a video export from its target
 * video bitrate, audio bitrate and effective duration. This is intentionally a
 * conservative upper-ish estimate: container overhead is folded in via a small
 * multiplier so a borderline export is flagged *before* it runs rather than
 * failing mid-write (issue context: 2 GiB in-memory save cap).
 */
export function estimateExportSizeBytes({
	videoBitrateBitsPerSec,
	audioBitrateBitsPerSec = 0,
	durationSec,
	containerOverhead = 0.04,
}: {
	videoBitrateBitsPerSec: number;
	audioBitrateBitsPerSec?: number;
	durationSec: number;
	containerOverhead?: number;
}): number {
	const safeVideoBitrate =
		Number.isFinite(videoBitrateBitsPerSec) && videoBitrateBitsPerSec > 0
			? videoBitrateBitsPerSec
			: 0;
	const safeAudioBitrate =
		Number.isFinite(audioBitrateBitsPerSec) && audioBitrateBitsPerSec > 0
			? audioBitrateBitsPerSec
			: 0;
	const safeDuration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
	const safeOverhead =
		Number.isFinite(containerOverhead) && containerOverhead >= 0 ? containerOverhead : 0;

	const totalBits = (safeVideoBitrate + safeAudioBitrate) * safeDuration;
	const totalBytes = totalBits / 8;
	return Math.ceil(totalBytes * (1 + safeOverhead));
}

export interface PreExportSizeCheckInput {
	estimatedBytes: number;
	extension: string;
	/** True when a streaming temp-file save path is available (Electron). */
	hasExportStreamApi: boolean;
}

export interface PreExportSizeCheckResult {
	/** True when the export can proceed. */
	ok: boolean;
	/**
	 * When `ok` is false, a clear, user-facing reason the export was blocked
	 * before it started.
	 */
	reason: string | null;
	/** True when the estimate exceeds the in-memory (non-streaming) cap. */
	exceedsInMemoryCap: boolean;
}

/**
 * Pre-export guard for the 2 GiB in-memory save cap.
 *
 * - If a streaming temp-file save path is available (Electron), large exports
 *   are fine — they never go through the in-memory Buffer — so the export
 *   proceeds.
 * - If only the legacy in-memory path exists and the estimate exceeds the cap,
 *   we block *before* export with a clear message rather than letting the
 *   export run for minutes and then fail at the save step.
 */
export function checkPreExportSize({
	estimatedBytes,
	extension,
	hasExportStreamApi,
}: PreExportSizeCheckInput): PreExportSizeCheckResult {
	const exceedsInMemoryCap = isExportTooLargeForInMemorySave(estimatedBytes);

	if (!exceedsInMemoryCap) {
		return { ok: true, reason: null, exceedsInMemoryCap: false };
	}

	// Streaming save path keeps large exports off the in-memory cap entirely.
	if (hasExportStreamApi) {
		return { ok: true, reason: null, exceedsInMemoryCap: true };
	}

	const normalizedExtension = normalizeExportExtension(extension) || "export";
	const estimatedGiB = (estimatedBytes / (1024 * 1024 * 1024)).toFixed(2);
	return {
		ok: false,
		exceedsInMemoryCap: true,
		reason: `This ${normalizedExtension.toUpperCase()} export is estimated at about ${estimatedGiB} GiB, which exceeds the ${(
			MAX_IN_MEMORY_EXPORT_BYTES /
			(1024 * 1024 * 1024)
		).toFixed(
			2,
		)} GiB limit for in-memory saving on this platform. Trim the recording, lower the bitrate/resolution, or export a shorter range.`,
	};
}

export function normalizeExportExtension(extension: string): string {
	return extension.trim().toLowerCase();
}

export function isExportTooLargeForInMemorySave(byteLength: number): boolean {
	return byteLength > MAX_IN_MEMORY_EXPORT_BYTES;
}

export function canUseInMemoryExportSaveFallback({
	blobSize,
	extension,
	hasExportStreamApi,
}: {
	blobSize: number;
	extension: string;
	hasExportStreamApi: boolean;
}): boolean {
	if (isExportTooLargeForInMemorySave(blobSize)) {
		return false;
	}

	// In Electron, MP4 exports should stay on the temp-file path. If that path
	// failed, silently falling back to ArrayBuffer reintroduces the >2 GiB crash.
	if (hasExportStreamApi && normalizeExportExtension(extension) === "mp4") {
		return false;
	}

	return true;
}

export function describeBlockedInMemoryExportSave({
	blobSize,
	extension,
}: {
	blobSize: number;
	extension: string;
}): string {
	const normalizedExtension = normalizeExportExtension(extension) || "export";
	if (isExportTooLargeForInMemorySave(blobSize)) {
		return `The ${normalizedExtension.toUpperCase()} export is too large to save through the legacy in-memory path. Please retry the export so Glasscast can save it through the temp-file streaming path.`;
	}

	return `The ${normalizedExtension.toUpperCase()} export could not be saved through the temp-file streaming path, and Glasscast will not fall back to the legacy in-memory path for MP4 exports. Please retry the export.`;
}
