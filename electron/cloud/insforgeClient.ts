/**
 * Main-process REST client for the InsForge backend.
 *
 * Uses plain `fetch` (available in Electron's Node runtime) against the InsForge
 * REST API — NOT the browser SDK. All requests are made with the desktop
 * `client_type=desktop` query parameter so that auth returns a `refreshToken`
 * directly in the response body rather than relying on httpOnly cookies.
 *
 * Endpoint shapes are taken verbatim from:
 *   npx @insforge/cli docs auth rest-api
 *   npx @insforge/cli docs db rest-api
 */

// ── Configuration ───────────────────────────────────────────────────────────

export const INSFORGE_BASE_URL = "https://kk926phm.us-east.insforge.app";

/** Anonymous key — public, safe to embed; identifies the project for the gateway. */
export const INSFORGE_ANON_KEY =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3OC0xMjM0LTU2NzgtOTBhYi1jZGVmMTIzNDU2NzgiLCJlbWFpbCI6ImFub25AaW5zZm9yZ2UuY29tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTY3MDd9.1HyMYbRZnSn9jSDtONjZVs-4dv1SNsTMrIeiDb7GXXo";

/** Tables synced by the desktop app (RLS owner-only). */
export type CloudTable =
	| "user_settings"
	| "user_api_keys"
	| "user_presets"
	| "project_meta";

// ── Types ───────────────────────────────────────────────────────────────────

export interface InsforgeUser {
	id: string;
	email: string;
	role?: string;
	emailVerified?: boolean;
	providers?: string[];
	createdAt?: string;
	updatedAt?: string;
}

export interface InsforgeSession {
	user: InsforgeUser;
	accessToken: string;
	/** Present for non-web clients (desktop). May be absent if not returned. */
	refreshToken?: string;
}

export interface InsforgeError extends Error {
	statusCode?: number;
	insforgeError?: string;
}

function makeError(message: string, statusCode?: number, insforgeError?: string): InsforgeError {
	const err = new Error(message) as InsforgeError;
	if (statusCode !== undefined) err.statusCode = statusCode;
	if (insforgeError !== undefined) err.insforgeError = insforgeError;
	return err;
}

// ── Low-level fetch helpers ─────────────────────────────────────────────────

function url(path: string): string {
	return `${INSFORGE_BASE_URL}${path}`;
}

async function parseJsonSafe(res: Response): Promise<unknown> {
	const text = await res.text();
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

async function ensureOk(res: Response): Promise<unknown> {
	const body = await parseJsonSafe(res);
	if (res.ok) return body;

	let message = `InsForge request failed (${res.status})`;
	let insforgeError: string | undefined;
	if (body && typeof body === "object") {
		const obj = body as Record<string, unknown>;
		if (typeof obj.message === "string") message = obj.message;
		if (typeof obj.error === "string") insforgeError = obj.error;
	} else if (typeof body === "string" && body.length > 0) {
		message = body;
	}
	throw makeError(message, res.status, insforgeError);
}

// ── Auth ────────────────────────────────────────────────────────────────────

/**
 * Create a new account. Returns a session with an access token (and refresh
 * token for desktop clients). If the backend requires email verification the
 * `accessToken` may be null — callers should surface that as an error.
 */
export async function signUp(email: string, password: string): Promise<InsforgeSession> {
	const res = await fetch(url("/api/auth/users?client_type=desktop"), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			apikey: INSFORGE_ANON_KEY,
		},
		body: JSON.stringify({ email, password }),
	});
	const body = (await ensureOk(res)) as {
		user?: InsforgeUser;
		accessToken?: string | null;
		refreshToken?: string | null;
		requireEmailVerification?: boolean;
	};

	if (!body?.accessToken || !body.user) {
		if (body?.requireEmailVerification) {
			throw makeError(
				"Account created. Please verify your email before signing in.",
				403,
				"EMAIL_VERIFICATION_REQUIRED",
			);
		}
		throw makeError("Sign up did not return an access token.", 500);
	}

	return {
		user: body.user,
		accessToken: body.accessToken,
		refreshToken: body.refreshToken ?? undefined,
	};
}

/** Authenticate an existing account. */
export async function signIn(email: string, password: string): Promise<InsforgeSession> {
	const res = await fetch(url("/api/auth/sessions?client_type=desktop"), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			apikey: INSFORGE_ANON_KEY,
		},
		body: JSON.stringify({ email, password }),
	});
	const body = (await ensureOk(res)) as {
		user?: InsforgeUser;
		accessToken?: string | null;
		refreshToken?: string | null;
	};

	if (!body?.accessToken || !body.user) {
		throw makeError("Sign in did not return an access token.", 401);
	}

	return {
		user: body.user,
		accessToken: body.accessToken,
		refreshToken: body.refreshToken ?? undefined,
	};
}

/**
 * Exchange a refresh token for a fresh access token (desktop token rotation).
 * Returns the new access token plus the rotated refresh token to persist.
 */
export async function refreshSession(
	refreshToken: string,
): Promise<{ accessToken: string; refreshToken?: string; user?: InsforgeUser }> {
	const res = await fetch(url("/api/auth/refresh?client_type=desktop"), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			apikey: INSFORGE_ANON_KEY,
		},
		body: JSON.stringify({ refreshToken }),
	});
	const body = (await ensureOk(res)) as {
		user?: InsforgeUser;
		accessToken?: string | null;
		refreshToken?: string | null;
	};
	if (!body?.accessToken) {
		throw makeError("Refresh did not return an access token.", 401);
	}
	return {
		accessToken: body.accessToken,
		refreshToken: body.refreshToken ?? undefined,
		user: body.user,
	};
}

/** Fetch the currently authenticated user from a bearer access token. */
export async function getCurrentUser(accessToken: string): Promise<InsforgeUser> {
	const res = await fetch(url("/api/auth/sessions/current"), {
		method: "GET",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			apikey: INSFORGE_ANON_KEY,
		},
	});
	const body = (await ensureOk(res)) as { user?: InsforgeUser };
	if (!body?.user) {
		throw makeError("No authenticated user.", 401);
	}
	return body.user;
}

/** Best-effort logout. Never throws. */
export async function logout(accessToken: string): Promise<void> {
	try {
		await fetch(url("/api/auth/logout"), {
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				apikey: INSFORGE_ANON_KEY,
			},
		});
	} catch {
		// ignore — local sign-out is what matters
	}
}

// ── PostgREST-style CRUD ─────────────────────────────────────────────────────

function recordsUrl(table: CloudTable, query?: string): string {
	const base = `/api/database/records/${table}`;
	return url(query ? `${base}?${query}` : base);
}

function authHeaders(accessToken: string, extra?: Record<string, string>): Record<string, string> {
	return {
		Authorization: `Bearer ${accessToken}`,
		apikey: INSFORGE_ANON_KEY,
		"Content-Type": "application/json",
		...extra,
	};
}

/**
 * Query records. `query` is a raw PostgREST query string
 * (e.g. `user_id=eq.<id>&limit=1`).
 */
export async function selectRecords<T = Record<string, unknown>>(
	accessToken: string,
	table: CloudTable,
	query?: string,
): Promise<T[]> {
	const res = await fetch(recordsUrl(table, query), {
		method: "GET",
		headers: authHeaders(accessToken),
	});
	const body = (await ensureOk(res)) as T[] | null;
	return Array.isArray(body) ? body : [];
}

/**
 * Insert one or more records. Body is always sent as an array per the API
 * contract. Returns the created rows (Prefer: return=representation).
 */
export async function insertRecords<T = Record<string, unknown>>(
	accessToken: string,
	table: CloudTable,
	rows: Record<string, unknown> | Record<string, unknown>[],
): Promise<T[]> {
	const payload = Array.isArray(rows) ? rows : [rows];
	const res = await fetch(recordsUrl(table), {
		method: "POST",
		headers: authHeaders(accessToken, { Prefer: "return=representation" }),
		body: JSON.stringify(payload),
	});
	const body = (await ensureOk(res)) as T[] | null;
	return Array.isArray(body) ? body : [];
}

/** Update records matching `query`. Returns the updated rows. */
export async function updateRecords<T = Record<string, unknown>>(
	accessToken: string,
	table: CloudTable,
	query: string,
	patch: Record<string, unknown>,
): Promise<T[]> {
	const res = await fetch(recordsUrl(table, query), {
		method: "PATCH",
		headers: authHeaders(accessToken, { Prefer: "return=representation" }),
		body: JSON.stringify(patch),
	});
	const body = (await ensureOk(res)) as T[] | null;
	return Array.isArray(body) ? body : [];
}

/** Delete records matching `query`. */
export async function deleteRecords(
	accessToken: string,
	table: CloudTable,
	query: string,
): Promise<void> {
	const res = await fetch(recordsUrl(table, query), {
		method: "DELETE",
		headers: authHeaders(accessToken),
	});
	await ensureOk(res);
}

/**
 * Upsert a single row keyed by an equality filter on `keyColumn`. Performs a
 * SELECT to decide between INSERT and PATCH (the REST API has no native upsert).
 * Returns the resulting row.
 */
export async function upsertByKey<T = Record<string, unknown>>(
	accessToken: string,
	table: CloudTable,
	keyColumn: string,
	keyValue: string,
	row: Record<string, unknown>,
): Promise<T | null> {
	const query = `${keyColumn}=eq.${encodeURIComponent(keyValue)}&limit=1`;
	const existing = await selectRecords<Record<string, unknown>>(accessToken, table, query);

	if (existing.length > 0) {
		const updated = await updateRecords<T>(accessToken, table, query, row);
		return updated[0] ?? null;
	}

	const inserted = await insertRecords<T>(accessToken, table, {
		...row,
		[keyColumn]: keyValue,
	});
	return inserted[0] ?? null;
}
