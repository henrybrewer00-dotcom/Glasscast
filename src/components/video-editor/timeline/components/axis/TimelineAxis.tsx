import { useTimelineContext } from "dnd-timeline";
import { useMemo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { TIMELINE_MONO_FONT } from "../../core/constants";
import { calculateAxisScale, formatTimeLabel } from "../../core/time";

interface TimelineAxisProps {
	videoDurationMs: number;
	currentTimeMs: number;
}

export default function TimelineAxis({ videoDurationMs, currentTimeMs }: TimelineAxisProps) {
	const { sidebarWidth, direction, range, valueToPixels } = useTimelineContext();
	const sideProperty = direction === "rtl" ? "right" : "left";

	const { intervalMs } = useMemo(
		() => calculateAxisScale(range.end - range.start),
		[range.end, range.start],
	);

	const markers = useMemo(() => {
		if (intervalMs <= 0) {
			return { markers: [], minorTicks: [] as number[] };
		}

		const maxTime = videoDurationMs > 0 ? videoDurationMs : range.end;
		const visibleStart = Math.max(0, Math.min(range.start, maxTime));
		const visibleEnd = Math.min(range.end, maxTime);
		const markerTimes = new Set<number>();
		const firstMarker = Math.ceil(visibleStart / intervalMs) * intervalMs;

		for (let time = firstMarker; time <= visibleEnd; time += intervalMs) {
			markerTimes.add(Math.round(time));
		}

		if (visibleStart <= maxTime) markerTimes.add(Math.round(visibleStart));
		if (videoDurationMs > 0) markerTimes.add(Math.round(videoDurationMs));

		const sorted = Array.from(markerTimes)
			.filter((time) => time <= maxTime)
			.sort((a, b) => a - b);

		const minorTicks: number[] = [];
		const minorInterval = intervalMs / 5;
		for (let time = firstMarker; time <= visibleEnd; time += minorInterval) {
			const isMajor = Math.abs(time % intervalMs) < 1;
			if (!isMajor) minorTicks.push(time);
		}

		return {
			markers: sorted.map((time) => ({ time, label: formatTimeLabel(time, intervalMs) })),
			minorTicks,
		};
	}, [intervalMs, range.end, range.start, videoDurationMs]);

	return (
		<div
			className="h-7 bg-[#0c0c0e]/80 border-b border-[#26262b] relative overflow-hidden select-none"
			style={{ [sideProperty === "right" ? "marginRight" : "marginLeft"]: `${sidebarWidth}px` }}
		>
			{markers.minorTicks.map((time) => {
				const offset = valueToPixels(time - range.start);
				return (
					<div
						key={`minor-${time}`}
						className="absolute bottom-1 h-1 w-px bg-[#26262b]"
						style={{ [sideProperty]: `${offset}px` }}
					/>
				);
			})}

			{markers.markers.map((marker) => {
				const offset = valueToPixels(marker.time - range.start);
				const markerStyle: CSSProperties = {
					position: "absolute",
					bottom: 0,
					height: "100%",
					display: "flex",
					flexDirection: "row",
					alignItems: "flex-end",
					[sideProperty]: `${offset}px`,
					transform: direction === "rtl" ? "translateX(50%)" : "translateX(-50%)",
				};

				return (
					<div key={marker.time} style={markerStyle}>
						<div className="flex flex-col items-center pb-1">
							<div
								className={cn(
									"mb-1.5 h-2 w-px",
									Math.abs(marker.time - currentTimeMs) < 1
										? "bg-[#ff3b30]"
										: "bg-[#4a4a52]",
								)}
							/>
							<span
								className={cn(
									"text-[10px] tabular-nums tracking-tight",
									Math.abs(marker.time - currentTimeMs) < 1
										? "text-[#ff3b30]"
										: "text-[#8a8a93]",
								)}
								style={{ fontFamily: TIMELINE_MONO_FONT }}
							>
								{marker.label}
							</span>
						</div>
					</div>
				);
			})}
		</div>
	);
}
