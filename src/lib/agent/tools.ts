/**
 * Glasscast AI Agent — tool catalog.
 *
 * These tools are the complete surface the agent can act on: editing the
 * project, navigating playback, changing settings, and exporting. Each tool is a
 * provider-agnostic definition (name + description + JSON-Schema parameters) that
 * is converted to the OpenAI/OpenRouter or Anthropic tool format at request time.
 *
 * The actual side effects are performed by an executor the editor supplies (see
 * agentCore.ts `ToolExecutor`), so this module stays pure and unit-testable.
 */

export type AgentToolCategory =
	| "read"
	| "zoom"
	| "captions"
	| "scene"
	| "timeline"
	| "playback"
	| "settings"
	| "export";

export interface AgentTool {
	name: string;
	description: string;
	category: AgentToolCategory;
	/**
	 * Whether running this tool is hard to undo (export, delete, settings wipe).
	 * The editor can require confirmation for destructive tools depending on the
	 * chosen permission level.
	 */
	destructive: boolean;
	/** JSON Schema (draft-07 subset) for the tool's arguments. */
	parameters: JsonSchema;
}

export interface JsonSchema {
	type: "object";
	properties: Record<string, JsonSchemaProperty>;
	required?: string[];
	additionalProperties?: boolean;
}

export interface JsonSchemaProperty {
	type: "string" | "number" | "integer" | "boolean";
	description?: string;
	enum?: Array<string | number>;
	minimum?: number;
	maximum?: number;
}

const ZOOM_STYLE_ENUM = ["flat", "tilt3d", "dolly"];

export const AGENT_TOOLS: AgentTool[] = [
	{
		name: "get_project_state",
		description:
			"Read the current project: video duration, playhead time, all zoom regions (with timing/focus/depth/style), captions, background, padding, and which item is selected. Call this first to 'see the canvas' before deciding what to change.",
		category: "read",
		destructive: false,
		parameters: { type: "object", properties: {}, additionalProperties: false },
	},
	{
		name: "add_zoom",
		description:
			"Add a zoom region to the timeline. Times are in milliseconds. focusX/focusY are 0–1 (0,0 = top-left, 1,1 = bottom-right) of the video. Use this for 'zoom in here' style requests.",
		category: "zoom",
		destructive: false,
		parameters: {
			type: "object",
			properties: {
				startMs: { type: "integer", description: "Zoom start in ms", minimum: 0 },
				endMs: { type: "integer", description: "Zoom end in ms", minimum: 0 },
				focusX: {
					type: "number",
					description: "Horizontal focus 0–1",
					minimum: 0,
					maximum: 1,
				},
				focusY: {
					type: "number",
					description: "Vertical focus 0–1",
					minimum: 0,
					maximum: 1,
				},
				depth: {
					type: "integer",
					description: "Zoom depth 1 (subtle) – 6 (extreme)",
					minimum: 1,
					maximum: 6,
				},
				style: { type: "string", description: "Camera style", enum: ZOOM_STYLE_ENUM },
			},
			required: ["startMs", "endMs"],
			additionalProperties: false,
		},
	},
	{
		name: "update_selected_zoom",
		description:
			"Modify the currently selected zoom region: change its depth, camera style (flat/tilt3d/dolly), 3D intensity, or focus point.",
		category: "zoom",
		destructive: false,
		parameters: {
			type: "object",
			properties: {
				depth: { type: "integer", minimum: 1, maximum: 6 },
				style: { type: "string", enum: ZOOM_STYLE_ENUM },
				intensity: {
					type: "number",
					description: "3D intensity 0–1",
					minimum: 0,
					maximum: 1,
				},
				focusX: { type: "number", minimum: 0, maximum: 1 },
				focusY: { type: "number", minimum: 0, maximum: 1 },
			},
			additionalProperties: false,
		},
	},
	{
		name: "select_zoom",
		description: "Select a zoom region by its id so it becomes the target of update/delete.",
		category: "zoom",
		destructive: false,
		parameters: {
			type: "object",
			properties: { id: { type: "string", description: "Zoom region id" } },
			required: ["id"],
			additionalProperties: false,
		},
	},
	{
		name: "auto_suggest_zooms",
		description:
			"Automatically detect good zoom moments from the recording's cursor activity (clicks, dwells) and add them. Use for 'add zooms for me' / 'make it dynamic'.",
		category: "zoom",
		destructive: false,
		parameters: { type: "object", properties: {}, additionalProperties: false },
	},
	{
		name: "delete_selected",
		description: "Delete the currently selected item (zoom, annotation, clip, or audio track).",
		category: "timeline",
		destructive: true,
		parameters: { type: "object", properties: {}, additionalProperties: false },
	},
	{
		name: "generate_captions",
		description:
			"Transcribe the recording and add captions using the user's configured caption provider. Optionally pass a language hint (BCP-47, e.g. 'en'); omit to auto-detect.",
		category: "captions",
		destructive: false,
		parameters: {
			type: "object",
			properties: {
				language: {
					type: "string",
					description: "Language hint, e.g. 'en'. Omit to auto-detect.",
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: "set_background",
		description:
			"Set the scene background. Pass a wallpaper id, or a hex color like '#101014', or 'none'.",
		category: "scene",
		destructive: false,
		parameters: {
			type: "object",
			properties: {
				value: { type: "string", description: "Wallpaper id, hex color, or 'none'" },
			},
			required: ["value"],
			additionalProperties: false,
		},
	},
	{
		name: "set_padding",
		description: "Set the padding (inset) around the video in the frame, 0–200 px.",
		category: "scene",
		destructive: false,
		parameters: {
			type: "object",
			properties: { px: { type: "integer", minimum: 0, maximum: 200 } },
			required: ["px"],
			additionalProperties: false,
		},
	},
	{
		name: "trim",
		description:
			"Trim the video to keep only the range [startMs, endMs]. Everything outside is removed.",
		category: "timeline",
		destructive: true,
		parameters: {
			type: "object",
			properties: {
				startMs: { type: "integer", minimum: 0 },
				endMs: { type: "integer", minimum: 0 },
			},
			required: ["startMs", "endMs"],
			additionalProperties: false,
		},
	},
	{
		name: "set_webcam_style",
		description:
			"Change the look of the webcam/facecam bubble. Use this for requests about the face/webcam color, ring light, or styling. ringColor is a hex color like '#ff3366' for the ring-light glow around the face. ringLight is the glow strength 0–1 (0 = off). Also supports shadow (0–1), cornerRadius/roundness (0–160 px), and size (10–100% of the frame). Only the fields you pass are changed.",
		category: "scene",
		destructive: false,
		parameters: {
			type: "object",
			properties: {
				ringColor: {
					type: "string",
					description: "Ring-light color as hex, e.g. '#ffffff' or '#ff3366'",
				},
				ringLight: {
					type: "number",
					description: "Ring-light glow strength 0–1 (0 = off)",
					minimum: 0,
					maximum: 1,
				},
				shadow: {
					type: "number",
					description: "Shadow strength 0–1",
					minimum: 0,
					maximum: 1,
				},
				cornerRadius: {
					type: "integer",
					description: "Roundness in px, 0–160",
					minimum: 0,
					maximum: 160,
				},
				size: {
					type: "integer",
					description: "Bubble size as percent of frame, 10–100",
					minimum: 10,
					maximum: 100,
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: "seek_to",
		description: "Move the playhead to a specific time in milliseconds.",
		category: "playback",
		destructive: false,
		parameters: {
			type: "object",
			properties: { timeMs: { type: "integer", minimum: 0 } },
			required: ["timeMs"],
			additionalProperties: false,
		},
	},
	{
		name: "set_playback",
		description: "Play or pause the preview.",
		category: "playback",
		destructive: false,
		parameters: {
			type: "object",
			properties: { playing: { type: "boolean" } },
			required: ["playing"],
			additionalProperties: false,
		},
	},
	{
		name: "set_setting",
		description:
			"Change an editor setting by key. Supported keys include: zoomInDurationMs, zoomOutDurationMs, connectZooms (boolean), zoomMotionBlur (0–1), soundEffectsEnabled (boolean), exportQuality, mp4FrameRate, exportFormat.",
		category: "settings",
		destructive: false,
		parameters: {
			type: "object",
			properties: {
				key: { type: "string", description: "Setting key" },
				value: {
					type: "string",
					description: "New value (stringified; numbers/booleans coerced)",
				},
			},
			required: ["key", "value"],
			additionalProperties: false,
		},
	},
	{
		name: "export_video",
		description:
			"Render and export the final video. format is 'mp4' or 'gif'. This is a heavy, hard-to-undo action.",
		category: "export",
		destructive: true,
		parameters: {
			type: "object",
			properties: {
				format: { type: "string", enum: ["mp4", "gif"] },
			},
			additionalProperties: false,
		},
	},
];

export const AGENT_TOOLS_BY_NAME: Record<string, AgentTool> = Object.fromEntries(
	AGENT_TOOLS.map((tool) => [tool.name, tool]),
);

export function isAgentToolName(name: string): boolean {
	return AGENT_TOOLS_BY_NAME[name] !== undefined;
}

/** OpenAI / OpenRouter chat-completions "tools" array shape. */
export function toOpenAITools(tools: AgentTool[] = AGENT_TOOLS) {
	return tools.map((tool) => ({
		type: "function" as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		},
	}));
}

/** Anthropic Messages API "tools" array shape. */
export function toAnthropicTools(tools: AgentTool[] = AGENT_TOOLS) {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.parameters,
	}));
}

/**
 * Lightweight argument validation against a tool's JSON schema (types, enums,
 * required, numeric bounds). Returns an error string, or null when valid.
 * Coerces nothing — callers decide how to handle the args.
 */
export function validateToolArgs(toolName: string, args: Record<string, unknown>): string | null {
	const tool = AGENT_TOOLS_BY_NAME[toolName];
	if (!tool) return `Unknown tool: ${toolName}`;

	const schema = tool.parameters;
	for (const key of schema.required ?? []) {
		if (args[key] === undefined || args[key] === null) {
			return `Missing required argument "${key}" for ${toolName}`;
		}
	}

	for (const [key, value] of Object.entries(args)) {
		const prop = schema.properties[key];
		if (!prop) {
			if (schema.additionalProperties === false) {
				return `Unexpected argument "${key}" for ${toolName}`;
			}
			continue;
		}
		const typeError = checkType(key, value, prop);
		if (typeError) return typeError;
	}

	return null;
}

function checkType(key: string, value: unknown, prop: JsonSchemaProperty): string | null {
	if (prop.type === "boolean" && typeof value !== "boolean") {
		return `Argument "${key}" must be a boolean`;
	}
	if ((prop.type === "number" || prop.type === "integer") && typeof value !== "number") {
		return `Argument "${key}" must be a number`;
	}
	if (prop.type === "integer" && !Number.isInteger(value)) {
		return `Argument "${key}" must be an integer`;
	}
	if (prop.type === "string" && typeof value !== "string") {
		return `Argument "${key}" must be a string`;
	}
	if (typeof value === "number") {
		if (prop.minimum !== undefined && value < prop.minimum) {
			return `Argument "${key}" must be ≥ ${prop.minimum}`;
		}
		if (prop.maximum !== undefined && value > prop.maximum) {
			return `Argument "${key}" must be ≤ ${prop.maximum}`;
		}
	}
	if (prop.enum && !prop.enum.includes(value as string | number)) {
		return `Argument "${key}" must be one of: ${prop.enum.join(", ")}`;
	}
	return null;
}
