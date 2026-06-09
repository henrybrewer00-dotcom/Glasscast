/**
 * Renderer-side glue for the Glasscast AI agent.
 *
 * Bridges the pure agent engine (providers/agentCore) to the Electron main
 * process: builds the provider request with the user's chosen provider/model,
 * sends it through `invokeAgentChat` (which injects the BYOK key main-side and
 * fetches), and parses the response back into a normalized AssistantTurn.
 *
 * Works with no sign-in — a saved API key is all that's required.
 */

import type { ModelCaller } from "./agentCore";
import {
	type AgentMessage,
	type AgentProviderId,
	type AssistantTurn,
	buildChatRequest,
	extractProviderError,
	parseAssistantTurn,
} from "./providers";
import { type AgentTool } from "./tools";

export interface AgentKeyStatus {
	provider: string;
	hasKey: boolean;
	last4: string | null;
}

export async function getAgentKeyStatuses(): Promise<AgentKeyStatus[]> {
	const res = await window.electronAPI.getAgentKeyStatuses?.();
	return res?.success && res.statuses ? res.statuses : [];
}

export async function saveAgentKey(provider: string, key: string): Promise<boolean> {
	const res = await window.electronAPI.saveAgentKey?.({ provider, key });
	return Boolean(res?.success);
}

export async function deleteAgentKey(provider: string): Promise<boolean> {
	const res = await window.electronAPI.deleteAgentKey?.(provider);
	return Boolean(res?.success);
}

export class AgentChatError extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
	}
}

/**
 * Build a ModelCaller for the agent loop. Each call constructs the provider
 * request (with an empty key placeholder — the real key is injected main-side)
 * and round-trips it through the IPC proxy.
 */
export function createModelCaller(params: {
	provider: AgentProviderId;
	model: string;
	system: string;
	tools: AgentTool[];
}): ModelCaller {
	return async (messages: AgentMessage[]): Promise<AssistantTurn> => {
		const request = buildChatRequest({
			provider: params.provider,
			model: params.model,
			apiKey: "", // injected main-side; never present in the renderer
			system: params.system,
			messages,
			tools: params.tools,
			maxTokens: 1500,
		});

		const res = await window.electronAPI.invokeAgentChat?.({
			provider: params.provider,
			url: request.url,
			headers: request.headers,
			body: request.body,
		});

		if (!res) {
			throw new AgentChatError("AI bridge is unavailable.", "no-bridge");
		}
		if (!res.success) {
			if (res.error === "no-key") {
				throw new AgentChatError(res.message ?? "No API key set.", "no-key");
			}
			const detail = res.body
				? extractProviderError(res.body)
				: (res.message ?? "Request failed.");
			throw new AgentChatError(detail, res.error ?? "error");
		}

		return parseAssistantTurn(params.provider, res.body);
	};
}
