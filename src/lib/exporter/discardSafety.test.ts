import { describe, expect, it } from "vitest";
import {
	buildDiscardRecoveryNote,
	computeTrashDestinationPath,
	DISCARD_CONFIRM_PHRASE,
	evaluateDiscardGate,
	TRASH_DIR_NAME,
} from "./discardSafety";

describe("evaluateDiscardGate", () => {
	it("requires a first confirmation when idle", () => {
		const decision = evaluateDiscardGate({ processingActive: false });
		expect(decision.allowed).toBe(false);
		if (!decision.allowed) {
			expect(decision.reason).toBe("needs-first-confirm");
			expect(decision.requiredTypedConfirmation).toBe(false);
		}
	});

	it("allows an idle discard after first confirmation", () => {
		const decision = evaluateDiscardGate({
			processingActive: false,
			firstConfirmationAcknowledged: true,
		});
		expect(decision.allowed).toBe(true);
	});

	it("demands a typed confirmation while processing", () => {
		const needsTyped = evaluateDiscardGate({
			processingActive: true,
			firstConfirmationAcknowledged: true,
			typedConfirmation: "",
		});
		expect(needsTyped.allowed).toBe(false);
		if (!needsTyped.allowed) {
			expect(needsTyped.reason).toBe("needs-typed-confirm");
			expect(needsTyped.requiredTypedConfirmation).toBe(true);
		}
	});

	it("rejects a mismatched typed confirmation", () => {
		const decision = evaluateDiscardGate({
			processingActive: true,
			firstConfirmationAcknowledged: true,
			typedConfirmation: "delete",
		});
		expect(decision.allowed).toBe(false);
		if (!decision.allowed) {
			expect(decision.reason).toBe("typed-confirm-mismatch");
		}
	});

	it("accepts the exact phrase (case-insensitive, trimmed) while processing", () => {
		const decision = evaluateDiscardGate({
			processingActive: true,
			firstConfirmationAcknowledged: true,
			typedConfirmation: `  ${DISCARD_CONFIRM_PHRASE.toLowerCase()}  `,
		});
		expect(decision.allowed).toBe(true);
	});

	it("requires the first acknowledgement even while processing", () => {
		const decision = evaluateDiscardGate({
			processingActive: true,
			firstConfirmationAcknowledged: false,
			typedConfirmation: DISCARD_CONFIRM_PHRASE,
		});
		expect(decision.allowed).toBe(false);
		if (!decision.allowed) {
			expect(decision.reason).toBe("needs-first-confirm");
			expect(decision.requiredTypedConfirmation).toBe(true);
		}
	});
});

describe("computeTrashDestinationPath", () => {
	it("moves a posix recording into a sibling .trash folder with a timestamp", () => {
		const { trashDir, destinationPath } = computeTrashDestinationPath(
			"/Users/me/Recordings/clip.mp4",
			1700000000000,
		);
		expect(trashDir).toBe(`/Users/me/Recordings/${TRASH_DIR_NAME}`);
		expect(destinationPath).toBe(
			`/Users/me/Recordings/${TRASH_DIR_NAME}/1700000000000-clip.mp4`,
		);
	});

	it("handles windows-style paths", () => {
		const { trashDir, destinationPath } = computeTrashDestinationPath(
			"C:\\Users\\me\\Recordings\\clip.mp4",
			42,
		);
		expect(trashDir).toBe(`C:\\Users\\me\\Recordings\\${TRASH_DIR_NAME}`);
		expect(destinationPath).toBe(
			`C:\\Users\\me\\Recordings\\${TRASH_DIR_NAME}\\42-clip.mp4`,
		);
	});

	it("handles a bare filename with no directory", () => {
		const { trashDir, destinationPath } = computeTrashDestinationPath("clip.mp4", 7);
		expect(trashDir).toBe(TRASH_DIR_NAME);
		expect(destinationPath).toBe(`${TRASH_DIR_NAME}/7-clip.mp4`);
	});
});

describe("buildDiscardRecoveryNote", () => {
	it("points at the moved file and the trash folder", () => {
		const note = buildDiscardRecoveryNote("/Users/me/Recordings/.trash/123-clip.mp4");
		expect(note).toContain("/Users/me/Recordings/.trash/123-clip.mp4");
		expect(note).toContain(TRASH_DIR_NAME);
	});
});
