import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAgentSettings } from "@/lib/agent/AgentSettingsContext";
import { AgentChatError, createModelCaller } from "@/lib/agent/agentClient";
import { buildAgentSystemPrompt, runAgent } from "@/lib/agent/agentCore";
import { AGENT_PROVIDERS, getModelDisplayName, type ToolCall } from "@/lib/agent/providers";
import { AGENT_TOOLS } from "@/lib/agent/tools";
import { cn } from "@/lib/utils";

export interface AgentToolResult {
	ok: boolean;
	message: string;
}

export interface AgentPanelProps {
	/** Apply a tool call to the live editor; returns a short result for the model. */
	executeTool: (call: ToolCall) => Promise<AgentToolResult>;
	/** A short text summary of the current project so the agent can "see the canvas". */
	getProjectSummary: () => string;
	/** Jump to the AI Keys tab (shown from the no-key empty state). */
	onOpenKeys?: () => void;
}

type ChatEntry =
	| { kind: "user"; text: string }
	| { kind: "assistant"; text: string }
	| { kind: "action"; text: string; ok: boolean }
	| { kind: "error"; text: string };

const ADD_CUSTOM = "__add_custom__";

const LAUNCH_VIDEO_PROMPT =
	"Turn this raw screen recording into a punchy launch/promo video. First call get_project_state to see the duration and any cursor activity. Then: add several well-timed zooms on the key moments (use auto_suggest_zooms if cursor data exists, otherwise add_zoom across the timeline), give the most important ones a cinematic 3D camera style (tilt3d or dolly) via update_selected_zoom, set a clean background, and add captions. Keep it tasteful and energetic. Explain what you did at the end.";

const QUICK_PROMPTS = ["Add captions", "Zoom in on the cursor", "Make it more dynamic"];

export function AgentPanel({ executeTool, getProjectSummary, onOpenKeys }: AgentPanelProps) {
	const { provider, model, setModel, permission, customModels, addCustomModel, hasKey } =
		useAgentSettings();
	const [chat, setChat] = useState<ChatEntry[]>([]);
	const [input, setInput] = useState("");
	const [running, setRunning] = useState(false);
	const [customDraft, setCustomDraft] = useState<string | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
	}, [chat]);

	const providerHasKey = hasKey(provider);
	const modelOptions = [...AGENT_PROVIDERS[provider].models, ...customModels];

	const push = useCallback((entry: ChatEntry) => {
		setChat((prev) => [...prev, entry]);
	}, []);

	const send = useCallback(
		async (prompt: string) => {
			const trimmed = prompt.trim();
			if (!trimmed || running || !providerHasKey) return;
			push({ kind: "user", text: trimmed });
			setInput("");
			setRunning(true);

			const system = buildAgentSystemPrompt(getProjectSummary());
			const callModel = createModelCaller({ provider, model, system, tools: AGENT_TOOLS });

			try {
				await runAgent({
					prompt: trimmed,
					callModel,
					executeTool: async (call) => executeTool(call),
					permission,
					confirmDestructive: async (call) =>
						window.confirm(`Allow the AI to run "${call.name}"?`),
					onEvent: (event) => {
						if (event.type === "assistant_text" && event.text.trim()) {
							push({ kind: "assistant", text: event.text.trim() });
						} else if (event.type === "tool_result") {
							push({
								kind: "action",
								text: `${event.call.name}: ${event.result.message}`,
								ok: event.result.ok,
							});
						} else if (event.type === "tool_skipped") {
							push({
								kind: "action",
								text: `${event.call.name}: ${event.reason}`,
								ok: false,
							});
						}
					},
				});
			} catch (error) {
				const message =
					error instanceof AgentChatError
						? error.message
						: error instanceof Error
							? error.message
							: "Something went wrong.";
				push({ kind: "error", text: message });
			} finally {
				setRunning(false);
			}
		},
		[
			executeTool,
			getProjectSummary,
			model,
			permission,
			provider,
			providerHasKey,
			push,
			running,
		],
	);

	// ── No key yet → a clean, prominent setup call-to-action ──────────────────
	if (!providerHasKey) {
		return (
			<section className="flex min-h-[300px] flex-col items-center justify-center gap-4 px-4 py-8 text-center">
				<div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--brand-accent)]/30 to-[var(--brand-accent)]/5 text-3xl shadow-[0_0_40px_-12px_var(--brand-accent)]">
					✨
				</div>
				<div className="space-y-1.5">
					<h3 className="text-base font-semibold text-foreground">
						Set up your AI editor
					</h3>
					<p className="mx-auto max-w-[240px] text-[12px] leading-relaxed text-muted-foreground">
						Add an API key and the AI can edit your video for you — "zoom in here", "add
						captions", "make a launch video". No sign-in needed.
					</p>
				</div>
				<Button
					type="button"
					onClick={() => onOpenKeys?.()}
					className="h-11 w-full max-w-[260px] rounded-xl bg-[var(--brand-accent)] text-sm font-semibold text-white shadow-lg shadow-[var(--brand-accent)]/25 transition-all hover:bg-[var(--brand-accent)]/90 hover:shadow-[var(--brand-accent)]/40"
				>
					Set up API key →
				</Button>
				<p className="text-[10px] text-muted-foreground/60">
					Works with OpenAI, Anthropic (Claude), or OpenRouter
				</p>
			</section>
		);
	}

	// ── Key set → the full agent ──────────────────────────────────────────────
	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<span className="text-sm font-semibold text-foreground">AI Agent</span>
					<span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-400">
						Ready
					</span>
				</div>
				{customDraft === null ? (
					<select
						value={model}
						onChange={(e) => {
							if (e.target.value === ADD_CUSTOM) setCustomDraft("");
							else setModel(e.target.value);
						}}
						className="h-7 max-w-[130px] rounded-lg border border-foreground/10 bg-foreground/5 px-2 text-[11px] font-medium text-foreground outline-none transition-colors hover:bg-foreground/10"
					>
						{modelOptions.map((m) => (
							<option key={m} value={m}>
								{getModelDisplayName(m)}
							</option>
						))}
						{!modelOptions.includes(model) ? (
							<option value={model}>{getModelDisplayName(model)}</option>
						) : null}
						<option value={ADD_CUSTOM}>＋ Add custom…</option>
					</select>
				) : (
					<div className="flex items-center gap-1">
						<input
							// biome-ignore lint/a11y/noAutofocus: focus the field the user just opened
							autoFocus
							value={customDraft}
							onChange={(e) => setCustomDraft(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && customDraft.trim()) {
									addCustomModel(customDraft.trim());
									setCustomDraft(null);
								} else if (e.key === "Escape") {
									setCustomDraft(null);
								}
							}}
							placeholder="model id"
							className="h-7 w-[120px] rounded-lg border border-foreground/10 bg-foreground/5 px-2 text-[11px] text-foreground outline-none"
						/>
						<button
							type="button"
							onClick={() => {
								if (customDraft.trim()) addCustomModel(customDraft.trim());
								setCustomDraft(null);
							}}
							className="h-7 rounded-lg bg-[var(--brand-accent)] px-2 text-[11px] text-white"
						>
							Add
						</button>
					</div>
				)}
			</div>

			{/* Launch video — hero action */}
			<button
				type="button"
				disabled={running}
				onClick={() => void send(LAUNCH_VIDEO_PROMPT)}
				className="group relative h-12 w-full overflow-hidden rounded-2xl bg-gradient-to-r from-[var(--brand-accent)] to-[#ff6b5a] text-sm font-semibold text-white shadow-lg shadow-[var(--brand-accent)]/25 transition-all hover:shadow-[var(--brand-accent)]/40 disabled:opacity-60"
			>
				<span className="relative z-10 flex items-center justify-center gap-2">
					✨ Make a Launch Video
				</span>
			</button>

			{/* Chat transcript */}
			<div
				ref={scrollRef}
				className="flex max-h-72 min-h-28 flex-col gap-2 overflow-y-auto rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-2.5"
			>
				{chat.length === 0 ? (
					<div className="m-auto flex flex-col items-center gap-2 py-3">
						<p className="text-[11px] text-muted-foreground/70">Try one of these:</p>
						<div className="flex flex-wrap justify-center gap-1.5">
							{QUICK_PROMPTS.map((q) => (
								<button
									key={q}
									type="button"
									onClick={() => void send(q)}
									className="rounded-full border border-foreground/10 bg-foreground/5 px-2.5 py-1 text-[10px] text-foreground/80 transition-colors hover:bg-foreground/10 hover:text-foreground"
								>
									{q}
								</button>
							))}
						</div>
					</div>
				) : (
					chat.map((entry, i) => (
						<div
							key={i}
							className={cn(
								"max-w-[90%] rounded-2xl px-3 py-1.5 text-[11px] leading-snug",
								entry.kind === "user" &&
									"self-end bg-[var(--brand-accent)] text-white shadow-sm",
								entry.kind === "assistant" &&
									"self-start bg-foreground/[0.06] text-foreground",
								entry.kind === "action" &&
									cn(
										"self-start font-medium",
										entry.ok
											? "bg-emerald-500/10 text-emerald-300"
											: "bg-amber-500/10 text-amber-300",
									),
								entry.kind === "error" && "self-start bg-red-500/10 text-red-300",
							)}
						>
							{entry.kind === "action" ? `⚙ ${entry.text}` : entry.text}
						</div>
					))
				)}
				{running ? (
					<div className="flex items-center gap-1.5 self-start rounded-2xl bg-foreground/[0.06] px-3 py-1.5 text-[11px] text-muted-foreground">
						<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--brand-accent)]" />
						Working…
					</div>
				) : null}
			</div>

			{/* Input */}
			<div className="flex items-end gap-2 rounded-2xl border border-foreground/10 bg-foreground/5 p-1.5 focus-within:border-[var(--brand-accent)]/40">
				<textarea
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							void send(input);
						}
					}}
					rows={2}
					placeholder="Tell the AI what to do…"
					className="max-h-28 flex-1 resize-none bg-transparent px-2 py-1.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
				/>
				<button
					type="button"
					disabled={running || !input.trim()}
					onClick={() => void send(input)}
					className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--brand-accent)] text-white transition-all hover:bg-[var(--brand-accent)]/90 disabled:opacity-40"
					aria-label="Send"
				>
					↑
				</button>
			</div>
		</section>
	);
}
