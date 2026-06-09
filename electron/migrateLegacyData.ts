import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

/**
 * One-time migration of legacy Recordly user data into the new Glasscast
 * userData directory.
 *
 * Renaming the Electron productName from "Recordly" to "Glasscast" moves the
 * userData folder (e.g. on macOS from ".../Application Support/Recordly" to
 * ".../Application Support/Glasscast"). To preserve user preferences and recent
 * projects across the rebrand, we copy a small set of settings files (NOT the
 * recordings themselves) from the sibling legacy directory the first time the
 * app starts under its new name.
 *
 * The migration is a no-op once Glasscast already has its own app-settings.json,
 * so it only ever runs once.
 */

// Files we migrate. Intentionally excludes recordings and large media.
const MIGRATED_FILES = [
	"app-settings.json",
	"recent-projects.json",
	"recordings-settings.json",
];

function getLegacyUserDataDir(currentUserDataDir: string): string {
	const parent = path.dirname(currentUserDataDir);
	const currentName = path.basename(currentUserDataDir);

	// Map the current (Glasscast) directory name back to its legacy (Recordly)
	// sibling, preserving any dev suffix.
	let legacyName: string;
	if (currentName === "Glasscast-dev") {
		legacyName = "Recordly-dev";
	} else if (currentName === "Glasscast") {
		legacyName = "Recordly";
	} else {
		// Fall back to a literal token swap so non-standard names still resolve.
		legacyName = currentName.replace(/Glasscast/g, "Recordly");
	}

	return path.join(parent, legacyName);
}

export async function migrateLegacyUserData(): Promise<void> {
	try {
		const currentUserDataDir = app.getPath("userData");
		const sentinel = path.join(currentUserDataDir, "app-settings.json");

		// If Glasscast already has settings, the migration has already happened
		// (or the user is brand new). Either way, do nothing.
		if (existsSync(sentinel)) {
			return;
		}

		const legacyUserDataDir = getLegacyUserDataDir(currentUserDataDir);
		if (legacyUserDataDir === currentUserDataDir || !existsSync(legacyUserDataDir)) {
			return;
		}

		await fs.mkdir(currentUserDataDir, { recursive: true });

		for (const fileName of MIGRATED_FILES) {
			const source = path.join(legacyUserDataDir, fileName);
			const destination = path.join(currentUserDataDir, fileName);

			if (!existsSync(source) || existsSync(destination)) {
				continue;
			}

			try {
				await fs.copyFile(source, destination);
			} catch (error) {
				console.warn(
					`[migrate-legacy-data] Failed to copy ${fileName} from legacy Recordly data:`,
					error,
				);
			}
		}
	} catch (error) {
		// Migration is best-effort; never block startup on it.
		console.warn("[migrate-legacy-data] Legacy data migration skipped:", error);
	}
}
