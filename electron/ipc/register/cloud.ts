import { BrowserWindow, ipcMain } from "electron";
import { signIn, signUp } from "../../cloud/insforgeClient";
import {
	completeSignIn,
	getStatus,
	initFromPersistedSession,
	notifySettingsChanged,
	onStatusChange,
	pullPresets,
	pushPresets,
	pushProjectMeta,
	signOut,
	syncNow,
	type CloudStatus,
	type PresetPush,
} from "../../cloud/syncEngine";

const CLOUD_STATUS_EVENT = "cloud:status-changed";

function broadcastStatus(status: CloudStatus): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.webContents.send(CLOUD_STATUS_EVENT, status);
		}
	}
}

let statusSubscribed = false;

export function registerCloudHandlers(): void {
	if (!statusSubscribed) {
		onStatusChange(broadcastStatus);
		statusSubscribed = true;
	}

	// Restore any persisted session on startup (fire-and-forget; offline-safe).
	void initFromPersistedSession().catch(() => undefined);

	ipcMain.handle("cloud:status", () => {
		return { success: true, status: getStatus() };
	});

	ipcMain.handle("cloud:sign-in", async (_event, email: unknown, password: unknown) => {
		if (typeof email !== "string" || typeof password !== "string") {
			return { success: false, error: "Email and password are required." };
		}
		try {
			const session = await signIn(email.trim(), password);
			const status = await completeSignIn(
				session.user,
				session.accessToken,
				session.refreshToken,
			);
			return { success: true, status };
		} catch (error) {
			return { success: false, error: String((error as Error)?.message ?? error) };
		}
	});

	ipcMain.handle("cloud:sign-up", async (_event, email: unknown, password: unknown) => {
		if (typeof email !== "string" || typeof password !== "string") {
			return { success: false, error: "Email and password are required." };
		}
		try {
			const session = await signUp(email.trim(), password);
			const status = await completeSignIn(
				session.user,
				session.accessToken,
				session.refreshToken,
			);
			return { success: true, status };
		} catch (error) {
			return { success: false, error: String((error as Error)?.message ?? error) };
		}
	});

	ipcMain.handle("cloud:sign-out", async () => {
		const status = await signOut();
		return { success: true, status };
	});

	ipcMain.handle("cloud:sync-now", async () => {
		try {
			const status = await syncNow();
			return { success: true, status };
		} catch (error) {
			return { success: false, error: String((error as Error)?.message ?? error) };
		}
	});

	// Renderer signals that the local app-settings blob changed.
	ipcMain.handle("cloud:settings-changed", () => {
		notifySettingsChanged();
		return { success: true };
	});

	// Push editor presets (renderer-side localStorage) up to the cloud.
	ipcMain.handle("cloud:push-presets", (_event, presets: unknown) => {
		if (!Array.isArray(presets)) {
			return { success: false, error: "Expected an array of presets." };
		}
		pushPresets(presets as PresetPush[]);
		return { success: true };
	});

	// Pull presets so the renderer can merge them into localStorage.
	ipcMain.handle("cloud:pull-presets", async () => {
		try {
			const presets = await pullPresets();
			return { success: true, presets };
		} catch (error) {
			return { success: false, error: String((error as Error)?.message ?? error) };
		}
	});

	// Push project metadata for cross-device project listings.
	ipcMain.handle("cloud:push-project-meta", (_event, row: unknown) => {
		if (!row || typeof row !== "object") {
			return { success: false, error: "Expected a project-meta object." };
		}
		pushProjectMeta(row as Record<string, unknown>);
		return { success: true };
	});
}
