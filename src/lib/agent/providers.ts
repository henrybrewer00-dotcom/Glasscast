/**
 * Glasscast AI Agent — bring-your-own-key provider layer.
 *
 * Normalizes chat-with-tools across OpenAI, OpenRouter (OpenAI-compatible) and
 * Anthropic. All functions are pure: they build the HTTP request and parse the
 * response, so the request-shape and tool-call parsing are unit-testable without
 * any network access. The caller (agentCore) performs the actual fetch with the
 * user's own API key — Glasscast never proxies or pays for model usage.
 */

import { type AgentTool, toAnthropicTools, toOpenAITools } from "./tools";

export type AgentProviderId = "openai" | "anthropic" | "openrouter";

export interface AgentProviderInfo {
	id: AgentProviderId;
	label: string;
	defaultModel: string;
	models: string[];
	/** Where to get a key — shown in the BYOK settings UI. */
	keysUrl: string;
}

export const AGENT_PROVIDERS: Record<AgentProviderId, AgentProviderInfo> = {
	anthropic: {
		id: "anthropic",
		label: "Anthropic (Claude)",
		defaultModel: "claude-sonnet-4-6",
		models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
		keysUrl: "https://console.anthropic.com/settings/keys",
	},
	openai: {
		id: "openai",
		label: "OpenAI",
		defaultModel: "gpt-4o",
		models: ["gpt-4o", "gpt-4o-mini", "o4-mini"],
		keysUrl: "https://platform.openai.com/api-keys",
	},
	openrouter: {
		id: "openrouter",
		label: "OpenRouter (any model)",
		defaultModel: "anthropic/claude-sonnet-4",
		models: [
			"anthropic/claude-sonnet-4",
			"openai/gpt-4o",
			"google/gemini-2.5-pro",
			"meta-llama/llama-4-maverick",
		],
		keysUrl: "https://openrouter.ai/keys",
	},
};

export function isAgentProviderId(value: unknown): value is AgentProviderId {
	return value === "openai" || value === "anthropic" || value === "openrouter";
}

/** Short, friendly display names for known models (keyed by full model id). */
const MODEL_LABELS: Record<string, string> = {
	"claude-opus-4-8": "Opus 4.8",
	"claude-sonnet-4-6": "Sonnet 4.6",
	"claude-haiku-4-5-20251001": "Haiku 4.5",
	"gpt-4o": "GPT-4o",
	"gpt-4o-mini": "GPT-4o mini",
	"o4-mini": "o4-mini",
	"anthropic/claude-sonnet-4": "Claude Sonnet 4",
	"openai/gpt-4o": "GPT-4o",
	"google/gemini-2.5-pro": "Gemini 2.5 Pro",
	"meta-llama/llama-4-maverick": "Llama 4 Maverick",
};

/**
 * Abbreviated display name for a model id. Falls back to a tidied version of the
 * id (drops any "vendor/" prefix) so custom models still read cleanly.
 */
export function getModelDisplayName(model: string): string {
	if (MODEL_LABELS[model]) return MODEL_LABELS[model];
	const withoutVendor = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
	return withoutVendor;
}

export interface ToolCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
}

export type AgentMessage =
	| { role: "user"; content: string }
	| { role: "assistant"; content: string; toolCalls?: ToolCall[] }
	| { role: "tool"; toolCallId: string; toolName: string; content: string };

export interface ChatRequest {
	url: string;
	headers: Record<string, string>;
	body: unknown;
}

export interface AssistantTurn {
	text: string;
	toolCalls: ToolCall[];
	/** "tool_use" if the model wants tools run, "end" if it's done. */
	stop: "tool_use" | "end";
}

export interface BuildChatParams {
	provider: AgentProviderId;
	model: string;
	apiKey: string;
	system: string;
	messages: AgentMessage[];
	tools?: AgentTool[];
	maxTokens?: number;
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export function buildChatRequest(params: BuildChatParams): ChatRequest {
	if (params.provider === "anthropic") {
		return buildAnthropicRequest(params);
	}
	return buildOpenAIRequest(params);
}

function buildOpenAIRequest(params: BuildChatParams): ChatRequest {
	const messages: unknown[] = [{ role: "system", content: params.system }];

	for (const msg of params.messages) {
		if (msg.role === "user") {
			messages.push({ role: "user", content: msg.content });
		} else if (msg.role === "assistant") {
			const entry: Record<string, unknown> = {
				role: "assistant",
				content: msg.content || null,
			};
			if (msg.toolCalls && msg.toolCalls.length > 0) {
				entry.tool_calls = msg.toolCalls.map((call) => ({
					id: call.id,
					type: "function",
					function: { name: call.name, arguments: JSON.stringify(call.args) },
				}));
			}
			messages.push(entry);
		} else {
			messages.push({ role: "tool", tool_call_id: msg.toolCallId, content: msg.content });
		}
	}

	const url = params.provider === "openrouter" ? OPENROUTER_URL : OPENAI_URL;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Authorization: `Bearer ${params.apiKey}`,
	};
	if (params.provider === "openrouter") {
		headers["HTTP-Referer"] = "https://github.com/henrybrewer00-dotcom/Glasscast";
		headers["X-Title"] = "Glasscast";
	}

	return {
		url,
		headers,
		body: {
			model: params.model,
			messages,
			tools: params.tools ? toOpenAITools(params.tools) : undefined,
			max_tokens: params.maxTokens ?? 1024,
		},
	};
}

function buildAnthropicRequest(params: BuildChatParams): ChatRequest {
	const messages: unknown[] = [];

	for (const msg of params.messages) {
		if (msg.role === "user") {
			messages.push({ role: "user", content: [{ type: "text", text: msg.content }] });
		} else if (msg.role === "assistant") {
			const blocks: unknown[] = [];
			if (msg.content) blocks.push({ type: "text", text: msg.content });
			for (const call of msg.toolCalls ?? []) {
				blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.args });
			}
			messages.push({ role: "assistant", content: blocks });
		} else {
			// Anthropic carries tool results as a user message with a tool_result block.
			messages.push({
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: msg.toolCallId, content: msg.content },
				],
			});
		}
	}

	return {
		url: ANTHROPIC_URL,
		headers: {
			"Content-Type": "application/json",
			"x-api-key": params.apiKey,
			"anthropic-version": ANTHROPIC_VERSION,
			"anthropic-dangerous-direct-browser-access": "true",
		},
		body: {
			model: params.model,
			system: params.system,
			messages,
			tools: params.tools ? toAnthropicTools(params.tools) : undefined,
			max_tokens: params.maxTokens ?? 1024,
		},
	};
}

/** Parse a raw provider response into a normalized assistant turn. */
export function parseAssistantTurn(provider: AgentProviderId, raw: unknown): AssistantTurn {
	if (provider === "anthropic") {
		return parseAnthropicResponse(raw);
	}
	return parseOpenAIResponse(raw);
}

function parseOpenAIResponse(raw: unknown): AssistantTurn {
	const choice = (raw as { choices?: Array<{ message?: OpenAIMessage; finish_reason?: string }> })
		?.choices?.[0];
	const message = choice?.message;
	const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((call) => ({
		id: call.id,
		name: call.function.name,
		args: safeParseJson(call.function.arguments),
	}));
	return {
		text: message?.content ?? "",
		toolCalls,
		stop: toolCalls.length > 0 ? "tool_use" : "end",
	};
}

interface OpenAIMessage {
	content?: string | null;
	tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
}

function parseAnthropicResponse(raw: unknown): AssistantTurn {
	const data = raw as {
		content?: Array<
			| { type: "text"; text: string }
			| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
		>;
		stop_reason?: string;
	};
	let text = "";
	const toolCalls: ToolCall[] = [];
	for (const block of data?.content ?? []) {
		if (block.type === "text") {
			text += block.text;
		} else if (block.type === "tool_use") {
			toolCalls.push({ id: block.id, name: block.name, args: block.input ?? {} });
		}
	}
	return {
		text,
		toolCalls,
		stop: data?.stop_reason === "tool_use" || toolCalls.length > 0 ? "tool_use" : "end",
	};
}

function safeParseJson(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/** Extract a human-readable error from a failed provider response body. */
export function extractProviderError(raw: unknown): string {
	const obj = raw as { error?: { message?: string } | string };
	if (typeof obj?.error === "string") return obj.error;
	if (obj?.error && typeof obj.error === "object" && obj.error.message) {
		return obj.error.message;
	}
	return "The AI provider returned an error.";
}
