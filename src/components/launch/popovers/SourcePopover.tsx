import { useCallback, useMemo, type ReactNode, useState } from "react";
import { SourceSelector } from "../SourceSelector";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import {
	mapRawSource,
	isScreenSource,
	isWindowSource,
	type DesktopSource,
} from "./launchPopoverTypes";

const POPOVER_ID = "sources";

export function SourcePopover({
	trigger,
	selectedSource,
	onSourceSelect,
	onOpen,
}: {
	trigger: ReactNode;
	selectedSource: string;
	onSourceSelect: (source: DesktopSource) => Promise<void> | void;
	onOpen?: () => void;
}) {
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const [sources, setSources] = useState<DesktopSource[]>([]);
	const [loading, setLoading] = useState(false);
	const open = isOpen(POPOVER_ID);

	const fetchSources = useCallback(async () => {
		if (!window.electronAPI) return;
		setLoading(true);
		try {
			// Two-phase load: the metadata + app-icon list returns near-instantly;
			// live window previews take ~1.5s to capture, so they swap in after.
			const fastSources = await window.electronAPI.getSources({
				types: ["screen", "window"],
				thumbnailSize: { width: 320, height: 180 },
				fetchWindowIcons: true,
			});
			setSources(fastSources.map((s) => mapRawSource(s as DesktopSource)));

			const withPreviews = await window.electronAPI.getSources({
				types: ["screen", "window"],
				thumbnailSize: { width: 320, height: 180 },
				fetchWindowIcons: true,
				includeWindowThumbnails: true,
			});
			setSources(withPreviews.map((s) => mapRawSource(s as DesktopSource)));
		} catch (error) {
			console.error("Failed to fetch sources:", error);
		} finally {
			setLoading(false);
		}
	}, []);

	const screenSources = useMemo(() => sources.filter(isScreenSource), [sources]);
	const windowSources = useMemo(() => sources.filter(isWindowSource), [sources]);

	return (
		<SourceSelector
			screenSources={screenSources}
			windowSources={windowSources}
			selectedSource={selectedSource}
			loading={loading}
			onSourceSelect={async (source) => {
				try {
					await onSourceSelect(source);
					requestClose(POPOVER_ID);
				} catch (error) {
					console.error("Failed to select source:", error);
				}
			}}
			onFetchSources={fetchSources}
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					requestClose(POPOVER_ID);
					return;
				}
				onOpen?.();
				requestOpen(POPOVER_ID);
			}}
		>
			{trigger}
		</SourceSelector>
	);
}
