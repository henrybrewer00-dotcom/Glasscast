import { Eye, EyeSlash as EyeOff, Microphone, Waveform } from "@phosphor-icons/react";
import type { ReactElement } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { DropdownItem, HudPopover } from "./PopoverScaffold";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";

const POPOVER_ID = "teleprompter";

export function TeleprompterPopover({
	trigger,
	disabled,
	enabled,
	onToggleEnabled,
	script,
	onScriptChange,
	speed,
	onSpeedChange,
	voicePaced,
	onToggleVoicePaced,
	fontSize,
	onFontSizeChange,
}: {
	trigger: ReactElement;
	disabled?: boolean;
	enabled: boolean;
	onToggleEnabled: () => void;
	script: string;
	onScriptChange: (value: string) => void;
	speed: number;
	onSpeedChange: (value: number) => void;
	voicePaced: boolean;
	onToggleVoicePaced: () => void;
	fontSize: number;
	onFontSizeChange: (value: number) => void;
}) {
	const t = useScopedT("launch");
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const open = isOpen(POPOVER_ID);

	return (
		<HudPopover
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					requestClose(POPOVER_ID);
					return;
				}
				if (disabled) return;
				requestOpen(POPOVER_ID);
			}}
			trigger={trigger}
			align="center"
		>
			<div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--launch-label)]">
				{t("recording.teleprompter", "Teleprompter")}
			</div>

			<DropdownItem
				icon={enabled ? <Eye size={16} /> : <EyeOff size={16} />}
				selected={enabled}
				onClick={onToggleEnabled}
			>
				{enabled
					? t("recording.teleprompterOn", "Teleprompter on")
					: t("recording.teleprompterOff", "Teleprompter off")}
			</DropdownItem>

			<DropdownItem
				icon={voicePaced ? <Waveform size={16} /> : <Microphone size={16} />}
				selected={voicePaced}
				onClick={onToggleVoicePaced}
			>
				{voicePaced
					? t("recording.teleprompterVoicePaced", "Pace to my voice")
					: t("recording.teleprompterSteady", "Steady speed")}
			</DropdownItem>

			<div
				className="px-3 py-2"
				data-hud-interactive
				onPointerDown={(e) => e.stopPropagation()}
			>
				<textarea
					value={script}
					onChange={(e) => onScriptChange(e.target.value)}
					placeholder={t(
						"recording.teleprompterPlaceholder",
						"Paste your script here…",
					)}
					spellCheck={false}
					className="h-40 w-72 resize-none rounded-lg bg-[var(--launch-hover)] p-2 text-xs leading-relaxed text-[var(--launch-text)] outline-none ring-1 ring-[var(--launch-border-strong)] focus:ring-[var(--brand-accent)]"
				/>
				<div className="mt-2 flex flex-col gap-2 text-[11px] text-[var(--launch-text-muted)]">
					<label className="flex items-center justify-between gap-2">
						<span>{t("recording.teleprompterSpeed", "Speed")}</span>
						<input
							type="range"
							min={10}
							max={120}
							step={5}
							value={speed}
							onChange={(e) => onSpeedChange(Number(e.target.value))}
							className="w-40 accent-[var(--brand-accent)]"
						/>
					</label>
					<label className="flex items-center justify-between gap-2">
						<span>{t("recording.teleprompterFontSize", "Text size")}</span>
						<input
							type="range"
							min={20}
							max={64}
							step={2}
							value={fontSize}
							onChange={(e) => onFontSizeChange(Number(e.target.value))}
							className="w-40 accent-[var(--brand-accent)]"
						/>
					</label>
				</div>
				<p className="mt-2 text-[10px] leading-snug text-[var(--launch-text-muted)]">
					{t(
						"recording.teleprompterHint",
						"Shown only while recording, hidden from the recording itself. Scrolls as you speak.",
					)}
				</p>
			</div>
		</HudPopover>
	);
}
