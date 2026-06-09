import { ipcMain } from "electron";
import {
	deleteAgentProviderKey,
	getAgentProviderKey,
	getAllAgentProviderKeyStatuses,
	saveAgentProviderKey,
} from "../../secretStore";

/**
 * AI agent IPC: bring-your-own-key management + a main-side chat proxy.
 *
 * The renderer builds the provider request (URL/body) but never holds the key.
 * `invoke-agent-chat` injects the stored key into the auth header main-side and
 * performs the fetch, so the key never crosses the IPC boundary to the renderer.
 * No sign-in is required — a saved key is enough.
 */

// Only these provider hosts may be called with the user's key.
const ALLOWED_HOSTS = new Set(["api.openai.com", "openrouter.ai", "api.anthropic.com"]);

interface InvokeAgentChatOptions {
	provider?: string;
	url?: string;
	headers?: Record<string, string>;
	body?: unknown;
}

export function registerAgentHandlers(): void {
	ipcMain.handle("get-agent-key-statuses", async () => {
		try {
			return { success: true, statuses: await getAllAgentProviderKeyStatuses() };
		} catch (error) {
			return { success: false, error: errorMessage(error) };
		}
	});

	ipcMain.handle("save-agent-key", async (_e, options: { provider: string; key: string }) => {
		try {
			const status = await saveAgentProviderKey(options.provider, options.key);
			return { success: true, status };
		} catch (error) {
			return { success: false, error: errorMessage(error) };
		}
	});

	ipcMain.handle("delete-agent-key", async (_e, provider: string) => {
		try {
			const status = await deleteAgentProviderKey(provider);
			return { success: true, status };
		} catch (error) {
			return { success: false, error: errorMessage(error) };
		}
	});

	ipcMain.handle("invoke-agent-chat", async (_e, options: InvokeAgentChatOptions) => {
		const provider = options.provider ?? "";
		const key = await getAgentProviderKey(provider);
		if (!key) {
			return { success: false, error: "no-key", message: `Add an API key for ${provider}.` };
		}

		const url = options.url ?? "";
		if (!isAllowedUrl(url)) {
			return {
				success: false,
				error: "blocked-url",
				message: "That provider URL is not allowed.",
			};
		}

		const headers: Record<string, string> = { ...(options.headers ?? {}) };
		headers["Content-Type"] = "application/json";
		if (provider === "anthropic") {
			headers["x-api-key"] = key;
			headers["anthropic-version"] = headers["anthropic-version"] ?? "2023-06-01";
		} else {
			headers.Authorization = `Bearer ${key}`;
		}

		try {
			const res = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(options.body ?? {}),
			});
			const json = await res.json().catch(() => null);
			if (!res.ok) {
				return { success: false, status: res.status, body: json, error: "provider-error" };
			}
			return { success: true, body: json };
		} catch (error) {
			return { success: false, error: "network", message: errorMessage(error) };
		}
	});
}

function isAllowedUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" && ALLOWED_HOSTS.has(parsed.hostname);
	} catch {
		return false;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
