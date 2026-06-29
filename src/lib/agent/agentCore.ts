/**
 * Glasscast AI Agent — orchestration core.
 *
 * Runs the multi-step "think → call tools → observe → repeat" loop that turns a
 * natural-language request ("zoom in here", "clip this into a launch video and
 * export it") into concrete editor actions.
 *
 * It is transport-agnostic: the caller injects a `callModel` (does the real fetch
 * with the user's BYOK key) and an `executeTool` (applies the action to the live
 * editor). That keeps the loop itself pure and unit-testable.
 */

import { type AgentMessage, type AssistantTurn, type ToolCall } from "./providers";
import { AGENT_TOOLS_BY_NAME, validateToolArgs } from "./tools";

export interface ToolResult {
	ok: boolean;
	/** Short result/observation fed back to the model. */
	message: string;
}

export type ToolExecutor = (call: ToolCall) => Promise<ToolResult>;
export type ModelCaller = (messages: AgentMessage[]) => Promise<AssistantTurn>;

/** Permission levels for how much the agent may do on its own. */
export type AgentPermissionLevel = "suggest" | "assist" | "autopilot";

export interface RunAgentParams {
	/** The user's natural-language request. */
	prompt: string;
	/** Prior conversation (excluding the new prompt). */
	history?: AgentMessage[];
	callModel: ModelCaller;
	executeTool: ToolExecutor;
	/** Confirm a destructive tool before it runs. Return false to skip it. */
	confirmDestructive?: (call: ToolCall) => Promise<boolean>;
	permission?: AgentPermissionLevel;
	/** Max model round-trips before stopping (loop guard). */
	maxSteps?: number;
	/** Optional progress callback for streaming the agent's activity to the UI. */
	onEvent?: (event: AgentEvent) => void;
}

export type AgentEvent =
	| { type: "assistant_text"; text: string }
	| { type: "tool_call"; call: ToolCall }
	| { type: "tool_result"; call: ToolCall; result: ToolResult }
	| { type: "tool_skipped"; call: ToolCall; reason: string }
	| { type: "done"; reason: "complete" | "max_steps" };

export interface RunAgentResult {
	messages: AgentMessage[];
	finalText: string;
	steps: number;
	stoppedReason: "complete" | "max_steps";
}

/** Tools that may run without confirmation at a given permission level. */
function isAllowedWithoutConfirm(toolName: string, permission: AgentPermissionLevel): boolean {
	const tool = AGENT_TOOLS_BY_NAME[toolName];
	if (!tool) return false;
	if (permission === "autopilot") return true;
	if (permission === "suggest") return tool.category === "read";
	// "assist": everything except destructive tools runs freely.
	return !tool.destructive;
}

export async function runAgent(params: RunAgentParams): Promise<RunAgentResult> {
	const {
		prompt,
		history = [],
		callModel,
		executeTool,
		confirmDestructive,
		permission = "assist",
		maxSteps = 8,
		onEvent,
	} = params;

	const messages: AgentMessage[] = [...history, { role: "user", content: prompt }];
	let finalText = "";
	let steps = 0;

	while (steps < maxSteps) {
		steps += 1;
		const turn = await callModel(messages);

		if (turn.text) {
			finalText = turn.text;
			onEvent?.({ type: "assistant_text", text: turn.text });
		}

		if (turn.stop === "end" || turn.toolCalls.length === 0) {
			messages.push({ role: "assistant", content: turn.text });
			onEvent?.({ type: "done", reason: "complete" });
			return { messages, finalText, steps, stoppedReason: "complete" };
		}

		// Record the assistant's tool-call turn before appending results.
		messages.push({ role: "assistant", content: turn.text, toolCalls: turn.toolCalls });

		for (const call of turn.toolCalls) {
			const result = await runOneTool(call, {
				executeTool,
				confirmDestructive,
				permission,
				onEvent,
			});
			messages.push({
				role: "tool",
				toolCallId: call.id,
				toolName: call.name,
				content: result.message,
			});
		}
	}

	onEvent?.({ type: "done", reason: "max_steps" });
	return { messages, finalText, steps, stoppedReason: "max_steps" };
}

async function runOneTool(
	call: ToolCall,
	opts: {
		executeTool: ToolExecutor;
		confirmDestructive?: (call: ToolCall) => Promise<boolean>;
		permission: AgentPermissionLevel;
		onEvent?: (event: AgentEvent) => void;
	},
): Promise<ToolResult> {
	const { executeTool, confirmDestructive, permission, onEvent } = opts;
	onEvent?.({ type: "tool_call", call });

	const validationError = validateToolArgs(call.name, call.args);
	if (validationError) {
		const result: ToolResult = { ok: false, message: `Error: ${validationError}` };
		onEvent?.({ type: "tool_result", call, result });
		return result;
	}

	const tool = AGENT_TOOLS_BY_NAME[call.name];
	const needsConfirm = tool.destructive || !isAllowedWithoutConfirm(call.name, permission);
	if (needsConfirm) {
		const approved = confirmDestructive
			? await confirmDestructive(call)
			: permission === "autopilot";
		if (!approved) {
			const reason =
				permission === "suggest"
					? "Suggest mode — not applied automatically."
					: "Skipped by user.";
			onEvent?.({ type: "tool_skipped", call, reason });
			return { ok: false, message: `Not run: ${reason}` };
		}
	}

	try {
		const result = await executeTool(call);
		onEvent?.({ type: "tool_result", call, result });
		return result;
	} catch (error) {
		const result: ToolResult = {
			ok: false,
			message: `Error running ${call.name}: ${error instanceof Error ? error.message : String(error)}`,
		};
		onEvent?.({ type: "tool_result", call, result });
		return result;
	}
}

/** Default system prompt establishing the agent's role and the canvas it acts on. */
export function buildAgentSystemPrompt(projectSummary: string): string {
	return [
		"You are the Glasscast editing agent, embedded in a screen-recording editor.",
		"You help the user turn a raw screen recording into a polished, cinematic video.",
		"You can read the project, add and tune zooms (including 3D 'tilt3d' and 'dolly' camera styles), add captions, change the background and padding, trim, navigate playback, change settings, style the webcam/facecam (ring light, ring color, shadow, roundness, size), and export.",
		"Prefer concrete actions over long explanations. Call get_project_state when you need to 'see' the current canvas before deciding. Use millisecond timing and 0–1 focus coordinates.",
		"When the user mentions the 'face', 'facecam', 'webcam', 'face color', or 'ring light', use set_webcam_style (ringColor is a hex color, ringLight is 0–1).",
		"When the user says 'zoom in here', infer a sensible time window around the current playhead and a focus point, then add the zoom.",
		"",
		"Current project:",
		projectSummary,
	].join("\n");
}
