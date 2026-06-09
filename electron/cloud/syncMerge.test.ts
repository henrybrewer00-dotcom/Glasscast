import { describe, expect, it } from "vitest";
import {
	dequeuePush,
	enqueuePush,
	markPushFailed,
	mergeApiKeys,
	mergeSettings,
	parseUpdatedAt,
	resolveLastWriteWins,
	type KeyRecord,
	type QueuedPush,
	type SettingsSnapshot,
} from "./syncMerge";

describe("parseUpdatedAt", () => {
	it("returns epoch millis from a number", () => {
		expect(parseUpdatedAt(1700000000000)).toBe(1700000000000);
	});

	it("parses an ISO string", () => {
		expect(parseUpdatedAt("2024-01-15T10:30:00.000Z")).toBe(
			Date.parse("2024-01-15T10:30:00.000Z"),
		);
	});

	it("returns 0 for missing or unparseable values", () => {
		expect(parseUpdatedAt(undefined)).toBe(0);
		expect(parseUpdatedAt(null)).toBe(0);
		expect(parseUpdatedAt("not a date")).toBe(0);
		expect(parseUpdatedAt("")).toBe(0);
		expect(parseUpdatedAt(Number.NaN)).toBe(0);
	});
});

describe("resolveLastWriteWins", () => {
	it("picks the newer side", () => {
		expect(resolveLastWriteWins(20, 10)).toBe("local");
		expect(resolveLastWriteWins(10, 20)).toBe("remote");
	});

	it("prefers local on a tie", () => {
		expect(resolveLastWriteWins(10, 10)).toBe("equal");
	});
});

describe("mergeSettings", () => {
	const local: SettingsSnapshot = { settings: { theme: "dark" }, updatedAt: 100 };
	const remote: SettingsSnapshot = { settings: { theme: "light" }, updatedAt: 50 };

	it("pushes local when there is no remote", () => {
		const result = mergeSettings(local, null);
		expect(result.resolution).toBe("local");
		expect(result.shouldPushRemote).toBe(true);
		expect(result.shouldWriteLocal).toBe(false);
		expect(result.settings).toEqual({ theme: "dark" });
	});

	it("pulls remote when there is no local", () => {
		const result = mergeSettings(null, remote);
		expect(result.resolution).toBe("remote");
		expect(result.shouldWriteLocal).toBe(true);
		expect(result.shouldPushRemote).toBe(false);
		expect(result.settings).toEqual({ theme: "light" });
	});

	it("returns empty no-op when both sides are absent", () => {
		const result = mergeSettings(null, null);
		expect(result.resolution).toBe("equal");
		expect(result.shouldWriteLocal).toBe(false);
		expect(result.shouldPushRemote).toBe(false);
	});

	it("newer local wins and is pushed", () => {
		const result = mergeSettings(local, remote);
		expect(result.resolution).toBe("local");
		expect(result.shouldPushRemote).toBe(true);
		expect(result.settings).toEqual({ theme: "dark" });
	});

	it("newer remote wins and is written locally", () => {
		const result = mergeSettings(
			{ settings: { theme: "dark" }, updatedAt: 10 },
			{ settings: { theme: "light" }, updatedAt: 90 },
		);
		expect(result.resolution).toBe("remote");
		expect(result.shouldWriteLocal).toBe(true);
		expect(result.settings).toEqual({ theme: "light" });
	});

	it("treats equal timestamps as a no-op favouring local", () => {
		const result = mergeSettings(
			{ settings: { theme: "dark" }, updatedAt: 42 },
			{ settings: { theme: "light" }, updatedAt: 42 },
		);
		expect(result.resolution).toBe("equal");
		expect(result.shouldWriteLocal).toBe(false);
		expect(result.shouldPushRemote).toBe(false);
		expect(result.settings).toEqual({ theme: "dark" });
	});
});

describe("mergeApiKeys", () => {
	const k = (provider: string, keyValue: string, updatedAt: number, label?: string): KeyRecord => ({
		provider,
		keyValue,
		updatedAt,
		label,
	});

	it("pushes local-only keys", () => {
		const result = mergeApiKeys([k("openai", "sk-local", 100)], []);
		expect(result.toPushRemote).toHaveLength(1);
		expect(result.toPushRemote[0].provider).toBe("openai");
		expect(result.toWriteLocal).toHaveLength(0);
	});

	it("writes remote-only keys locally", () => {
		const result = mergeApiKeys([], [k("anthropic", "sk-remote", 100)]);
		expect(result.toWriteLocal).toHaveLength(1);
		expect(result.toWriteLocal[0].provider).toBe("anthropic");
		expect(result.toPushRemote).toHaveLength(0);
	});

	it("resolves conflicts by newest timestamp", () => {
		const result = mergeApiKeys(
			[k("openai", "sk-new", 200)],
			[k("openai", "sk-old", 100)],
		);
		expect(result.toPushRemote).toHaveLength(1);
		expect(result.toPushRemote[0].keyValue).toBe("sk-new");
		expect(result.toWriteLocal).toHaveLength(0);
	});

	it("pulls remote when it is newer", () => {
		const result = mergeApiKeys(
			[k("openai", "sk-old", 100)],
			[k("openai", "sk-new", 200)],
		);
		expect(result.toWriteLocal).toHaveLength(1);
		expect(result.toWriteLocal[0].keyValue).toBe("sk-new");
		expect(result.toPushRemote).toHaveLength(0);
	});

	it("does nothing when identical values are in sync", () => {
		const result = mergeApiKeys(
			[k("openai", "sk-same", 100, "Prod")],
			[k("openai", "sk-same", 100, "Prod")],
		);
		expect(result.toPushRemote).toHaveLength(0);
		expect(result.toWriteLocal).toHaveLength(0);
	});

	it("pushes when only the label differs and local is newer", () => {
		const result = mergeApiKeys(
			[k("openai", "sk-same", 200, "Renamed")],
			[k("openai", "sk-same", 100, "Old")],
		);
		expect(result.toPushRemote).toHaveLength(1);
		expect(result.toPushRemote[0].label).toBe("Renamed");
	});
});

describe("offline retry queue", () => {
	const base: Omit<QueuedPush, "attempts"> = {
		kind: "settings",
		id: "app-settings",
		payload: null,
		enqueuedAt: 1,
	};

	it("collapses duplicate (kind,id) keeping the latest payload", () => {
		let queue: QueuedPush[] = [];
		queue = enqueuePush(queue, { ...base, payload: { v: 1 } });
		queue = enqueuePush(queue, { ...base, payload: { v: 2 }, enqueuedAt: 2 });
		expect(queue).toHaveLength(1);
		expect(queue[0].payload).toEqual({ v: 2 });
		expect(queue[0].enqueuedAt).toBe(2);
	});

	it("keeps distinct ids separate", () => {
		let queue: QueuedPush[] = [];
		queue = enqueuePush(queue, { ...base, kind: "apiKey", id: "apiKey:openai" });
		queue = enqueuePush(queue, { ...base, kind: "apiKey", id: "apiKey:anthropic" });
		expect(queue).toHaveLength(2);
	});

	it("does not mutate the input array", () => {
		const queue: QueuedPush[] = [];
		const next = enqueuePush(queue, base);
		expect(queue).toHaveLength(0);
		expect(next).toHaveLength(1);
	});

	it("dequeues a delivered push", () => {
		let queue: QueuedPush[] = [];
		queue = enqueuePush(queue, base);
		queue = dequeuePush(queue, "settings", "app-settings");
		expect(queue).toHaveLength(0);
	});

	it("increments attempts on failure", () => {
		let queue: QueuedPush[] = [];
		queue = enqueuePush(queue, base);
		queue = markPushFailed(queue, "settings", "app-settings");
		expect(queue[0].attempts).toBe(1);
		queue = markPushFailed(queue, "settings", "app-settings");
		expect(queue[0].attempts).toBe(2);
	});

	it("drops a push after exceeding max attempts", () => {
		let queue: QueuedPush[] = [];
		queue = enqueuePush(queue, base);
		for (let i = 0; i < 3; i++) {
			queue = markPushFailed(queue, "settings", "app-settings", 3);
		}
		expect(queue).toHaveLength(0);
	});

	it("leaves other pushes untouched when one fails", () => {
		let queue: QueuedPush[] = [];
		queue = enqueuePush(queue, { ...base, kind: "apiKey", id: "apiKey:openai" });
		queue = enqueuePush(queue, base);
		queue = markPushFailed(queue, "settings", "app-settings");
		expect(queue).toHaveLength(2);
		const other = queue.find((q) => q.id === "apiKey:openai");
		expect(other?.attempts).toBe(0);
	});
});
