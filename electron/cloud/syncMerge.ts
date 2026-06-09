/**
 * Pure, side-effect-free logic for the cloud sync engine.
 *
 * Kept separate from {@link ./syncEngine} so the last-write-wins merge and the
 * offline retry queue can be unit-tested without Electron, fetch, or the
 * filesystem.
 */

// ── Timestamps ───────────────────────────────────────────────────────────────

/**
 * Parse an `updated_at` value (ISO string or epoch millis) into epoch millis.
 * Returns 0 when the value is missing or unparseable so it always loses a
 * last-write-wins comparison against any real timestamp.
 */
export function parseUpdatedAt(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.length > 0) {
		const ms = Date.parse(value);
		if (!Number.isNaN(ms)) return ms;
	}
	return 0;
}

export type MergeResolution = "local" | "remote" | "equal";

/**
 * Last-write-wins resolution by timestamp. When timestamps are equal the local
 * value wins (the user just acted on this device, so prefer their intent and
 * avoid clobbering an in-flight local change).
 */
export function resolveLastWriteWins(localUpdatedAt: number, remoteUpdatedAt: number): MergeResolution {
	if (localUpdatedAt > remoteUpdatedAt) return "local";
	if (remoteUpdatedAt > localUpdatedAt) return "remote";
	return "equal";
}

// ── Settings blob merge ──────────────────────────────────────────────────────

export interface SettingsSnapshot<T = Record<string, unknown>> {
	settings: T;
	updatedAt: number;
}

export interface SettingsMergeResult<T = Record<string, unknown>> {
	/** Which side won. */
	resolution: MergeResolution;
	/** The winning settings payload. */
	settings: T;
	/** Whether the local store should be overwritten with the remote payload. */
	shouldWriteLocal: boolean;
	/** Whether the remote row should be overwritten with the local payload. */
	shouldPushRemote: boolean;
}

/**
 * Merge a local settings snapshot against a remote one using last-write-wins.
 *
 * - No remote yet  → push local.
 * - No local yet   → pull remote.
 * - Otherwise      → newer timestamp wins; the loser is updated to match.
 */
export function mergeSettings<T = Record<string, unknown>>(
	local: SettingsSnapshot<T> | null,
	remote: SettingsSnapshot<T> | null,
): SettingsMergeResult<T> {
	if (!remote && local) {
		return {
			resolution: "local",
			settings: local.settings,
			shouldWriteLocal: false,
			shouldPushRemote: true,
		};
	}
	if (remote && !local) {
		return {
			resolution: "remote",
			settings: remote.settings,
			shouldWriteLocal: true,
			shouldPushRemote: false,
		};
	}
	if (!remote && !local) {
		return {
			resolution: "equal",
			settings: {} as T,
			shouldWriteLocal: false,
			shouldPushRemote: false,
		};
	}

	// Both present.
	const l = local as SettingsSnapshot<T>;
	const r = remote as SettingsSnapshot<T>;
	const resolution = resolveLastWriteWins(l.updatedAt, r.updatedAt);
	if (resolution === "local") {
		return {
			resolution,
			settings: l.settings,
			shouldWriteLocal: false,
			shouldPushRemote: true,
		};
	}
	if (resolution === "remote") {
		return {
			resolution,
			settings: r.settings,
			shouldWriteLocal: true,
			shouldPushRemote: false,
		};
	}
	return {
		resolution,
		settings: l.settings,
		shouldWriteLocal: false,
		shouldPushRemote: false,
	};
}

// ── API-key merge ────────────────────────────────────────────────────────────

export interface KeyRecord {
	provider: string;
	label?: string;
	keyValue: string;
	updatedAt: number;
}

export interface KeyMergeResult {
	/** Keys that should be written into the local secret store. */
	toWriteLocal: KeyRecord[];
	/** Keys that should be upserted to the remote table. */
	toPushRemote: KeyRecord[];
}

/**
 * Merge local and remote API keys per-provider using last-write-wins.
 * Local-only providers are pushed; remote-only providers are written locally;
 * conflicting providers are resolved by timestamp.
 */
export function mergeApiKeys(local: KeyRecord[], remote: KeyRecord[]): KeyMergeResult {
	const localByProvider = new Map(local.map((k) => [k.provider, k]));
	const remoteByProvider = new Map(remote.map((k) => [k.provider, k]));
	const providers = new Set<string>([...localByProvider.keys(), ...remoteByProvider.keys()]);

	const toWriteLocal: KeyRecord[] = [];
	const toPushRemote: KeyRecord[] = [];

	for (const provider of providers) {
		const l = localByProvider.get(provider);
		const r = remoteByProvider.get(provider);

		if (l && !r) {
			toPushRemote.push(l);
			continue;
		}
		if (r && !l) {
			toWriteLocal.push(r);
			continue;
		}
		if (l && r) {
			const resolution = resolveLastWriteWins(l.updatedAt, r.updatedAt);
			if (resolution === "local") {
				// Only push when the value actually differs.
				if (l.keyValue !== r.keyValue || (l.label ?? "") !== (r.label ?? "")) {
					toPushRemote.push(l);
				}
			} else if (resolution === "remote") {
				if (l.keyValue !== r.keyValue || (l.label ?? "") !== (r.label ?? "")) {
					toWriteLocal.push(r);
				}
			}
		}
	}

	return { toWriteLocal, toPushRemote };
}

// ── Offline retry queue ──────────────────────────────────────────────────────

export type PushKind = "settings" | "apiKey" | "preset" | "projectMeta";

export interface QueuedPush {
	kind: PushKind;
	/** Stable identity within a kind so newer pushes supersede older ones. */
	id: string;
	/** The payload to send; opaque to the queue. */
	payload: unknown;
	/** When this push was enqueued (epoch millis). */
	enqueuedAt: number;
	/** Number of failed delivery attempts so far. */
	attempts: number;
}

/**
 * Add a push to the queue, collapsing any earlier queued push with the same
 * `(kind, id)` so only the latest payload is retried (last-write-wins at the
 * queue level too). Returns a new array; never mutates the input.
 */
export function enqueuePush(
	queue: QueuedPush[],
	push: Omit<QueuedPush, "attempts"> & { attempts?: number },
): QueuedPush[] {
	const next = queue.filter((q) => !(q.kind === push.kind && q.id === push.id));
	next.push({
		kind: push.kind,
		id: push.id,
		payload: push.payload,
		enqueuedAt: push.enqueuedAt,
		attempts: push.attempts ?? 0,
	});
	return next;
}

/** Remove a successfully delivered push from the queue. Returns a new array. */
export function dequeuePush(queue: QueuedPush[], kind: PushKind, id: string): QueuedPush[] {
	return queue.filter((q) => !(q.kind === kind && q.id === id));
}

/**
 * Mark a push as having failed another attempt. Drops pushes that have exceeded
 * `maxAttempts` so the queue cannot grow unbounded on a permanently failing
 * payload. Returns a new array.
 */
export function markPushFailed(
	queue: QueuedPush[],
	kind: PushKind,
	id: string,
	maxAttempts = 8,
): QueuedPush[] {
	const out: QueuedPush[] = [];
	for (const q of queue) {
		if (q.kind === kind && q.id === id) {
			const attempts = q.attempts + 1;
			if (attempts >= maxAttempts) continue; // drop
			out.push({ ...q, attempts });
		} else {
			out.push(q);
		}
	}
	return out;
}
