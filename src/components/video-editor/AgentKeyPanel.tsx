import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAgentSettings } from "@/lib/agent/AgentSettingsContext";
import { type AgentPermissionLevel } from "@/lib/agent/agentCore";
import { AGENT_PROVIDERS, type AgentProviderId } from "@/lib/agent/providers";
import { cn } from "@/lib/utils";

const PROVIDER_ORDER: AgentProviderId[] = ["anthropic", "openai", "openrouter"];

const PERMISSION_OPTIONS: Array<{ value: AgentPermissionLevel; label: string; hint: string }> = [
	{ value: "suggest", label: "Suggest", hint: "Only proposes — you apply changes" },
	{ value: "assist", label: "Assist", hint: "Auto-applies edits, asks before delete/export" },
	{ value: "autopilot", label: "Autopilot", hint: "Does everything, no confirmations" },
];

/**
 * BYOK key + provider + permission management for the AI agent. Lives in its own
 * inspector tab (separate from the chat) and shares state via AgentSettingsContext,
 * so keys set here are used by the AI chat panel. No sign-in required.
 */
export function AgentKeyPanel() {
	const {
		provider,
		setProvider,
		permission,
		setPermission,
		statuses,
		hasKey,
		saveKey,
		deleteKey,
	} = useAgentSettings();
	const [keyDraft, setKeyDraft] = useState("");

	const activeHasKey = hasKey(provider);
	const last4 = statuses.find((s) => s.provider === provider)?.last4;

	const handleSave = async () => {
		if (!keyDraft.trim()) return;
		const ok = await saveKey(provider, keyDraft.trim());
		if (ok) setKeyDraft("");
	};

	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-semibold text-foreground">AI Keys</span>
				<span className="rounded-full bg-[var(--brand-accent)]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--brand-accent)]">
					BYOK
				</span>
			</div>
			<p className="text-[11px] text-muted-foreground">
				Bring your own API key — no sign-in needed. Keys are encrypted on this device (and
				sync across your devices when you're signed in).
			</p>

			<div className="flex gap-1.5">
				{PROVIDER_ORDER.map((id) => {
					const active = provider === id;
					return (
						<button
							key={id}
							type="button"
							onClick={() => setProvider(id)}
							className={cn(
								"relative flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all",
								active
									? "bg-[var(--brand-accent)] text-white"
									: "bg-foreground/5 text-muted-foreground hover:text-foreground",
							)}
						>
							{AGENT_PROVIDERS[id].label.split(" ")[0]}
							{hasKey(id) ? (
								<span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />
							) : null}
						</button>
					);
				})}
			</div>

			{activeHasKey ? (
				<div className="flex items-center justify-between gap-2 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-[11px] text-muted-foreground">
					<span>
						{AGENT_PROVIDERS[provider].label} key saved ••••{last4}
					</span>
					<button
						type="button"
						onClick={() => void deleteKey(provider)}
						className="text-[var(--brand-accent)] hover:opacity-80"
					>
						Remove
					</button>
				</div>
			) : (
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center gap-1.5">
						<input
							type="password"
							value={keyDraft}
							onChange={(e) => setKeyDraft(e.target.value)}
							placeholder={`Paste ${AGENT_PROVIDERS[provider].label} API key`}
							autoComplete="off"
							spellCheck={false}
							className="h-9 flex-1 rounded-lg border border-foreground/10 bg-foreground/5 px-3 text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus:bg-foreground/10"
						/>
						<Button
							type="button"
							onClick={() => void handleSave()}
							disabled={!keyDraft.trim()}
							className="h-9 rounded-lg bg-[var(--brand-accent)] px-3 text-[12px] text-white disabled:opacity-50"
						>
							Save
						</Button>
					</div>
					<a
						href={AGENT_PROVIDERS[provider].keysUrl}
						target="_blank"
						rel="noreferrer"
						className="text-[10px] text-[var(--brand-accent)] hover:opacity-80"
					>
						Get a {AGENT_PROVIDERS[provider].label} key →
					</a>
				</div>
			)}

			<div className="h-px bg-foreground/[0.06] my-1" />

			<div className="flex flex-col gap-1.5">
				<span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
					Agent permission
				</span>
				<div className="flex gap-1.5">
					{PERMISSION_OPTIONS.map((opt) => (
						<button
							key={opt.value}
							type="button"
							title={opt.hint}
							onClick={() => setPermission(opt.value)}
							className={cn(
								"flex-1 rounded-md px-1.5 py-1.5 text-[10px] font-medium transition-all",
								permission === opt.value
									? "bg-foreground/15 text-foreground"
									: "bg-foreground/5 text-muted-foreground hover:text-foreground",
							)}
						>
							{opt.label}
						</button>
					))}
				</div>
				<p className="text-[10px] text-muted-foreground/70">
					{PERMISSION_OPTIONS.find((o) => o.value === permission)?.hint}
				</p>
			</div>
		</section>
	);
}
