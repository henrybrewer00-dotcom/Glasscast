import {
	Check,
	CaretDown as ChevronDown,
	Crop,
	ChatText as MessageSquare,
	MusicNote as Music,
	Scissors,
	MagicWand as WandSparkles,
	MagnifyingGlassPlus as ZoomIn,
} from "@phosphor-icons/react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { TIMELINE_MONO_FONT } from "../../core/constants";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	ASPECT_RATIOS,
	type AspectRatio,
	getAspectRatioLabel,
	isCustomAspectRatio,
} from "@/utils/aspectRatioUtils";

interface TimelineToolbarProps {
	aspectRatio: AspectRatio;
	isCropped: boolean;
	scrollLabels: { pan: string; zoom: string };
	customAspectWidth: string;
	customAspectHeight: string;
	onCustomAspectWidthChange: (value: string) => void;
	onCustomAspectHeightChange: (value: string) => void;
	onCustomAspectRatioKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
	onApplyCustomAspectRatio: () => void;
	onAspectRatioChange?: (aspectRatio: AspectRatio) => void;
	onOpenCropEditor?: () => void;
	onAddZoom: () => void;
	onSuggestZooms: () => void;
	onAddAnnotation: () => void;
	onAddAudio: () => void;
	onSplitClip: () => void;
	cropLabel: string;
	addZoomLabel: string;
	suggestZoomsLabel: string;
	addAnnotationLabel: string;
	addAudioLabel: string;
	splitClipLabel: string;
	/** Mono duration readout shown right-aligned inside the dock strip. */
	durationLabel?: string;
}

export default function TimelineToolbar({
	aspectRatio,
	isCropped,
	scrollLabels,
	customAspectWidth,
	customAspectHeight,
	onCustomAspectWidthChange,
	onCustomAspectHeightChange,
	onCustomAspectRatioKeyDown,
	onApplyCustomAspectRatio,
	onAspectRatioChange,
	onOpenCropEditor,
	onAddZoom,
	onSuggestZooms,
	onAddAnnotation,
	onAddAudio,
	onSplitClip,
	cropLabel,
	addZoomLabel,
	suggestZoomsLabel,
	addAnnotationLabel,
	addAudioLabel,
	splitClipLabel,
	durationLabel,
}: TimelineToolbarProps) {
	return (
		// Compact left-aligned instrument strip inside the floating dock: no
		// full-bleed background or edge border (the dock wrapper owns those), just a
		// hairline divider under the controls and a mono duration readout at right.
		<div className="flex items-center gap-2 px-2 py-1 border-b border-[#26262b]/80">
			{/* Flat instrument icon strip — record-red is the only accent on hover */}
			<div className="flex items-center gap-0.5">
				<Button onClick={onAddZoom} variant="ghost" size="icon" className="h-7 w-7 rounded-md text-[#8a8a93] hover:text-[#f5f5f6] hover:bg-[#1a1a1e] transition-colors duration-150" title={addZoomLabel} aria-label={addZoomLabel}>
					<ZoomIn className="w-4 h-4" />
				</Button>
				<Button onClick={onSuggestZooms} variant="ghost" size="icon" className="h-7 w-7 rounded-md text-[#8a8a93] hover:text-[#f5f5f6] hover:bg-[#1a1a1e] transition-colors duration-150" title={suggestZoomsLabel} aria-label={suggestZoomsLabel}>
					<WandSparkles className="w-4 h-4" />
				</Button>
				<div className="mx-0.5 h-4 w-px bg-[#26262b]" />
				<Button onClick={onAddAnnotation} variant="ghost" size="icon" className="h-7 w-7 rounded-md text-[#8a8a93] hover:text-[#f5f5f6] hover:bg-[#1a1a1e] transition-colors duration-150" title={addAnnotationLabel} aria-label={addAnnotationLabel}>
					<MessageSquare className="w-4 h-4" />
				</Button>
				<Button onClick={onAddAudio} variant="ghost" size="icon" className="h-7 w-7 rounded-md text-[#8a8a93] hover:text-[#f5f5f6] hover:bg-[#1a1a1e] transition-colors duration-150" title={addAudioLabel} aria-label={addAudioLabel}>
					<Music className="w-4 h-4" />
				</Button>
				<Button onClick={onSplitClip} variant="ghost" size="icon" className="h-7 w-7 rounded-md text-[#8a8a93] hover:text-[#f5f5f6] hover:bg-[#1a1a1e] transition-colors duration-150" title={splitClipLabel} aria-label={splitClipLabel}>
					<Scissors className="w-4 h-4" />
				</Button>
			</div>
			<div className="mx-0.5 h-4 w-px bg-[#26262b]" />
			<div className="flex items-center gap-1.5">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="sm" className="h-7 px-2 rounded-md text-[11px] text-[#8a8a93] hover:text-[#f5f5f6] hover:bg-[#1a1a1e] transition-colors duration-150 gap-1">
							<span className="font-medium tabular-nums" style={{ fontFamily: TIMELINE_MONO_FONT }}>{getAspectRatioLabel(aspectRatio)}</span>
							<ChevronDown className="w-3 h-3" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="bg-[#1a1a1e] border-[#26262b]">
						{ASPECT_RATIOS.map((ratio) => (
							<DropdownMenuItem key={ratio} onClick={() => onAspectRatioChange?.(ratio)} className="text-[#8a8a93] hover:text-[#f5f5f6] hover:bg-[#26262b] cursor-pointer flex items-center justify-between gap-3">
								<span className="tabular-nums" style={{ fontFamily: TIMELINE_MONO_FONT }}>{getAspectRatioLabel(ratio)}</span>
								{aspectRatio === ratio && <Check className="w-3 h-3 text-[#ff3b30]" />}
							</DropdownMenuItem>
						))}
						<div className="mx-1 my-1 h-px bg-[#26262b]" />
						<div className="px-2 py-1.5 flex items-center gap-2 text-[#8a8a93]">
							<span className="text-[10px] font-semibold uppercase tracking-[0.1em]">Custom</span>
							<input type="text" inputMode="numeric" value={customAspectWidth} onChange={(event) => onCustomAspectWidthChange(event.target.value.replace(/\D/g, ""))} onKeyDown={onCustomAspectRatioKeyDown} style={{ fontFamily: TIMELINE_MONO_FONT }} className="w-12 h-7 rounded-md border border-[#26262b] bg-[#0c0c0e] px-1.5 text-sm tabular-nums text-[#f5f5f6] focus:outline-none focus:ring-2 focus:ring-[rgba(255,59,48,0.55)]" aria-label="Custom aspect width" />
							<span className="text-[#4a4a52]">:</span>
							<input type="text" inputMode="numeric" value={customAspectHeight} onChange={(event) => onCustomAspectHeightChange(event.target.value.replace(/\D/g, ""))} onKeyDown={onCustomAspectRatioKeyDown} style={{ fontFamily: TIMELINE_MONO_FONT }} className="w-12 h-7 rounded-md border border-[#26262b] bg-[#0c0c0e] px-1.5 text-sm tabular-nums text-[#f5f5f6] focus:outline-none focus:ring-2 focus:ring-[rgba(255,59,48,0.55)]" aria-label="Custom aspect height" />
							<Button variant="ghost" size="sm" onClick={onApplyCustomAspectRatio} className="h-7 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8a8a93] hover:text-[#f5f5f6] hover:bg-[#26262b]">Set</Button>
							{isCustomAspectRatio(aspectRatio) && <Check className="w-3 h-3 text-[#ff3b30] ml-auto" />}
						</div>
					</DropdownMenuContent>
				</DropdownMenu>
				<div className="h-4 w-px bg-[#26262b]" />
				<Button
					variant="ghost"
					size="sm"
					onClick={onOpenCropEditor}
					disabled={!onOpenCropEditor}
					className="h-7 px-2 rounded-md text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8a8a93] hover:text-[#f5f5f6] hover:bg-[#1a1a1e] transition-colors duration-150 gap-1.5"
				>
					<Crop className="w-3.5 h-3.5" />
					<span>{cropLabel}</span>
					{isCropped ? <span className="h-1.5 w-1.5 rounded-full bg-[#ff3b30]" /> : null}
				</Button>
			</div>
			<div className="flex-1" />
			{/* Pan/zoom hints — tucked, secondary; hidden until the dock is wide. */}
			<div className="hidden xl:flex items-center gap-2.5 text-[9px] uppercase tracking-[0.1em] text-[#4a4a52]">
				<span className="flex items-center gap-1.5">
					<kbd className="px-1.5 py-0.5 bg-[#131316] border border-[#26262b] rounded-md text-[#8a8a93]" style={{ fontFamily: TIMELINE_MONO_FONT }}>{scrollLabels.pan}</kbd>
					<span>Pan</span>
				</span>
				<span className="flex items-center gap-1.5">
					<kbd className="px-1.5 py-0.5 bg-[#131316] border border-[#26262b] rounded-md text-[#8a8a93]" style={{ fontFamily: TIMELINE_MONO_FONT }}>{scrollLabels.zoom}</kbd>
					<span>Zoom</span>
				</span>
			</div>
			{durationLabel ? (
				<>
					<div className="mx-0.5 h-4 w-px bg-[#26262b]" />
					<span
						className="text-[11px] tabular-nums text-[#8a8a93]"
						style={{ fontFamily: TIMELINE_MONO_FONT }}
						aria-label="Timeline duration"
					>
						{durationLabel}
					</span>
				</>
			) : null}
		</div>
	);
}
