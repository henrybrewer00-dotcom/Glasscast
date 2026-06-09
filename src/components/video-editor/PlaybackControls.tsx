import { Pause, Play, SpeakerHigh as Volume2, SpeakerX as VolumeX } from "@phosphor-icons/react";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

interface PlaybackControlsProps {
	isPlaying: boolean;
	currentTime: number;
	duration: number;
	onTogglePlayPause: () => void;
	onSeek: (time: number) => void;
	volume: number;
	onVolumeChange: (volume: number) => void;
}

export default function PlaybackControls({
	isPlaying,
	currentTime,
	duration,
	onTogglePlayPause,
	onSeek,
	volume,
	onVolumeChange,
}: PlaybackControlsProps) {
	const t = useScopedT("editor");
	function formatTime(seconds: number) {
		if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) return "00:00:00";
		const hrs = Math.floor(seconds / 3600);
		const mins = Math.floor((seconds % 3600) / 60);
		const secs = Math.floor(seconds % 60);
		return `${hrs.toString().padStart(2, "0")}:${mins
			.toString()
			.padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
	}

	function handleSeekChange(e: React.ChangeEvent<HTMLInputElement>) {
		onSeek(parseFloat(e.target.value));
	}

	function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
		onVolumeChange(Number(e.target.value));
	}

	const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

	return (
		<div className="flex items-center gap-3 px-3 pr-4 py-1.5 rounded-lg bg-[hsl(240_5%_4%/0.9)] backdrop-blur-md border border-white/10 transition-colors duration-200 hover:border-white/20">
			<Button
				onClick={onTogglePlayPause}
				size="icon"
				className={cn(
					"w-7 h-7 rounded-md transition-all duration-200 border border-white/10",
					isPlaying
						? "bg-white/10 text-white hover:bg-white/20"
						: "bg-white text-black hover:bg-white/90",
				)}
				aria-label={isPlaying ? t("playback.pause") : t("playback.play")}
			>
				{isPlaying ? (
					<Pause className="w-3.5 h-3.5" weight="fill" />
				) : (
					<Play className="w-3.5 h-3.5" weight="fill" />
				)}
			</Button>

			<span className="font-mono text-[11px] tracking-tight text-white/90 tabular-nums whitespace-nowrap">
				{formatTime(currentTime)}
				<span className="text-white/35"> / </span>
				<span className="text-white/45">{formatTime(duration)}</span>
			</span>

			<div className="flex-1 relative h-6 flex items-center group min-w-[120px]">
				{/* Track background — hairline */}
				<div className="absolute left-0 right-0 h-[3px] bg-white/12 rounded-full overflow-hidden">
					<div
						className="h-full bg-[var(--brand-accent)] rounded-full"
						style={{ width: `${progress}%` }}
					/>
				</div>

				{/* Interactive Input */}
				<input
					type="range"
					min="0"
					max={duration || 100}
					value={currentTime}
					onChange={handleSeekChange}
					step="0.01"
					className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
				/>

				{/* Thumb (visual only, follows progress) */}
				<div
					className="absolute w-2.5 h-2.5 bg-[var(--brand-accent)] rounded-full pointer-events-none opacity-0 group-hover:opacity-100 group-hover:scale-110 transition-all duration-150"
					style={{
						left: `${progress}%`,
						transform: "translateX(-50%)",
					}}
				/>
			</div>

			<div className="flex items-center gap-1.5 pl-1">
				{volume <= 0.001 ? (
					<VolumeX className="h-3.5 w-3.5 text-white/60" />
				) : (
					<Volume2 className="h-3.5 w-3.5 text-white/60" />
				)}
				<div className="group relative flex h-6 w-16 items-center">
					<div className="absolute left-0 right-0 h-[3px] rounded-full bg-white/12 overflow-hidden">
						<div
							className="h-full rounded-full bg-white/70"
							style={{ width: `${volume * 100}%` }}
						/>
					</div>
					<input
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={volume}
						onChange={handleVolumeChange}
						className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
					/>
					<div
						className="pointer-events-none absolute h-2.5 w-2.5 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-opacity duration-150"
						style={{ left: `${volume * 100}%`, transform: "translateX(-50%)" }}
					/>
				</div>
			</div>
		</div>
	);
}
