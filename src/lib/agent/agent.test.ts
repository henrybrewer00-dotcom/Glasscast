import { describe, expect, it, vi } from "vitest";
import { type AgentEvent, buildAgentSystemPrompt, runAgent, type ToolResult } from "./agentCore";
import {
	type AgentMessage,
	type AssistantTurn,
	buildChatRequest,
	extractProviderError,
	isAgentProviderId,
	parseAssistantTurn,
	type ToolCall,
} from "./providers";
import {
	AGENT_TOOLS,
	isAgentToolName,
	toAnthropicTools,
	toOpenAITools,
	validateToolArgs,
} from "./tools";

describe("agent tool catalog", () => {
	it("has unique names and valid schemas", () => {
		const names = new Set<string>();
		for (const tool of AGENT_TOOLS) {
			expect(names.has(tool.name)).toBe(false);
			names.add(tool.name);
			expect(tool.parameters.type).toBe("object");
			expect(tool.description.length).toBeGreaterThan(10);
		}
		expect(isAgentToolName("add_zoom")).toBe(true);
		expect(isAgentToolName("nope")).toBe(false);
	});

	it("marks export/delete/trim as destructive and reads as non-destructive", () => {
		const byName = Object.fromEntries(AGENT_TOOLS.map((t) => [t.name, t]));
		expect(byName.export_video.destructive).toBe(true);
		expect(byName.delete_selected.destructive).toBe(true);
		expect(byName.trim.destructive).toBe(true);
		expect(byName.get_project_state.destructive).toBe(false);
		expect(byName.add_zoom.destructive).toBe(false);
	});

	it("converts to OpenAI and Anthropic tool formats", () => {
		const openai = toOpenAITools();
		expect(openai[0]).toHaveProperty("type", "function");
		expect(openai[0].function).toHaveProperty("name");
		const anthropic = toAnthropicTools();
		expect(anthropic[0]).toHaveProperty("input_schema");
		expect(anthropic[0]).toHaveProperty("name");
	});
});

describe("validateToolArgs", () => {
	it("accepts valid args", () => {
		expect(validateToolArgs("add_zoom", { startMs: 0, endMs: 1000 })).toBeNull();
		expect(
			validateToolArgs("add_zoom", { startMs: 0, endMs: 1000, depth: 3, style: "tilt3d" }),
		).toBeNull();
	});

	it("rejects missing required args", () => {
		expect(validateToolArgs("add_zoom", { startMs: 0 })).toMatch(/endMs/);
	});

	it("enforces enums and numeric bounds", () => {
		expect(validateToolArgs("add_zoom", { startMs: 0, endMs: 1, style: "spin" })).toMatch(
			/one of/,
		);
		expect(validateToolArgs("add_zoom", { startMs: 0, endMs: 1, depth: 99 })).toMatch(/≤ 6/);
		expect(validateToolArgs("add_zoom", { startMs: 0, endMs: 1, focusX: 2 })).toMatch(/≤ 1/);
	});

	it("rejects wrong types and unexpected args", () => {
		expect(validateToolArgs("seek_to", { timeMs: "soon" })).toMatch(/number/);
		expect(validateToolArgs("set_playback", { playing: "yes" })).toMatch(/boolean/);
		expect(validateToolArgs("add_zoom", { startMs: 0, endMs: 1, bogus: 1 })).toMatch(
			/Unexpected/,
		);
	});

	it("rejects unknown tools", () => {
		expect(validateToolArgs("frobnicate", {})).toMatch(/Unknown tool/);
	});
});

describe("buildChatRequest", () => {
	const base = {
		model: "m",
		apiKey: "sk-test",
		system: "be helpful",
		messages: [{ role: "user", content: "zoom in" }] as AgentMessage[],
		tools: AGENT_TOOLS,
	};

	it("builds an OpenAI request with bearer auth and a system message", () => {
		const req = buildChatRequest({ provider: "openai", ...base });
		expect(req.url).toContain("api.openai.com");
		expect(req.headers.Authorization).toBe("Bearer sk-test");
		const body = req.body as { messages: Array<{ role: string }>; tools: unknown[] };
		expect(body.messages[0].role).toBe("system");
		expect(body.tools.length).toBe(AGENT_TOOLS.length);
	});

	it("routes OpenRouter to its endpoint with attribution headers", () => {
		const req = buildChatRequest({ provider: "openrouter", ...base });
		expect(req.url).toContain("openrouter.ai");
		expect(req.headers["X-Title"]).toBe("Glasscast");
	});

	it("builds an Anthropic request with x-api-key and a top-level system", () => {
		const req = buildChatRequest({ provider: "anthropic", ...base });
		expect(req.url).toContain("api.anthropic.com");
		expect(req.headers["x-api-key"]).toBe("sk-test");
		const body = req.body as { system: string; messages: unknown[] };
		expect(body.system).toBe("be helpful");
	});

	it("serializes assistant tool calls and tool results for OpenAI", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "zoom" },
			{
				role: "assistant",
				content: "",
				toolCalls: [{ id: "c1", name: "add_zoom", args: { startMs: 0, endMs: 1000 } }],
			},
			{ role: "tool", toolCallId: "c1", toolName: "add_zoom", content: "Added zoom." },
		];
		const req = buildChatRequest({ provider: "openai", ...base, messages });
		const body = req.body as {
			messages: Array<{ role: string; tool_calls?: unknown[]; tool_call_id?: string }>;
		};
		const assistant = body.messages.find((m) => m.role === "assistant");
		expect(assistant?.tool_calls).toHaveLength(1);
		const tool = body.messages.find((m) => m.role === "tool");
		expect(tool?.tool_call_id).toBe("c1");
	});

	it("serializes tool_use / tool_result blocks for Anthropic", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "zoom" },
			{
				role: "assistant",
				content: "ok",
				toolCalls: [{ id: "c1", name: "add_zoom", args: { startMs: 0, endMs: 1 } }],
			},
			{ role: "tool", toolCallId: "c1", toolName: "add_zoom", content: "done" },
		];
		const req = buildChatRequest({ provider: "anthropic", ...base, messages });
		const body = req.body as {
			messages: Array<{ role: string; content: Array<{ type: string }> }>;
		};
		const assistant = body.messages.find((m) => m.role === "assistant");
		expect(assistant?.content.some((b) => b.type === "tool_use")).toBe(true);
		const toolResultMsg = body.messages[body.messages.length - 1];
		expect(toolResultMsg.content[0].type).toBe("tool_result");
	});
});

describe("parseAssistantTurn", () => {
	it("parses OpenAI tool calls", () => {
		const raw = {
			choices: [
				{
					finish_reason: "tool_calls",
					message: {
						content: "On it.",
						tool_calls: [
							{
								id: "c1",
								function: {
									name: "add_zoom",
									arguments: '{"startMs":0,"endMs":900}',
								},
							},
						],
					},
				},
			],
		};
		const turn = parseAssistantTurn("openai", raw);
		expect(turn.stop).toBe("tool_use");
		expect(turn.text).toBe("On it.");
		expect(turn.toolCalls[0]).toMatchObject({
			name: "add_zoom",
			args: { startMs: 0, endMs: 900 },
		});
	});

	it("treats a plain OpenAI message as the end", () => {
		const turn = parseAssistantTurn("openai", {
			choices: [{ message: { content: "All done!" } }],
		});
		expect(turn.stop).toBe("end");
		expect(turn.text).toBe("All done!");
	});

	it("parses Anthropic tool_use blocks", () => {
		const raw = {
			stop_reason: "tool_use",
			content: [
				{ type: "text", text: "Adding a zoom." },
				{
					type: "tool_use",
					id: "tu1",
					name: "add_zoom",
					input: { startMs: 100, endMs: 800 },
				},
			],
		};
		const turn = parseAssistantTurn("anthropic", raw);
		expect(turn.stop).toBe("tool_use");
		expect(turn.text).toBe("Adding a zoom.");
		expect(turn.toolCalls[0]).toMatchObject({ id: "tu1", name: "add_zoom" });
	});

	it("survives malformed OpenAI tool arguments", () => {
		const turn = parseAssistantTurn("openai", {
			choices: [
				{
					message: {
						tool_calls: [
							{ id: "c1", function: { name: "add_zoom", arguments: "{bad" } },
						],
					},
				},
			],
		});
		expect(turn.toolCalls[0].args).toEqual({});
	});

	it("extracts provider errors", () => {
		expect(extractProviderError({ error: { message: "bad key" } })).toBe("bad key");
		expect(extractProviderError({ error: "rate limited" })).toBe("rate limited");
	});

	it("validates provider ids", () => {
		expect(isAgentProviderId("openai")).toBe(true);
		expect(isAgentProviderId("groq")).toBe(false);
	});
});

describe("runAgent loop", () => {
	function ok(message: string): ToolResult {
		return { ok: true, message };
	}

	it("runs tool calls then finishes", async () => {
		const turns: AssistantTurn[] = [
			{
				text: "Adding a zoom.",
				toolCalls: [{ id: "c1", name: "add_zoom", args: { startMs: 0, endMs: 900 } }],
				stop: "tool_use",
			},
			{ text: "Done — added a zoom.", toolCalls: [], stop: "end" },
		];
		const callModel = vi.fn(async () => turns.shift() as AssistantTurn);
		const executeTool = vi.fn(async (_call: ToolCall) => ok("Added zoom region z1."));
		const events: AgentEvent[] = [];

		const result = await runAgent({
			prompt: "zoom in at the start",
			callModel,
			executeTool,
			permission: "assist",
			onEvent: (e) => events.push(e),
		});

		expect(executeTool).toHaveBeenCalledOnce();
		expect(result.stoppedReason).toBe("complete");
		expect(result.finalText).toBe("Done — added a zoom.");
		expect(events.some((e) => e.type === "tool_result")).toBe(true);
	});

	it("requires confirmation for destructive tools and skips when denied", async () => {
		const turns: AssistantTurn[] = [
			{
				text: "Exporting.",
				toolCalls: [{ id: "c1", name: "export_video", args: { format: "mp4" } }],
				stop: "tool_use",
			},
			{ text: "Okay, I won't export.", toolCalls: [], stop: "end" },
		];
		const callModel = vi.fn(async () => turns.shift() as AssistantTurn);
		const executeTool = vi.fn(async () => ok("exported"));
		const confirmDestructive = vi.fn(async () => false);

		const result = await runAgent({
			prompt: "export it",
			callModel,
			executeTool,
			confirmDestructive,
			permission: "assist",
		});

		expect(confirmDestructive).toHaveBeenCalledOnce();
		expect(executeTool).not.toHaveBeenCalled();
		expect(result.stoppedReason).toBe("complete");
	});

	it("autopilot runs destructive tools without confirmation", async () => {
		const turns: AssistantTurn[] = [
			{
				text: "",
				toolCalls: [{ id: "c1", name: "export_video", args: { format: "mp4" } }],
				stop: "tool_use",
			},
			{ text: "Exported.", toolCalls: [], stop: "end" },
		];
		const callModel = vi.fn(async () => turns.shift() as AssistantTurn);
		const executeTool = vi.fn(async () => ok("exported"));

		await runAgent({
			prompt: "export it",
			callModel,
			executeTool,
			permission: "autopilot",
		});
		expect(executeTool).toHaveBeenCalledOnce();
	});

	it("suggest mode does not apply edits automatically", async () => {
		const turns: AssistantTurn[] = [
			{
				text: "",
				toolCalls: [{ id: "c1", name: "add_zoom", args: { startMs: 0, endMs: 900 } }],
				stop: "tool_use",
			},
			{ text: "Here's what I'd do.", toolCalls: [], stop: "end" },
		];
		const callModel = vi.fn(async () => turns.shift() as AssistantTurn);
		const executeTool = vi.fn(async () => ok("done"));

		await runAgent({ prompt: "zoom", callModel, executeTool, permission: "suggest" });
		expect(executeTool).not.toHaveBeenCalled();
	});

	it("feeds a validation error back to the model instead of throwing", async () => {
		const turns: AssistantTurn[] = [
			{
				text: "",
				toolCalls: [{ id: "c1", name: "add_zoom", args: { startMs: 0 } }], // missing endMs
				stop: "tool_use",
			},
			{ text: "Fixed.", toolCalls: [], stop: "end" },
		];
		const callModel = vi.fn(async (msgs: AgentMessage[]) => {
			// On the 2nd call the loop should have appended a tool result with the error.
			if (turns.length === 1) {
				const lastTool = [...msgs].reverse().find((m) => m.role === "tool");
				expect(lastTool?.content).toMatch(/endMs/);
			}
			return turns.shift() as AssistantTurn;
		});
		const executeTool = vi.fn(async () => ok("should not run"));

		await runAgent({ prompt: "zoom", callModel, executeTool, permission: "autopilot" });
		expect(executeTool).not.toHaveBeenCalled();
	});

	it("stops at maxSteps to avoid infinite loops", async () => {
		const callModel = vi.fn(async () => ({
			text: "",
			toolCalls: [{ id: "c1", name: "seek_to", args: { timeMs: 0 } }],
			stop: "tool_use" as const,
		}));
		const executeTool = vi.fn(async () => ok("seeked"));
		const result = await runAgent({
			prompt: "loop",
			callModel,
			executeTool,
			permission: "autopilot",
			maxSteps: 3,
		});
		expect(result.stoppedReason).toBe("max_steps");
		expect(callModel).toHaveBeenCalledTimes(3);
	});
});

describe("buildAgentSystemPrompt", () => {
	it("embeds the project summary", () => {
		const prompt = buildAgentSystemPrompt("duration 12000ms, 2 zooms");
		expect(prompt).toContain("Glasscast editing agent");
		expect(prompt).toContain("duration 12000ms, 2 zooms");
	});
});
