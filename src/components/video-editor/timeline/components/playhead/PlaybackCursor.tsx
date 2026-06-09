import { useTimelineContext } from "dnd-timeline";
import { useEffect, useState, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { TIMELINE_MONO_FONT } from "../../core/constants";
import { formatPlayheadTime } from "../../core/time";

interface PlaybackCursorProps {
	currentTimeMs: number;
	videoDurationMs: number;
	onSeek?: (time: number) => void;
	timelineRef: RefObject<HTMLDivElement>;
	keyframes?: { id: string; time: number }[];
	isLoading?: boolean;
}

export default function PlaybackCursor({
	currentTimeMs,
	videoDurationMs,
	onSeek,
	timelineRef,
	keyframes = [],
	isLoading = false,
}: PlaybackCursorProps) {
	const { sidebarWidth, direction, range, valueToPixels, pixelsToValue } = useTimelineContext();
	const sideProperty = direction === "rtl" ? "right" : "left";
	const [isDragging, setIsDragging] = useState(false);

	useEffect(() => {
		if (!isDragging) return;

		const handleMouseMove = (e: MouseEvent) => {
			if (!timelineRef.current || !onSeek) return;
			const rect = timelineRef.current.getBoundingClientRect();
			const clickX = e.clientX - rect.left - sidebarWidth;
			const relativeMs = pixelsToValue(clickX);
			let absoluteMs = Math.max(0, Math.min(range.start + relativeMs, videoDurationMs));

			const snapThresholdMs = 150;
			const nearbyKeyframe = keyframes.find(
				(kf) =>
					Math.abs(kf.time - absoluteMs) <= snapThresholdMs &&
					kf.time >= range.start &&
					kf.time <= range.end,
			);
			if (nearbyKeyframe) absoluteMs = nearbyKeyframe.time;

			onSeek(absoluteMs / 1000);
		};

		const handleMouseUp = () => {
			setIsDragging(false);
			document.body.style.cursor = "";
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		document.body.style.cursor = "ew-resize";

		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
			document.body.style.cursor = "";
		};
	}, [
		isDragging,
		onSeek,
		timelineRef,
		sidebarWidth,
		range.start,
		range.end,
		videoDurationMs,
		pixelsToValue,
		keyframes,
	]);

	if (videoDurationMs <= 0 || currentTimeMs < 0) return null;
	const clampedTime = Math.min(currentTimeMs, videoDurationMs);
	if (clampedTime < range.start || clampedTime > range.end) return null;

	const offset = valueToPixels(clampedTime - range.start);

	return (
		<div
			className="absolute top-0 bottom-0 z-50 group/cursor"
			style={{
				[sideProperty === "right" ? "marginRight" : "marginLeft"]: `${sidebarWidth - 1}px`,
				pointerEvents: "none",
			}}
		>
			<div
				className="absolute top-0 bottom-0 w-px bg-[#f5f5f6] cursor-ew-resize pointer-events-auto transition-colors"
				style={{ [sideProperty]: `${offset}px` }}
				onMouseDown={(e) => {
					e.stopPropagation();
					setIsDragging(true);
				}}
			>
				{/* Small white triangle handle */}
				<div
					className="absolute -top-px left-1/2 -translate-x-1/2 hover:scale-110 transition-transform"
					style={{ width: "10px", height: "10px" }}
				>
					<div
						className="mx-auto h-0 w-0"
						style={{
							borderLeft: "5px solid transparent",
							borderRight: "5px solid transparent",
							borderTop: "6px solid #f5f5f6",
						}}
					/>
				</div>
				<div
					className={cn(
						"absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-md bg-[#1a1a1e] text-[10px] text-[#f5f5f6] tabular-nums whitespace-nowrap border border-[#26262b] shadow-lg pointer-events-none transition-opacity",
						(isDragging || isLoading) ? "opacity-100" : "opacity-0",
					)}
					style={{ fontFamily: TIMELINE_MONO_FONT }}
				>
					<div className="flex items-center">
						{formatPlayheadTime(clampedTime).split("").map((char, i) => (
							<span
								key={i}
								className={cn(
									"leading-5 whitespace-pre",
									isLoading && "bg-gradient-to-r from-white/40 via-white to-white/40 bg-clip-text text-transparent animate-text-shimmer"
								)}
								style={isLoading ? {
									animationDelay: `${i * 0.05}s`,
									animationDuration: "2.5s",
								} : undefined}
							>
								{char}
							</span>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
