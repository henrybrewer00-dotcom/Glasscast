/**
 * Cloud sync engine (main process).
 *
 * Responsibilities:
 *   - Pull-on-login: merge remote rows into the local app-settings blob and the
 *     secret store (API keys), last-write-wins by `updated_at`.
 *   - Push-on-change: debounced (2s) upserts of the local settings blob and any
 *     queued API-key / preset / project-meta changes.
 *   - Offline safety: pushes that fail are kept in an in-memory queue and
 *     retried on the next change or the next login.
 *
 * Renderer-owned data (editor presets in localStorage) cannot be read directly
 * from the main process, so the engine exposes {@link pushPresets} /
 * {@link pullPresets} for the IPC layer to drive.
 *
 * CJS-bundler-friendly: no top-level await; the secret store is loaded lazily.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { app } from "electron";
import { APP_SETTINGS_FILE } from "../ipc/constants";
import {
	deleteRecords,
	getCurrentUser,
	refreshSession,
	selectRecords,
	upsertByKey,
	insertRecords,
	updateRecords,
	type InsforgeUser,
} from "./insforgeClient";
import {
	clearSession,
	loadSession,
	saveSession,
	type PersistedSession,
} from "./sessionStore";
import {
	enqueuePush,
	dequeuePush,
	markPushFailed,
	mergeApiKeys,
	mergeSettings,
	parseUpdatedAt,
	type KeyRecord,
	type QueuedPush,
	type SettingsSnapshot,
} from "./syncMerge";

const PUSH_DEBOUNCE_MS = 2000;
const SETTINGS_UPDATED_AT_KEY = "__cloudSettingsUpdatedAt";

// ── Engine state ─────────────────────────────────────────────────────────────

export interface CloudStatus {
	signedIn: boolean;
	email: string | null;
	userId: string | null;
	lastSyncAt: number | null;
	syncing: boolean;
	lastError: string | null;
}

interface EngineState {
	session: PersistedSession | null;
	queue: QueuedPush[];
	lastSyncAt: number | null;
	syncing: boolean;
	lastError: string | null;
	debounceTimer: ReturnType<typeof setTimeout> | null;
	statusListeners: Set<(status: CloudStatus) => void>;
	/** Disposer for the secret-store key sync subscription, if any. */
	keyListenerDispose: (() => void) | null;
}

const state: EngineState = {
	session: null,
	queue: [],
	lastSyncAt: null,
	syncing: false,
	lastError: null,
	debounceTimer: null,
	statusListeners: new Set(),
	keyListenerDispose: null,
};

// ── Secret store (lazy, defensive) ───────────────────────────────────────────

/**
 * Subset of electron/secretStore.ts we depend on. Every method is optional so a
 * missing or partial module still compiles and runs. The real module stores
 * caption-provider API keys by `provider` string and exposes a sync listener
 * that fires with `(provider, value | null)` on every save/delete.
 */
interface SecretStoreModule {
	registerKeySyncListener?: (
		listener: (provider: string, value: string | null) => void | Promise<void>,
	) => () => void;
	getAllCaptionProviderKeyStatuses?: () => Promise<
		{ provider: string; hasKey: boolean; last4: string | null }[]
	>;
	getCaptionProviderKey?: (provider: string) => Promise<string | null>;
	saveCaptionProviderKey?: (
		provider: string,
		key: string,
	) => Promise<{ provider: string; hasKey: boolean; last4: string | null }>;
}

let secretStorePromise: Promise<SecretStoreModule | null> | null = null;
function loadSecretStore(): Promise<SecretStoreModule | null> {
	if (!secretStorePromise) {
		secretStorePromise = import("../secretStore")
			.then((mod) => (mod as unknown as SecretStoreModule) ?? null)
			.catch(() => null);
	}
	return secretStorePromise;
}

// ── Status ───────────────────────────────────────────────────────────────────

export function getStatus(): CloudStatus {
	return {
		signedIn: !!state.session,
		email: state.session?.user.email ?? null,
		userId: state.session?.user.id ?? null,
		lastSyncAt: state.lastSyncAt,
		syncing: state.syncing,
		lastError: state.lastError,
	};
}

function emitStatus(): void {
	const status = getStatus();
	for (const listener of state.statusListeners) {
		try {
			listener(status);
		} catch {
			// ignore listener errors
		}
	}
}

export function onStatusChange(listener: (status: CloudStatus) => void): () => void {
	state.statusListeners.add(listener);
	return () => state.statusListeners.delete(listener);
}

// ── Local settings blob helpers ──────────────────────────────────────────────

function readLocalSettings(): Record<string, unknown> {
	try {
		const content = readFileSync(APP_SETTINGS_FILE, "utf-8");
		const parsed = JSON.parse(content.replace(/^﻿/, ""));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// missing / corrupt
	}
	return {};
}

function writeLocalSettings(store: Record<string, unknown>): void {
	try {
		writeFileSync(APP_SETTINGS_FILE, JSON.stringify(store, null, 2), "utf-8");
	} catch (error) {
		console.error("Failed to write local app settings:", error);
	}
}

function localSettingsSnapshot(): SettingsSnapshot {
	const store = readLocalSettings();
	const updatedAt = parseUpdatedAt(store[SETTINGS_UPDATED_AT_KEY]) || 0;
	return { settings: store, updatedAt };
}

function stampLocalSettingsUpdatedAt(): number {
	const store = readLocalSettings();
	const now = Date.now();
	store[SETTINGS_UPDATED_AT_KEY] = now;
	writeLocalSettings(store);
	return now;
}

// ── Auth lifecycle ───────────────────────────────────────────────────────────

/** Restore a persisted session on app start; validates / refreshes the token. */
export async function initFromPersistedSession(): Promise<CloudStatus> {
	const persisted = await loadSession();
	if (!persisted) return getStatus();

	state.session = persisted;
	// Validate the access token; refresh if needed.
	try {
		await getCurrentUser(persisted.accessToken);
	} catch {
		const refreshed = await tryRefresh(persisted);
		if (!refreshed) {
			state.session = null;
			await clearSession();
			emitStatus();
			return getStatus();
		}
	}

	emitStatus();
	// Kick off a pull in the background; ignore failures (offline-safe).
	void syncNow().catch(() => undefined);
	return getStatus();
}

async function tryRefresh(persisted: PersistedSession): Promise<boolean> {
	if (!persisted.refreshToken) return false;
	try {
		const result = await refreshSession(persisted.refreshToken);
		const user: InsforgeUser = result.user ?? persisted.user;
		state.session = {
			user,
			accessToken: result.accessToken,
			refreshToken: result.refreshToken ?? persisted.refreshToken,
			savedAt: Date.now(),
		};
		await saveSession(state.session);
		return true;
	} catch {
		return false;
	}
}

async function setSessionFromAuth(
	user: InsforgeUser,
	accessToken: string,
	refreshToken: string | undefined,
): Promise<void> {
	state.session = { user, accessToken, refreshToken, savedAt: Date.now() };
	state.lastError = null;
	await saveSession(state.session);
	attachKeyListener();
	emitStatus();
}

export async function completeSignIn(
	user: InsforgeUser,
	accessToken: string,
	refreshToken: string | undefined,
): Promise<CloudStatus> {
	await setSessionFromAuth(user, accessToken, refreshToken);
	await syncNow();
	return getStatus();
}

export async function signOut(): Promise<CloudStatus> {
	if (state.debounceTimer) {
		clearTimeout(state.debounceTimer);
		state.debounceTimer = null;
	}
	state.keyListenerDispose?.();
	state.keyListenerDispose = null;
	state.session = null;
	state.queue = [];
	state.lastSyncAt = null;
	state.lastError = null;
	state.syncing = false;
	await clearSession();
	emitStatus();
	return getStatus();
}

// ── Authenticated request wrapper (auto-refresh on 401) ──────────────────────

async function withAccessToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
	if (!state.session) throw new Error("Not signed in");
	try {
		return await fn(state.session.accessToken);
	} catch (error) {
		const statusCode = (error as { statusCode?: number }).statusCode;
		if (statusCode === 401 && state.session) {
			const refreshed = await tryRefresh(state.session);
			if (refreshed && state.session) {
				return await fn(state.session.accessToken);
			}
		}
		throw error;
	}
}

// ── Pull (login) ─────────────────────────────────────────────────────────────

interface RemoteSettingsRow {
	user_id: string;
	settings: Record<string, unknown>;
	device_label?: string;
	updated_at?: string | number;
}

interface RemoteKeyRow {
	id?: string;
	user_id: string;
	provider: string;
	label?: string;
	key_value: string;
	updated_at?: string | number;
}

async function pullSettings(userId: string): Promise<void> {
	const rows = await withAccessToken((token) =>
		selectRecords<RemoteSettingsRow>(
			token,
			"user_settings",
			`user_id=eq.${encodeURIComponent(userId)}&limit=1`,
		),
	);
	const remoteRow = rows[0] ?? null;
	const local = localSettingsSnapshot();
	const remote: SettingsSnapshot | null = remoteRow
		? { settings: remoteRow.settings ?? {}, updatedAt: parseUpdatedAt(remoteRow.updated_at) }
		: null;

	const merged = mergeSettings(local, remote);
	if (merged.shouldWriteLocal) {
		const incoming = { ...(merged.settings as Record<string, unknown>) };
		incoming[SETTINGS_UPDATED_AT_KEY] = remote?.updatedAt ?? Date.now();
		writeLocalSettings(incoming);
	}
	if (merged.shouldPushRemote) {
		await pushSettingsBlob();
	}
}

async function pullApiKeys(userId: string): Promise<void> {
	const store = await loadSecretStore();
	if (!store?.getCaptionProviderKey && !store?.saveCaptionProviderKey) return;

	const rows = await withAccessToken((token) =>
		selectRecords<RemoteKeyRow>(
			token,
			"user_api_keys",
			`user_id=eq.${encodeURIComponent(userId)}`,
		),
	);
	const remote: KeyRecord[] = rows.map((r) => ({
		provider: r.provider,
		label: r.label,
		keyValue: r.key_value,
		updatedAt: parseUpdatedAt(r.updated_at),
	}));

	// Read the local raw keys. The secret store has no per-key timestamp, so
	// local keys are treated as baseline (updatedAt 0): a conflicting remote
	// row (with a real timestamp) wins, while local-only providers are pushed.
	const local: KeyRecord[] = [];
	if (store.getAllCaptionProviderKeyStatuses && store.getCaptionProviderKey) {
		try {
			const statuses = await store.getAllCaptionProviderKeyStatuses();
			for (const status of statuses) {
				if (!status.hasKey) continue;
				const value = await store.getCaptionProviderKey(status.provider);
				if (value) {
					local.push({ provider: status.provider, keyValue: value, updatedAt: 0 });
				}
			}
		} catch {
			// ignore — proceed with whatever we could read
		}
	}

	const { toWriteLocal, toPushRemote } = mergeApiKeys(local, remote);

	if (store.saveCaptionProviderKey) {
		for (const key of toWriteLocal) {
			try {
				await store.saveCaptionProviderKey(key.provider, key.keyValue);
			} catch {
				// ignore individual key write failures (e.g. unsupported provider)
			}
		}
	}
	for (const key of toPushRemote) {
		// Stamp a real timestamp so the cloud row reflects this push.
		queueKeyPush({ ...key, updatedAt: Date.now() });
	}
}

// ── Push ─────────────────────────────────────────────────────────────────────

async function pushSettingsBlob(): Promise<void> {
	if (!state.session) return;
	const snapshot = localSettingsSnapshot();
	const updatedAt = snapshot.updatedAt || Date.now();
	await withAccessToken((token) =>
		upsertByKey(token, "user_settings", "user_id", state.session!.user.id, {
			settings: snapshot.settings,
			device_label: deviceLabel(),
			updated_at: new Date(updatedAt).toISOString(),
		}),
	);
}

/** Payload shape for queued API-key pushes (delete is encoded with `_delete`). */
type KeyPushPayload = KeyRecord & { _delete?: boolean };

async function deleteApiKey(provider: string): Promise<void> {
	if (!state.session) return;
	const userId = state.session.user.id;
	await withAccessToken((token) =>
		deleteRecords(
			token,
			"user_api_keys",
			`user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(provider)}`,
		),
	);
}

async function pushApiKey(key: KeyRecord): Promise<void> {
	if (!state.session) return;
	const userId = state.session.user.id;
	await withAccessToken(async (token) => {
		const existing = await selectRecords<RemoteKeyRow>(
			token,
			"user_api_keys",
			`user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(key.provider)}&limit=1`,
		);
		const row = {
			user_id: userId,
			provider: key.provider,
			label: key.label ?? null,
			key_value: key.keyValue,
			updated_at: new Date(key.updatedAt || Date.now()).toISOString(),
		};
		if (existing[0]) {
			await updateRecords(
				token,
				"user_api_keys",
				`user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(key.provider)}`,
				row,
			);
		} else {
			await insertRecords(token, "user_api_keys", row);
		}
	});
}

function deviceLabel(): string {
	try {
		return `${app.getName()} on ${process.platform}`;
	} catch {
		return process.platform;
	}
}

// ── Queue drain ──────────────────────────────────────────────────────────────

async function deliverPush(push: QueuedPush): Promise<void> {
	switch (push.kind) {
		case "settings":
			await pushSettingsBlob();
			return;
		case "apiKey": {
			const payload = push.payload as KeyPushPayload;
			if (payload._delete) {
				await deleteApiKey(payload.provider);
			} else {
				await pushApiKey(payload);
			}
			return;
		}
		case "preset":
			await pushPresetRow(push.payload as PresetPush);
			return;
		case "projectMeta":
			await pushProjectMetaRow(push.payload as Record<string, unknown>);
			return;
	}
}

async function drainQueue(): Promise<void> {
	if (!state.session) return;
	// Snapshot so concurrent enqueues during the drain are handled next pass.
	const pending = [...state.queue];
	for (const push of pending) {
		try {
			await deliverPush(push);
			state.queue = dequeuePush(state.queue, push.kind, push.id);
		} catch {
			state.queue = markPushFailed(state.queue, push.kind, push.id);
		}
	}
}

// ── Public push enqueuers ────────────────────────────────────────────────────

function queueSettingsPush(): void {
	state.queue = enqueuePush(state.queue, {
		kind: "settings",
		id: "app-settings",
		payload: null,
		enqueuedAt: Date.now(),
	});
}

function queueKeyPush(key: KeyRecord): void {
	state.queue = enqueuePush(state.queue, {
		kind: "apiKey",
		id: `apiKey:${key.provider}`,
		payload: key,
		enqueuedAt: Date.now(),
	});
}

function queueKeyDelete(provider: string): void {
	state.queue = enqueuePush(state.queue, {
		kind: "apiKey",
		id: `apiKey:${provider}`,
		payload: { provider, keyValue: "", updatedAt: Date.now(), _delete: true } as KeyPushPayload,
		enqueuedAt: Date.now(),
	});
}

/** Notify the engine that the local settings blob changed (debounced push). */
export function notifySettingsChanged(): void {
	stampLocalSettingsUpdatedAt();
	queueSettingsPush();
	scheduleDebouncedPush();
}

function scheduleDebouncedPush(): void {
	if (!state.session) return;
	if (state.debounceTimer) clearTimeout(state.debounceTimer);
	state.debounceTimer = setTimeout(() => {
		state.debounceTimer = null;
		void runPush();
	}, PUSH_DEBOUNCE_MS);
}

async function runPush(): Promise<void> {
	if (!state.session) return;
	setSyncing(true);
	try {
		await drainQueue();
		if (state.queue.length === 0) {
			state.lastSyncAt = Date.now();
			state.lastError = null;
		}
	} catch (error) {
		state.lastError = String((error as Error)?.message ?? error);
	} finally {
		setSyncing(false);
	}
}

function setSyncing(value: boolean): void {
	state.syncing = value;
	emitStatus();
}

// ── Presets (renderer-driven via IPC) ────────────────────────────────────────

export interface PresetPush {
	kind: string;
	name: string;
	data: unknown;
	updatedAt?: number;
}

interface RemotePresetRow {
	id?: string;
	user_id: string;
	kind: string;
	name: string;
	data: unknown;
	updated_at?: string | number;
}

async function pushPresetRow(preset: PresetPush): Promise<void> {
	if (!state.session) return;
	const userId = state.session.user.id;
	await withAccessToken(async (token) => {
		const existing = await selectRecords<RemotePresetRow>(
			token,
			"user_presets",
			`user_id=eq.${encodeURIComponent(userId)}&kind=eq.${encodeURIComponent(preset.kind)}&name=eq.${encodeURIComponent(preset.name)}&limit=1`,
		);
		const row = {
			user_id: userId,
			kind: preset.kind,
			name: preset.name,
			data: preset.data,
		};
		if (existing[0]) {
			await updateRecords(
				token,
				"user_presets",
				`user_id=eq.${encodeURIComponent(userId)}&kind=eq.${encodeURIComponent(preset.kind)}&name=eq.${encodeURIComponent(preset.name)}`,
				row,
			);
		} else {
			await insertRecords(token, "user_presets", row);
		}
	});
}

/** Enqueue preset upserts coming from the renderer (localStorage presets). */
export function pushPresets(presets: PresetPush[]): void {
	if (!state.session) return;
	for (const preset of presets) {
		state.queue = enqueuePush(state.queue, {
			kind: "preset",
			id: `preset:${preset.kind}:${preset.name}`,
			payload: preset,
			enqueuedAt: Date.now(),
		});
	}
	scheduleDebouncedPush();
}

/** Pull all presets for the signed-in user (for the renderer to merge). */
export async function pullPresets(): Promise<PresetPush[]> {
	if (!state.session) return [];
	const userId = state.session.user.id;
	const rows = await withAccessToken((token) =>
		selectRecords<RemotePresetRow>(
			token,
			"user_presets",
			`user_id=eq.${encodeURIComponent(userId)}`,
		),
	);
	return rows.map((r) => ({
		kind: r.kind,
		name: r.name,
		data: r.data,
		updatedAt: parseUpdatedAt(r.updated_at),
	}));
}

// ── Project meta ─────────────────────────────────────────────────────────────

async function pushProjectMetaRow(row: Record<string, unknown>): Promise<void> {
	if (!state.session) return;
	const userId = state.session.user.id;
	const projectKey = String(row.project_key ?? "");
	if (!projectKey) return;
	await withAccessToken((token) =>
		upsertByKey(
			token,
			"project_meta",
			"project_key",
			projectKey,
			{ ...row, user_id: userId },
		),
	);
}

// ── Secret-store key listener ────────────────────────────────────────────────

function attachKeyListener(): void {
	if (state.keyListenerDispose) return;
	void loadSecretStore().then((store) => {
		if (!store?.registerKeySyncListener) return;
		try {
			state.keyListenerDispose = store.registerKeySyncListener(
				(provider: string, value: string | null) => {
					if (!state.session) return;
					if (value === null) {
						queueKeyDelete(provider);
					} else {
						queueKeyPush({ provider, keyValue: value, updatedAt: Date.now() });
					}
					scheduleDebouncedPush();
				},
			);
		} catch {
			state.keyListenerDispose = null;
		}
	});
}

// ── Manual full sync ─────────────────────────────────────────────────────────

/** Pull-then-push a full sync. Resolves to the latest status. */
export async function syncNow(): Promise<CloudStatus> {
	if (!state.session) return getStatus();
	setSyncing(true);
	state.lastError = null;
	const userId = state.session.user.id;
	try {
		attachKeyListener();
		await pullSettings(userId);
		await pullApiKeys(userId);
		await drainQueue();
		if (state.queue.length === 0) {
			state.lastSyncAt = Date.now();
		}
	} catch (error) {
		state.lastError = String((error as Error)?.message ?? error);
	} finally {
		setSyncing(false);
	}
	return getStatus();
}

/** Enqueue project-meta and trigger a debounced push. */
export function pushProjectMeta(row: Record<string, unknown>): void {
	if (!state.session) return;
	const projectKey = String(row.project_key ?? "");
	if (!projectKey) return;
	state.queue = enqueuePush(state.queue, {
		kind: "projectMeta",
		id: `projectMeta:${projectKey}`,
		payload: row,
		enqueuedAt: Date.now(),
	});
	scheduleDebouncedPush();
}
