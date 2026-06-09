// One-time migration helper for renamed localStorage keys.
//
// During the Recordly -> Glasscast rebrand, persisted localStorage keys moved
// from the "recordly.*" namespace to the "glasscast.*" namespace. To avoid
// breaking existing installs, every read of a glasscast.* key first attempts a
// one-time copy of the value stored under the legacy recordly.* key (when the
// glasscast.* key has not been written yet).

function getLocalStorage(): Storage | null {
	try {
		const storage = globalThis.localStorage;
		return storage ?? null;
	} catch {
		return null;
	}
}

/**
 * Derive the legacy localStorage key for a given glasscast.* key.
 *
 * Examples:
 *   glasscast.theme                -> recordly.theme
 *   glasscast.editor.preferences   -> recordly.editor.preferences
 *   glasscast_custom_fonts         -> recordly_custom_fonts
 *
 * Returns null when there is no legacy equivalent (the key does not start with
 * the glasscast brand prefix in either the dotted or underscored form).
 */
export function legacyKeyFor(key: string): string | null {
	if (key.startsWith("glasscast.")) {
		return `recordly.${key.slice("glasscast.".length)}`;
	}
	if (key.startsWith("glasscast_")) {
		return `recordly_${key.slice("glasscast_".length)}`;
	}
	return null;
}

/**
 * One-time migrate a legacy recordly.* localStorage value to its glasscast.*
 * key. If the glasscast.* key is already present, nothing happens. If the
 * legacy key exists and the new key does not, the value is copied over.
 *
 * Returns the value now stored under the new key (or null when neither key
 * exists / localStorage is unavailable).
 */
export function migrateLegacyKey(key: string): string | null {
	const storage = getLocalStorage();
	if (!storage) {
		return null;
	}

	let current: string | null = null;
	try {
		current = storage.getItem(key);
	} catch {
		return null;
	}

	if (current !== null) {
		return current;
	}

	const legacyKey = legacyKeyFor(key);
	if (!legacyKey) {
		return null;
	}

	let legacyValue: string | null = null;
	try {
		legacyValue = storage.getItem(legacyKey);
	} catch {
		return null;
	}

	if (legacyValue === null) {
		return null;
	}

	try {
		storage.setItem(key, legacyValue);
	} catch {
		// If we cannot persist the migrated value, still return it so the read
		// succeeds for this session.
	}

	return legacyValue;
}

/**
 * Read a persisted string from localStorage under the given glasscast.* key,
 * transparently performing the one-time recordly.* -> glasscast.* migration on
 * first read.
 */
export function readPersistedString(key: string): string | null {
	return migrateLegacyKey(key);
}
