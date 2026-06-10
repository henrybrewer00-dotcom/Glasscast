import { type CSSProperties, useEffect, useRef, useState } from "react";
import { XIcon } from "@phosphor-icons/react";
import { deleteCaptionCue, setCaptionCueText } from "./captionEditing";
import type { CaptionCue } from "./types";

function formatCueTime(ms: number) {
	const totalSeconds = Math.max(0, ms) / 1000;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds - minutes * 60;
	return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function CaptionCueRow({
	cue,
	onCommit,
	onDelete,
	onSeek,
}: {
	cue: CaptionCue;
	onCommit: (text: string) => void;
	onDelete: () => void;
	onSeek?: (ms: number) => void;
}) {
	const [draft, setDraft] = useState(cue.text);
	const editingRef = useRef(false);

	// Reflect external changes (regenerate, undo) unless the row is being edited.
	useEffect(() => {
		if (!editingRef.current) {
			setDraft(cue.text);
		}
	}, [cue.text]);

	const commit = () => {
		editingRef.current = false;
		const trimmed = draft.trim();
		if (!trimmed) {
			setDraft(cue.text);
			return;
		}
		if (trimmed !== cue.text) {
			onCommit(trimmed);
		}
	};

	return (
		<div className="group flex items-start gap-2 rounded-lg bg-foreground/[0.03] px-2 py-1.5">
			<button
				type="button"
				onClick={() => onSeek?.(cue.startMs)}
				className="mt-1 shrink-0 rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
				title="Jump to this caption"
			>
				{formatCueTime(cue.startMs)}
			</button>
			<textarea
				value={draft}
				rows={1}
				spellCheck={false}
				onFocus={() => {
					editingRef.current = true;
				}}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						event.currentTarget.blur();
					}
					if (event.key === "Escape") {
						editingRef.current = false;
						setDraft(cue.text);
						event.currentTarget.blur();
					}
				}}
				className="min-h-[28px] flex-1 resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs leading-snug text-foreground outline-none transition-colors focus:border-foreground/15 focus:bg-foreground/5"
				style={{ fieldSizing: "content" } as CSSProperties}
			/>
			<button
				type="button"
				onClick={onDelete}
				className="mt-1 shrink-0 rounded p-0.5 text-muted-foreground/50 opacity-0 transition-all hover:text-foreground group-hover:opacity-100"
				title="Delete caption"
			>
				<XIcon size={12} />
			</button>
		</div>
	);
}

/**
 * Editable transcript: every generated cue can be reworded, deleted, or used
 * to jump the playhead. Word timings are rebuilt proportionally on edit so
 * karaoke highlighting keeps working.
 */
export function CaptionTranscriptEditor({
	cues,
	onChange,
	onSeek,
}: {
	cues: CaptionCue[];
	onChange: (cues: CaptionCue[]) => void;
	onSeek?: (ms: number) => void;
}) {
	if (cues.length === 0) {
		return null;
	}

	return (
		<div className="flex max-h-72 flex-col gap-1 overflow-y-auto pr-0.5 custom-scrollbar">
			{cues.map((cue) => (
				<CaptionCueRow
					key={cue.id}
					cue={cue}
					onCommit={(text) => onChange(setCaptionCueText(cues, cue.id, text))}
					onDelete={() => onChange(deleteCaptionCue(cues, cue.id))}
					onSeek={onSeek}
				/>
			))}
		</div>
	);
}
