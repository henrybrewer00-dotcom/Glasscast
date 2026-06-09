import { AppWindowIcon, CaretUpIcon, MonitorIcon } from "@phosphor-icons/react";
import * as React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import {
	type DesktopSource,
	isScreenSource,
	isWindowSource,
	mapRawSource,
} from "./popovers/launchPopoverTypes";
import "./launchTheme.css";
import "./SourceSelector.css";
import { useHudInteraction } from "./contexts/HudInteractionContext";

interface SourceSelectorProps {
	/** List of available screen sources */
	screenSources?: DesktopSource[];
	/** List of available window sources */
	windowSources?: DesktopSource[];
	/** Currently selected source name */
	selectedSource?: string;
	/** Loading state */
	loading?: boolean;
	/** Callback when a source is selected */
	onSourceSelect?: (source: DesktopSource) => void;
	/** Callback to fetch sources */
	onFetchSources?: () => Promise<void>;
	/** Whether the popover is open */
	open?: boolean;
	/** Callback when open state changes */
	onOpenChange?: (open: boolean) => void;
	/** Optional custom trigger element */
	children?: React.ReactNode;
}

export function MarqueeText({ text }: { text: string }) {
	const staticRef = useRef<HTMLSpanElement>(null);
	const [overflowing, setOverflowing] = useState(false);

	useLayoutEffect(() => {
		const node = staticRef.current;
		if (!node) return;
		const checkOverflow = () => {
			setOverflowing(node.scrollWidth > node.clientWidth + 1);
		};
		checkOverflow();
		const observer = new ResizeObserver(checkOverflow);
		observer.observe(node);
		return () => observer.disconnect();
	}, [text]);

	return (
		<div
			className="w-full source-selector-marquee"
			data-overflowing={overflowing ? "true" : "false"}
		>
			<span ref={staticRef} className="source-selector-marquee-static">
				{text}
			</span>
			<span className="source-selector-marquee-animated">
				<span className="source-selector-marquee-track">
					<span className="source-selector-marquee-segment">{text}</span>
					<span className="source-selector-marquee-segment source-selector-marquee-duplicate">
						{text}
					</span>
				</span>
			</span>
		</div>
	);
}

/**
 * SourceSelectorContent - The actual list of sources
 */
export const SourceSelectorContent = ({
	screenSources = [],
	windowSources = [],
	selectedSource = "Screen",
	loading = false,
	onSourceSelect = () => {
		/* no-op default */
	},
}: Pick<
	SourceSelectorProps,
	"screenSources" | "windowSources" | "selectedSource" | "loading" | "onSourceSelect"
>) => {
	const t = useScopedT("launch");

	// DISPLAYS — prominent rows: monitor icon + full label (no truncation),
	// red ring when selected. Names like "Display 1 — 2560x1440" wrap, never clip.
	const renderDisplayRow = (source: DesktopSource, index: number) => {
		const isSelected = selectedSource === source.name;
		return (
			<button
				key={`${source.id}-${index}`}
				type="button"
				className={cn(
					"source-selector-display-row group w-full rounded-[10px] px-3 py-3 text-left flex items-center gap-3",
					isSelected && "source-selector-display-row-selected",
				)}
				onClick={() => onSourceSelect(source)}
				title={source.name}
			>
				<div className="relative flex-shrink-0 w-[88px] h-[50px] rounded-[8px] overflow-hidden bg-black/40 flex items-center justify-center source-selector-display-icon">
					{source.thumbnail ? (
						<img
							src={source.thumbnail}
							alt=""
							className="w-full h-full object-cover"
							onError={(e) => {
								(e.target as HTMLImageElement).style.display = "none";
							}}
						/>
					) : (
						<MonitorIcon className="w-5 h-5" weight={isSelected ? "fill" : "regular"} />
					)}
				</div>
				<span className="flex-1 min-w-0 text-sm font-semibold source-selector-text leading-snug break-words">
					{source.name}
				</span>
			</button>
		);
	};

	// WINDOWS — app icon + full two-line title wrap (no truncation), max-h scroll.
	const renderWindowRow = (source: DesktopSource, index: number) => {
		const isSelected = selectedSource === source.name;
		const title = source.windowTitle || source.name;
		return (
			<button
				key={`${source.id}-${index}`}
				type="button"
				className={cn(
					"source-selector-item group min-h-[48px] w-full rounded-[10px] px-3 py-2.5 text-left font-medium flex items-center justify-start gap-3",
					isSelected && "source-selector-item-selected",
				)}
				onClick={() => onSourceSelect(source)}
				title={source.appName ? `${source.appName} — ${title}` : title}
			>
				<div className="relative flex-shrink-0 w-[64px] h-[40px] rounded-[6px] overflow-hidden bg-black/40 flex items-center justify-center">
					{source.thumbnail ? (
						<img
							src={source.thumbnail}
							alt=""
							className="w-full h-full object-cover"
							onError={(e) => {
								(e.target as HTMLImageElement).style.display = "none";
							}}
						/>
					) : source.appIcon ? (
						<img
							src={source.appIcon}
							alt=""
							className="w-7 h-7 object-contain"
							onError={(e) => {
								(e.target as HTMLImageElement).style.display = "none";
							}}
						/>
					) : (
						<AppWindowIcon className="w-4 h-4 source-selector-muted" />
					)}
					{source.thumbnail && source.appIcon ? (
						<img
							src={source.appIcon}
							alt=""
							className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded object-contain shadow"
							onError={(e) => {
								(e.target as HTMLImageElement).style.display = "none";
							}}
						/>
					) : null}
				</div>

				<div className="flex-1 min-w-0 flex flex-col items-start text-left gap-0.5">
					{source.appName ? (
						<span className="text-[11px] source-selector-subtle leading-tight truncate w-full text-left">
							{source.appName}
						</span>
					) : null}
					<span className="text-sm font-medium source-selector-text w-full text-left source-selector-window-title">
						{title}
					</span>
				</div>
			</button>
		);
	};

	const hasAnySources = screenSources.length > 0 || windowSources.length > 0;

	if (loading && !hasAnySources) {
		return (
			<div className="flex items-center justify-center py-8">
				<div className="animate-spin rounded-full h-5 w-5 border-b-2 source-selector-accent-border" />
			</div>
		);
	}

	return (
		<div className="p-2 max-h-[66vh] overflow-y-auto overflow-x-hidden source-selector-scroll">
			{hasAnySources ? (
				<>
					{screenSources.length > 0 ? (
						<div className="space-y-1.5">
							<div className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] source-selector-label flex items-center gap-2">
								{t("recording.displays", "Displays")}
								<span
									className={cn(
										"normal-case tracking-normal text-[10px] source-selector-muted transition-opacity duration-150",
										loading ? "opacity-100" : "opacity-0",
									)}
								>
									{t("common.loading", "Refreshing...")}
								</span>
							</div>
							<div className="space-y-1">
								{screenSources.map((source, index) =>
									renderDisplayRow(source, index),
								)}
							</div>
						</div>
					) : null}
					{windowSources.length > 0 ? (
						<div className="space-y-1.5 mt-2">
							<div className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] source-selector-label">
								{t("recording.windows")}
							</div>
							<div className="space-y-0.5 pr-0.5">
								{windowSources.map((source, index) =>
									renderWindowRow(source, index),
								)}
							</div>
						</div>
					) : null}
				</>
			) : (
				<div className="text-center py-8 text-sm source-selector-muted">
					{t("recording.noSourcesFound")}
				</div>
			)}
		</div>
	);
};

/**
 * SourceSelector - A rich source selection component with thumbnails
 * Uses Radix UI Popover for positioning and accessibility
 */
export const SourceSelector = React.memo(function SourceSelector({
	screenSources: propsScreenSources,
	windowSources: propsWindowSources,
	selectedSource: propsSelectedSource,
	loading: propsLoading,
	onSourceSelect: propsOnSourceSelect,
	onFetchSources: propsOnFetchSources,
	open: propsOpen,
	onOpenChange: propsOnOpenChange,
	children,
}: SourceSelectorProps) {
	// Internal state for standalone/uncontrolled use
	const [internalOpen, setInternalOpen] = useState(false);
	const [internalSources, setInternalSources] = useState<DesktopSource[]>([]);
	const [internalLoading, setInternalLoading] = useState(false);
	const [internalSelectedSource, setInternalSelectedSource] = useState("Screen");

	// Determine if we should use internal or external state/logic
	const isAutonomous = propsOpen === undefined;
	const open = propsOpen ?? internalOpen;
	const onOpenChange = propsOnOpenChange ?? setInternalOpen;
	const loading = propsLoading ?? internalLoading;
	const selectedSource = propsSelectedSource ?? internalSelectedSource;

	// Default fetching logic
	const defaultFetchSources = useCallback(async () => {
		if (!window.electronAPI) return;
		setInternalLoading(true);
		try {
			const rawSources = await window.electronAPI.getSources({
				types: ["screen", "window"],
				thumbnailSize: { width: 160, height: 90 },
				fetchWindowIcons: true,
			});
			setInternalSources(rawSources.map((s) => mapRawSource(s as DesktopSource)));
		} catch (error) {
			console.error("Failed to fetch sources:", error);
		} finally {
			setInternalLoading(false);
		}
	}, []);

	const onFetchSources = propsOnFetchSources ?? defaultFetchSources;

	// Default selection logic
	const onSourceSelect = useCallback(
		async (source: DesktopSource) => {
			if (propsOnSourceSelect) {
				propsOnSourceSelect(source);
				return;
			}
			if (!window.electronAPI) return;
			try {
				const result = await window.electronAPI.selectSource(source);
				if (result) {
					setInternalSelectedSource(source.name);
				}
			} catch (error) {
				console.error("Failed to select source:", error);
			}
		},
		[propsOnSourceSelect],
	);

	// Split sources for internal use
	const internalScreenSources = useMemo(
		() => internalSources.filter(isScreenSource),
		[internalSources],
	);
	const internalWindowSources = useMemo(
		() => internalSources.filter(isWindowSource),
		[internalSources],
	);

	const screenSources = propsScreenSources ?? internalScreenSources;
	const windowSources = propsWindowSources ?? internalWindowSources;

	const hasPrefetchedRef = useRef(false);
	const fetchInFlightRef = useRef(false);
	const lastFetchedAtRef = useRef(0);

	const fetchSourcesOnce = useCallback(
		async (allowRecentSkip: boolean) => {
			if (fetchInFlightRef.current) {
				return;
			}
			if (allowRecentSkip && Date.now() - lastFetchedAtRef.current < 750) {
				return;
			}
			fetchInFlightRef.current = true;
			try {
				await onFetchSources();
				lastFetchedAtRef.current = Date.now();
			} finally {
				fetchInFlightRef.current = false;
			}
		},
		[onFetchSources],
	);

	const prefetchSources = React.useCallback(() => {
		if (hasPrefetchedRef.current) {
			return;
		}
		hasPrefetchedRef.current = true;
		void fetchSourcesOnce(false);
	}, [fetchSourcesOnce]);

	// Fetch sources when popover opens
	useEffect(() => {
		if (open) {
			void fetchSourcesOnce(true);
		}
	}, [open, fetchSourcesOnce]);

	// In autonomous mode, we might want to start open
	useEffect(() => {
		if (isAutonomous) {
			setInternalOpen(true);
		}
	}, [isAutonomous]);

	const trigger = children ? (
		React.isValidElement(children) ? (
			React.cloneElement(children as React.ReactElement<React.HTMLAttributes<HTMLElement>>, {
				onPointerEnter: prefetchSources,
				onFocusCapture: prefetchSources,
			})
		) : (
			children
		)
	) : (
		<Button
			variant="outline"
			size="lg"
			onPointerEnter={prefetchSources}
			onFocusCapture={prefetchSources}
			className={cn(
				"group gap-2 px-3 min-w-0 max-w-[180px] rounded-[11px] font-medium text-[12px] [ -webkit-app-region:no-drag ] shrink-0",
				"border-[#2a2a34] bg-[#1a1a22] text-[#eeeef2] hover:border-[#3e3e4c] hover:bg-[#20202a] transition-all",
				"data-[state=open]:border-[#3e3e4c] data-[state=open]:bg-[#20202a]",
			)}
			title={selectedSource}
		>
			<MonitorIcon size={16} className="shrink-0" />
			<div className="flex-1 min-w-0">
				<MarqueeText text={selectedSource} />
			</div>
			<CaretUpIcon
				size={10}
				className={cn(
					"text-[#6b6b78] ml-0.5 shrink-0 transition-transform duration-200",
					open ? "" : "rotate-180",
				)}
			/>
		</Button>
	);

	const { onMouseEnter } = useHudInteraction();

	return (
		<Popover open={open} onOpenChange={onOpenChange} modal={false}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent
				className="launch-theme w-[480px] max-w-[calc(100vw-24px)] p-0 source-selector-popover"
				data-hud-interactive
				unstyled
				align="start"
				sideOffset={8}
				side="top"
				alignOffset={-8}
				avoidCollisions={true}
				collisionPadding={10}
				usePortal={false}
				onMouseEnter={onMouseEnter}
			>
				<SourceSelectorContent
					screenSources={screenSources}
					windowSources={windowSources}
					selectedSource={selectedSource}
					loading={loading}
					onSourceSelect={onSourceSelect}
				/>
			</PopoverContent>
		</Popover>
	);
});

SourceSelector.displayName = "SourceSelector";
