/**
 * Persists the InsForge session (access + refresh token, user) between app
 * launches.
 *
 * Prefers the encrypted `secretStore` module (electron/secretStore.ts) when it
 * exists — it is being built in parallel, so we load it via a defensive dynamic
 * import. If it is unavailable, we fall back to a plain JSON file under
 * userData. This module therefore compiles and runs standalone.
 */

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { InsforgeUser } from "./insforgeClient";

export interface PersistedSession {
	user: InsforgeUser;
	accessToken: string;
	refreshToken?: string;
	savedAt: number;
}

const SECRET_KEY = "cloud.session";

function sessionFilePath(): string {
	return path.join(app.getPath("userData"), "cloud-session.json");
}

/**
 * Shape we expect (and tolerate the absence of) from the parallel secretStore
 * module. Every field is optional so a partial implementation still works.
 */
interface SecretStoreModule {
	getSecret?: (key: string) => string | null | Promise<string | null>;
	setSecret?: (key: string, value: string) => void | Promise<void>;
	deleteSecret?: (key: string) => void | Promise<void>;
}

let secretStorePromise: Promise<SecretStoreModule | null> | null = null;

function loadSecretStore(): Promise<SecretStoreModule | null> {
	if (!secretStorePromise) {
		secretStorePromise = import("../secretStore")
			.then((mod) => (mod as SecretStoreModule) ?? null)
			.catch(() => null);
	}
	return secretStorePromise;
}

function parseSession(raw: string | null): PersistedSession | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<PersistedSession>;
		if (
			parsed &&
			typeof parsed.accessToken === "string" &&
			parsed.user &&
			typeof parsed.user === "object" &&
			typeof parsed.user.id === "string"
		) {
			return {
				user: parsed.user as InsforgeUser,
				accessToken: parsed.accessToken,
				refreshToken:
					typeof parsed.refreshToken === "string" ? parsed.refreshToken : undefined,
				savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
			};
		}
	} catch {
		// fall through
	}
	return null;
}

export async function loadSession(): Promise<PersistedSession | null> {
	const store = await loadSecretStore();
	if (store?.getSecret) {
		try {
			const raw = await store.getSecret(SECRET_KEY);
			const parsed = parseSession(raw ?? null);
			if (parsed) return parsed;
		} catch {
			// fall through to file fallback
		}
	}

	try {
		const raw = readFileSync(sessionFilePath(), "utf-8");
		return parseSession(raw);
	} catch {
		return null;
	}
}

export async function saveSession(session: PersistedSession): Promise<void> {
	const serialized = JSON.stringify(session);
	const store = await loadSecretStore();
	if (store?.setSecret) {
		try {
			await store.setSecret(SECRET_KEY, serialized);
			return;
		} catch {
			// fall through to file fallback
		}
	}

	try {
		writeFileSync(sessionFilePath(), serialized, { encoding: "utf-8", mode: 0o600 });
	} catch (error) {
		console.error("Failed to persist cloud session:", error);
	}
}

export async function clearSession(): Promise<void> {
	const store = await loadSecretStore();
	if (store?.deleteSecret) {
		try {
			await store.deleteSecret(SECRET_KEY);
		} catch {
			// ignore
		}
	}

	try {
		rmSync(sessionFilePath(), { force: true });
	} catch {
		// ignore
	}
}
