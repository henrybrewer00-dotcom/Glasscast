import fs from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";

/**
 * Encrypted-at-rest store for cloud caption provider API keys.
 *
 * Keys are encrypted with Electron's safeStorage (OS keychain backed) and
 * persisted to `<userData>/ai-credentials.enc`. Raw key material never leaves
 * the main process: callers only ever receive { provider, last4, hasKey }.
 */

export type CaptionKeyProvider = "openai" | "groq" | "deepgram";

export interface CaptionKeyStatus {
	provider: CaptionKeyProvider;
	hasKey: boolean;
	last4: string | null;
}

const SUPPORTED_PROVIDERS: CaptionKeyProvider[] = ["openai", "groq", "deepgram"];

/** AI agent (chat) BYOK providers. Stored under the `agent_` namespace. */
export type AgentKeyProvider = "openai" | "anthropic" | "openrouter";
const AGENT_PROVIDERS: AgentKeyProvider[] = ["openai", "anthropic", "openrouter"];
const agentStoreKey = (provider: AgentKeyProvider) => `agent_${provider}`;

export interface AgentKeyStatus {
	provider: AgentKeyProvider;
	hasKey: boolean;
	last4: string | null;
}

// The store holds both caption keys (under their bare provider id) and agent
// keys (under `agent_<provider>`), so arbitrary string keys are allowed.
type StoredCredentials = Record<string, string>;

function isSupportedProvider(value: unknown): value is CaptionKeyProvider {
	return typeof value === "string" && (SUPPORTED_PROVIDERS as string[]).includes(value);
}

function credentialsFilePath(): string {
	return path.join(app.getPath("userData"), "ai-credentials.enc");
}

/**
 * Listeners notified whenever a cloud key is saved or deleted, so the cloud-sync
 * agent can mirror keys without this module importing its code. `value` is null
 * on delete. Registered via registerKeySyncListener (no-op-able).
 */
type KeySyncListener = (provider: string, value: string | null) => void | Promise<void>;

const keySyncListeners = new Set<KeySyncListener>();

/**
 * Subscribe to cloud key changes. Returns an unsubscribe function. Safe to call
 * with a no-op; failures inside a listener are swallowed so they cannot break
 * key persistence.
 */
export function registerKeySyncListener(listener: KeySyncListener): () => void {
	keySyncListeners.add(listener);
	return () => {
		keySyncListeners.delete(listener);
	};
}

async function notifyKeySyncListeners(provider: string, value: string | null): Promise<void> {
	for (const listener of keySyncListeners) {
		try {
			await listener(provider, value);
		} catch (error) {
			console.warn("[secret-store] key sync listener failed:", error);
		}
	}
}

async function readStore(): Promise<StoredCredentials> {
	let raw: Buffer;
	try {
		raw = await fs.readFile(credentialsFilePath());
	} catch {
		return {};
	}

	if (raw.length === 0) {
		return {};
	}

	if (!safeStorage.isEncryptionAvailable()) {
		console.warn("[secret-store] safeStorage encryption is unavailable; cannot read keys.");
		return {};
	}

	try {
		const decrypted = safeStorage.decryptString(raw);
		const parsed = JSON.parse(decrypted) as unknown;
		if (!parsed || typeof parsed !== "object") {
			return {};
		}

		const result: StoredCredentials = {};
		for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof value === "string" && value.length > 0) {
				result[key] = value;
			}
		}
		return result;
	} catch (error) {
		console.warn("[secret-store] Failed to decrypt credentials store:", error);
		return {};
	}
}

async function writeStore(store: StoredCredentials): Promise<void> {
	if (!safeStorage.isEncryptionAvailable()) {
		throw new Error(
			"Secure storage is unavailable on this system, so API keys cannot be saved.",
		);
	}

	const filePath = credentialsFilePath();
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const encrypted = safeStorage.encryptString(JSON.stringify(store));
	await fs.writeFile(filePath, encrypted);
}

function statusFor(provider: CaptionKeyProvider, value: string | undefined): CaptionKeyStatus {
	const hasKey = typeof value === "string" && value.length > 0;
	return {
		provider,
		hasKey,
		last4: hasKey ? value.slice(-4) : null,
	};
}

export async function saveCaptionProviderKey(
	provider: string,
	key: string,
): Promise<CaptionKeyStatus> {
	if (!isSupportedProvider(provider)) {
		throw new Error(`Unsupported caption key provider: ${String(provider)}`);
	}

	const trimmed = typeof key === "string" ? key.trim() : "";
	if (!trimmed) {
		throw new Error("API key cannot be empty.");
	}

	const store = await readStore();
	store[provider] = trimmed;
	await writeStore(store);
	await notifyKeySyncListeners(provider, trimmed);

	return statusFor(provider, trimmed);
}

export async function getCaptionProviderKeyStatus(provider: string): Promise<CaptionKeyStatus> {
	if (!isSupportedProvider(provider)) {
		throw new Error(`Unsupported caption key provider: ${String(provider)}`);
	}

	const store = await readStore();
	return statusFor(provider, store[provider]);
}

export async function getAllCaptionProviderKeyStatuses(): Promise<CaptionKeyStatus[]> {
	const store = await readStore();
	return SUPPORTED_PROVIDERS.map((provider) => statusFor(provider, store[provider]));
}

/**
 * Internal: returns the raw key for main-process transcription use only. Never
 * expose this over IPC.
 */
export async function getCaptionProviderKey(provider: string): Promise<string | null> {
	if (!isSupportedProvider(provider)) {
		return null;
	}

	const store = await readStore();
	const value = store[provider];
	return typeof value === "string" && value.length > 0 ? value : null;
}

export async function deleteCaptionProviderKey(provider: string): Promise<CaptionKeyStatus> {
	if (!isSupportedProvider(provider)) {
		throw new Error(`Unsupported caption key provider: ${String(provider)}`);
	}

	const store = await readStore();
	if (store[provider]) {
		delete store[provider];
		await writeStore(store);
		await notifyKeySyncListeners(provider, null);
	}

	return statusFor(provider, undefined);
}

// ── AI agent (chat) BYOK keys ─────────────────────────────────────────────
// Mirror the caption-key API but namespaced under `agent_<provider>`. These work
// with no sign-in required; when signed in they ride the same cloud-sync path.

function isAgentProvider(value: unknown): value is AgentKeyProvider {
	return typeof value === "string" && (AGENT_PROVIDERS as string[]).includes(value);
}

function agentStatusFor(provider: AgentKeyProvider, value: string | undefined): AgentKeyStatus {
	const hasKey = typeof value === "string" && value.length > 0;
	return { provider, hasKey, last4: hasKey ? value.slice(-4) : null };
}

export async function saveAgentProviderKey(provider: string, key: string): Promise<AgentKeyStatus> {
	if (!isAgentProvider(provider)) {
		throw new Error(`Unsupported agent key provider: ${String(provider)}`);
	}
	const trimmed = typeof key === "string" ? key.trim() : "";
	if (!trimmed) {
		throw new Error("API key cannot be empty.");
	}
	const store = await readStore();
	store[agentStoreKey(provider)] = trimmed;
	await writeStore(store);
	await notifyKeySyncListeners(agentStoreKey(provider), trimmed);
	return agentStatusFor(provider, trimmed);
}

export async function getAgentProviderKeyStatus(provider: string): Promise<AgentKeyStatus> {
	if (!isAgentProvider(provider)) {
		throw new Error(`Unsupported agent key provider: ${String(provider)}`);
	}
	const store = await readStore();
	return agentStatusFor(provider, store[agentStoreKey(provider)]);
}

export async function getAllAgentProviderKeyStatuses(): Promise<AgentKeyStatus[]> {
	const store = await readStore();
	return AGENT_PROVIDERS.map((provider) =>
		agentStatusFor(provider, store[agentStoreKey(provider)]),
	);
}

/** Internal: raw agent key for main-process provider calls only. Never expose over IPC. */
export async function getAgentProviderKey(provider: string): Promise<string | null> {
	if (!isAgentProvider(provider)) return null;
	const store = await readStore();
	const value = store[agentStoreKey(provider)];
	return typeof value === "string" && value.length > 0 ? value : null;
}

export async function deleteAgentProviderKey(provider: string): Promise<AgentKeyStatus> {
	if (!isAgentProvider(provider)) {
		throw new Error(`Unsupported agent key provider: ${String(provider)}`);
	}
	const store = await readStore();
	if (store[agentStoreKey(provider)]) {
		delete store[agentStoreKey(provider)];
		await writeStore(store);
		await notifyKeySyncListeners(agentStoreKey(provider), null);
	}
	return agentStatusFor(provider, undefined);
}
