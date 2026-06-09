/**
 * Discard-safety pure logic.
 *
 * Mission context: a 2-hour recording was lost when "Discard and Close" was
 * pressed while the recording was still processing (issue #633). The fix has
 * three pure pieces (the actual fs move + confirmation UI live in the
 * recording / project IPC + the video-editor component, which consume these
 * helpers):
 *
 *  1. Require a strong, typed-confirmation gate when discard is requested while
 *     processing is active.
 *  2. Move discarded files into a recoverable `.trash` folder inside the
 *     recordings directory instead of deleting them outright.
 *  3. Produce a recovery note for the error/confirmation path so the user knows
 *     where to find the file.
 *
 * All functions here are pure and synchronous so they can be unit tested without
 * Electron / fs.
 */

export const DISCARD_CONFIRM_PHRASE = "DISCARD";
export const TRASH_DIR_NAME = ".trash";

export interface DiscardGateInput {
	/** True while the recording is still finalizing / exporting / muxing. */
	processingActive: boolean;
	/**
	 * The exact text the user typed to confirm. Only consulted when processing
	 * is active (the typed-confirm double-confirmation).
	 */
	typedConfirmation?: string | null;
	/** True when the user has acknowledged the first plain confirmation dialog. */
	firstConfirmationAcknowledged?: boolean;
}

export type DiscardGateDecision =
	| { allowed: true; requiredTypedConfirmation: false }
	| {
			allowed: false;
			requiredTypedConfirmation: boolean;
			reason: "needs-first-confirm" | "needs-typed-confirm" | "typed-confirm-mismatch";
	  };

/**
 * Decide whether a discard may proceed.
 *
 * - When nothing is processing, a single (UI-level) confirmation is enough and
 *   this returns `allowed` once `firstConfirmationAcknowledged` is true.
 * - When processing is active, the user must ALSO type the exact
 *   {@link DISCARD_CONFIRM_PHRASE}; a mismatch or empty value blocks the discard.
 */
export function evaluateDiscardGate(input: DiscardGateInput): DiscardGateDecision {
	const acknowledged = input.firstConfirmationAcknowledged === true;

	if (!input.processingActive) {
		if (!acknowledged) {
			return {
				allowed: false,
				requiredTypedConfirmation: false,
				reason: "needs-first-confirm",
			};
		}
		return { allowed: true, requiredTypedConfirmation: false };
	}

	// Processing is active: demand a typed confirmation (double confirmation).
	if (!acknowledged) {
		return {
			allowed: false,
			requiredTypedConfirmation: true,
			reason: "needs-first-confirm",
		};
	}

	const typed = (input.typedConfirmation ?? "").trim();
	if (typed.length === 0) {
		return {
			allowed: false,
			requiredTypedConfirmation: true,
			reason: "needs-typed-confirm",
		};
	}

	if (typed.toUpperCase() !== DISCARD_CONFIRM_PHRASE) {
		return {
			allowed: false,
			requiredTypedConfirmation: true,
			reason: "typed-confirm-mismatch",
		};
	}

	return { allowed: true, requiredTypedConfirmation: false };
}

function getPathSeparator(filePath: string): "/" | "\\" {
	// Prefer backslash only when the path clearly uses Windows separators.
	if (filePath.includes("\\") && !filePath.includes("/")) {
		return "\\";
	}
	return "/";
}

function splitParentAndName(filePath: string): { dir: string; name: string } {
	const separatorIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
	if (separatorIndex < 0) {
		return { dir: "", name: filePath };
	}
	return {
		dir: filePath.slice(0, separatorIndex),
		name: filePath.slice(separatorIndex + 1),
	};
}

/**
 * Compute the recoverable trash destination for a discarded recording file.
 * Files are moved into a `.trash` folder beside the recording, with a timestamp
 * prefix so repeated discards of same-named files do not collide.
 *
 * `timestampMs` is injected (not read from `Date.now()`) to keep this pure and
 * testable.
 */
export function computeTrashDestinationPath(
	sourcePath: string,
	timestampMs: number,
): { trashDir: string; destinationPath: string } {
	const separator = getPathSeparator(sourcePath);
	const { dir, name } = splitParentAndName(sourcePath);
	const trashDir = dir.length > 0 ? `${dir}${separator}${TRASH_DIR_NAME}` : TRASH_DIR_NAME;
	const safeTimestamp = Number.isFinite(timestampMs) ? Math.floor(timestampMs) : 0;
	const destinationPath = `${trashDir}${separator}${safeTimestamp}-${name}`;
	return { trashDir, destinationPath };
}

/**
 * Build a user-facing recovery note pointing at the moved file so a discard
 * during processing never reads as permanent data loss.
 */
export function buildDiscardRecoveryNote(destinationPath: string): string {
	return `Your recording was moved to a recoverable location instead of being deleted: ${destinationPath}. If this was a mistake, you can restore it from the ${TRASH_DIR_NAME} folder in your recordings directory.`;
}
