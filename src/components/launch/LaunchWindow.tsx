import {
	ArticleIcon,
	DotsSixVerticalIcon,
	DotsThreeIcon,
	FolderIcon,
	MicrophoneIcon,
	MicrophoneSlashIcon,
	MinusIcon,
	MonitorIcon,
	TimerIcon,
	VideoCameraIcon,
	VideoCameraSlashIcon,
	XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useScopedT } from "../../contexts/I18nContext";
import { useMicrophoneDevices } from "../../hooks/useMicrophoneDevices";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import { useVideoDevices } from "../../hooks/useVideoDevices";
import { HudInteractionContext } from "./contexts/HudInteractionContext";
import { canToggleFloatingWebcamPreview } from "./floatingWebcamPreview";
import { useHudBarDrag } from "./hooks/useHudBarDrag";
import { useLaunchHudInteractionState } from "./hooks/useLaunchHudInteractionState";
import { useLaunchWindowActions } from "./hooks/useLaunchWindowActions";
import { useLaunchWindowSystemState } from "./hooks/useLaunchWindowSystemState";
import { useRecordingTimer } from "./hooks/useRecordingTimer";
import { useWebcamPreviewOverlay } from "./hooks/useWebcamPreviewOverlay";
import styles from "./LaunchWindow.module.css";
import { CountdownPopover } from "./popovers/CountdownPopover";
import { TeleprompterPopover } from "./popovers/TeleprompterPopover";
import { useTeleprompter } from "./hooks/useTeleprompter";
import {
	LaunchPopoverCoordinatorProvider,
	useLaunchPopoverCoordinator,
} from "./popovers/LaunchPopoverCoordinator";
import { MicPopover } from "./popovers/MicPopover";
import { MorePopover } from "./popovers/MorePopover";
import { ProjectPopover } from "./popovers/ProjectPopover";
import { SourcePopover } from "./popovers/SourcePopover";
import { WebcamPopover } from "./popovers/WebcamPopover";
import { RecordingControls } from "./RecordingControls";
import { MarqueeText } from "./SourceSelector";

const SHOW_DEV_UPDATE_PREVIEW = import.meta.env.DEV;

export function LaunchWindow() {
	return (
		<LaunchPopoverCoordinatorProvider>
			<LaunchWindowContent />
		</LaunchPopoverCoordinatorProvider>
	);
}

function LaunchWindowContent() {
	const t = useScopedT("launch");
	const { openId, requestClose, requestOpen } = useLaunchPopoverCoordinator();

	const {
		recording,
		paused,
		finalizing,
		countdownActive,
		toggleRecording,
		pauseRecording,
		resumeRecording,
		cancelRecording,
		microphoneEnabled,
		setMicrophoneEnabled,
		microphoneDeviceId,
		setMicrophoneDeviceId,
		systemAudioEnabled,
		setSystemAudioEnabled,
		webcamEnabled,
		setWebcamEnabled,
		webcamDeviceId,
		setWebcamDeviceId,
		countdownDelay,
		setCountdownDelay,
		preparePermissions,
	} = useScreenRecorder();

	const { elapsed, formatTime } = useRecordingTimer(recording, paused);
	const hudContentRef = useRef<HTMLDivElement>(null);
	const hudBarRef = useRef<HTMLDivElement>(null);

	// Orb bloom state: false = collapsed orb, true = expanded cluster.
	const [bloomed, setBloomed] = useState(false);

	const {
		selectedSource,
		hasSelectedSource,
		projectLibraryEntries,
		handleSourceSelect,
		openVideoFile,
		openProjectFromLibrary,
		syncSelectedSource,
		refreshProjectLibrary,
	} = useLaunchWindowActions();

	const showWebcamControls = webcamEnabled && !recording;
	const { devices, selectedDeviceId, setSelectedDeviceId } = useMicrophoneDevices(
		microphoneEnabled || openId === "mic",
		microphoneDeviceId,
	);
	const {
		devices: videoDevices,
		selectedDeviceId: selectedVideoDeviceId,
		setSelectedDeviceId: setSelectedVideoDeviceId,
	} = useVideoDevices(webcamEnabled || openId === "webcam");

	const {
		hudOverlayMousePassthroughSupported,
		platform,
		appVersion,
		hideHudFromCapture,
		chooseRecordingsDirectory,
		toggleHudCaptureProtection,
	} = useLaunchWindowSystemState(preparePermissions);

	const supportsHudCaptureProtection = platform !== "linux";

	useEffect(() => {
		if (!selectedDeviceId) {
			return;
		}

		setMicrophoneDeviceId(selectedDeviceId === "default" ? undefined : selectedDeviceId);
	}, [selectedDeviceId, setMicrophoneDeviceId]);

	useEffect(() => {
		if (selectedVideoDeviceId && selectedVideoDeviceId !== "default") {
			setWebcamDeviceId(selectedVideoDeviceId);
		}
	}, [selectedVideoDeviceId, setWebcamDeviceId]);

	const {
		showFloatingWebcamPreview,
		setShowFloatingWebcamPreview,
		webcamPreviewLocked,
		setWebcamPreviewLocked,
		showRecordingWebcamPreview,
		webcamPreviewOffset,
		recordingWebcamPreviewContainerRef,
		isWebcamPreviewDraggingRef,
		webcamPreviewDragStartRef,
		handleWebcamPreviewPointerDown,
		handleWebcamPreviewPointerMove,
		handleWebcamPreviewPointerUp,
		setWebcamPreviewNode,
		setRecordingWebcamPreviewNode,
	} = useWebcamPreviewOverlay({
		webcamEnabled,
		webcamDeviceId,
		showWebcamControls,
		webcamPopoverOpen: openId === "webcam",
		hudOverlayMousePassthroughSupported,
	});

	const {
		teleprompterEnabled,
		setTeleprompterEnabled,
		teleprompterScript,
		setTeleprompterScript,
		teleprompterSpeed,
		setTeleprompterSpeed,
		teleprompterVoicePaced,
		setTeleprompterVoicePaced,
		teleprompterFontSize,
		setTeleprompterFontSize,
	} = useTeleprompter({ recording, microphoneDeviceId });

	useEffect(() => {
		window.electronAPI?.hudOverlaySetWebcamPreviewVisible?.(showRecordingWebcamPreview);
	}, [showRecordingWebcamPreview]);

	useEffect(() => {
		return () => {
			window.electronAPI?.hudOverlaySetWebcamPreviewVisible?.(false);
		};
	}, []);

	// Live fullscreen/bubble framing: enable the global 1/2 shortcuts only while
	// recording with the webcam on (so they capture keys app-wide but never linger),
	// seed the opening fullscreen shot, and mirror switches into the live preview.
	const [webcamLayoutMode, setWebcamLayoutMode] = useState<"fullscreen" | "bubble">("bubble");
	useEffect(() => {
		const active = recording && webcamEnabled;
		void window.electronAPI?.setWebcamLayoutShortcutsEnabled?.(active);
		if (active) {
			setWebcamLayoutMode("fullscreen");
		} else {
			setWebcamLayoutMode("bubble");
		}
		return () => {
			if (active) {
				void window.electronAPI?.setWebcamLayoutShortcutsEnabled?.(false);
			}
		};
	}, [recording, webcamEnabled]);
	useEffect(() => {
		const unsubscribe = window.electronAPI?.onWebcamLayoutModeChanged?.((mode) => {
			setWebcamLayoutMode(mode);
		});
		return () => unsubscribe?.();
	}, []);

	const {
		recordingHudOffset,
		hudBarTransformRef,
		isHudDraggingRef,
		handleHudBarPointerDown,
		handleHudBarPointerMove,
		handleHudBarPointerUp,
	} = useHudBarDrag({
		hudContentRef,
		hudBarRef,
		recordingWebcamPreviewContainerRef,
	});

	const { handleHudMouseEnter, handleHudMouseLeave, beginInteractiveHudAction } =
		useLaunchHudInteractionState({
			openId,
			isHudDraggingRef,
			isWebcamPreviewDraggingRef,
			webcamPreviewDragStartRef,
			onMouseAway: () => {
				if (openId) requestClose(openId);
			},
		});

	useEffect(() => {
		let mounted = true;

		void window.electronAPI.getSelectedSource().then((source) => {
			if (mounted) syncSelectedSource(source);
		});

		const cleanup = window.electronAPI.onSelectedSourceChanged((source) => {
			if (mounted) syncSelectedSource(source);
		});

		return () => {
			mounted = false;
			cleanup?.();
		};
	}, [syncSelectedSource]);

	// Collapse the bloom whenever recording/finalizing takes over.
	useEffect(() => {
		if (recording || finalizing) {
			setBloomed(false);
		}
	}, [recording, finalizing]);

	// Esc collapses the cluster back to the orb.
	useEffect(() => {
		if (!bloomed) {
			return;
		}
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				if (openId) {
					requestClose(openId);
					return;
				}
				setBloomed(false);
			}
		};
		window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, [bloomed, openId, requestClose]);

	// Distinguish an orb click (bloom) from an orb drag (reposition).
	const orbPointerDownRef = useRef<{ x: number; y: number } | null>(null);

	const handleOrbPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			orbPointerDownRef.current = { x: event.clientX, y: event.clientY };
			handleHudBarPointerDown(event);
		},
		[handleHudBarPointerDown],
	);

	const handleOrbPointerUp = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const start = orbPointerDownRef.current;
			handleHudBarPointerUp(event);
			orbPointerDownRef.current = null;
			if (!start) {
				return;
			}
			const movedX = Math.abs(event.clientX - start.x);
			const movedY = Math.abs(event.clientY - start.y);
			// Treat as a click only when the pointer barely moved.
			if (movedX < 4 && movedY < 4) {
				beginInteractiveHudAction();
				setBloomed((current) => !current);
			}
		},
		[beginInteractiveHudAction, handleHudBarPointerUp],
	);

	const hudStateTransition = {
		duration: 0.2,
		ease: [0.22, 1, 0.36, 1] as const,
	};

	const clusterSpring = {
		type: "spring" as const,
		stiffness: 420,
		damping: 32,
		mass: 0.8,
	};

	const useNativeHudBarDrag =
		platform === "linux" || hudOverlayMousePassthroughSupported === false;

	const sourceChip = (
		<button
			type="button"
			className={`${styles.sourceChip} ${styles.electronNoDrag} ${
				openId === "sources" ? styles.sourceChipActive : ""
			}`}
			title={selectedSource}
		>
			<MonitorIcon size={16} className="shrink-0" />
			<div className="flex-1 min-w-0 overflow-hidden text-left">
				<MarqueeText text={selectedSource} />
			</div>
		</button>
	);

	const cluster = (
		<motion.div
			ref={hudBarRef}
			className={`${styles.cluster} launch-theme`}
			initial={{ opacity: 0, scale: 0.6, filter: "blur(8px)" }}
			animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
			exit={{ opacity: 0, scale: 0.6, filter: "blur(8px)" }}
			transition={clusterSpring}
			style={{ transformOrigin: "bottom center" }}
			onMouseEnter={handleHudMouseEnter}
			onMouseLeave={handleHudMouseLeave}
		>
			{/* Top hairline strip — corner micro-buttons + drag handle */}
			<div
				className={`${styles.clusterStrip} cursor-grab active:cursor-grabbing ${
					useNativeHudBarDrag ? styles.electronDrag : ""
				}`}
				onPointerDown={(event) => {
					// Pressing an interactive control (popover triggers, hide/close)
					// must not start a window drag, or the click never lands and Radix
					// popover triggers (folder, 3-dots) never open.
					if ((event.target as HTMLElement).closest("button")) return;
					handleHudBarPointerDown(event);
				}}
				onPointerMove={handleHudBarPointerMove}
				onPointerUp={handleHudBarPointerUp}
				onPointerCancel={handleHudBarPointerUp}
			>
				<span className={styles.clusterStripLabel}>{t("recording.rec", "REC")}</span>
				<div className={`${styles.clusterStripActions} ${styles.electronNoDrag}`}>
					<div className="relative">
						<ProjectPopover
							entries={projectLibraryEntries}
							onOpenProject={openProjectFromLibrary}
							trigger={
								<button
									type="button"
									className={styles.microBtn}
									title={t("recording.projects", "Projects")}
								>
									<FolderIcon size={14} />
								</button>
							}
						/>
					</div>

					<MorePopover
						supportsHudCaptureProtection={supportsHudCaptureProtection}
						hideHudFromCapture={hideHudFromCapture}
						onToggleHudCaptureProtection={() => {
							void toggleHudCaptureProtection();
						}}
						onChooseRecordingsDirectory={() => {
							void chooseRecordingsDirectory();
						}}
						onOpenVideoFile={() => {
							void openVideoFile();
						}}
						onOpenProjectBrowser={() => {
							refreshProjectLibrary().then(() => {
								requestOpen("projects");
							});
						}}
						showDevUpdatePreview={SHOW_DEV_UPDATE_PREVIEW}
						onPreviewUpdateUi={() => {
							if (openId) requestClose(openId);
							void window.electronAPI.previewUpdateToast().catch((error) => {
								console.warn("Failed to preview update toast:", error);
							});
						}}
						appVersion={appVersion}
						trigger={
							<button
								type="button"
								className={styles.microBtn}
								title={t("recording.more")}
							>
								<DotsThreeIcon size={16} />
							</button>
						}
					/>

					<button
						type="button"
						className={styles.microBtn}
						onClick={() => window.electronAPI?.hudOverlayHide?.()}
						title={t("recording.hideHud")}
					>
						<MinusIcon size={14} />
					</button>

					<button
						type="button"
						className={styles.microBtn}
						onClick={() => window.electronAPI?.hudOverlayClose?.()}
						title={t("recording.closeApp")}
					>
						<XIcon size={14} />
					</button>
				</div>
			</div>

			<div className={`${styles.clusterBody} ${styles.electronNoDrag}`}>
				{/* Row 1 — source selector chip */}
				{platform !== "linux" && (
					<div className={styles.clusterRow}>
						<SourcePopover
							selectedSource={selectedSource}
							onSourceSelect={handleSourceSelect}
							onOpen={beginInteractiveHudAction}
							trigger={sourceChip}
						/>
					</div>
				)}

				{/* Row 2 — mic, webcam, countdown toggles */}
				<div className={styles.toggleRow}>
					<MicPopover
						disabled={recording}
						systemAudioEnabled={systemAudioEnabled}
						onToggleSystemAudio={() => setSystemAudioEnabled(!systemAudioEnabled)}
						microphoneEnabled={microphoneEnabled}
						onDisableMicrophone={() => setMicrophoneEnabled(false)}
						devices={devices}
						microphoneDeviceId={microphoneDeviceId}
						selectedDeviceId={selectedDeviceId}
						onSelectDevice={(deviceId) => {
							setMicrophoneEnabled(true);
							setSelectedDeviceId(deviceId);
							setMicrophoneDeviceId(deviceId === "default" ? undefined : deviceId);
						}}
						trigger={
							<button
								type="button"
								className={`${styles.toggleBtn} ${
									microphoneEnabled ? styles.toggleBtnActive : ""
								}`}
								title={
									microphoneEnabled
										? t("recording.disableMicrophone")
										: t("recording.enableMicrophone")
								}
							>
								{microphoneEnabled ? (
									<MicrophoneIcon size={18} />
								) : (
									<MicrophoneSlashIcon size={18} />
								)}
							</button>
						}
					/>

					<WebcamPopover
						disabled={recording}
						webcamEnabled={webcamEnabled}
						onDisableWebcam={() => setWebcamEnabled(false)}
						canToggleFloatingPreview={canToggleFloatingWebcamPreview(
							hudOverlayMousePassthroughSupported,
						)}
						showFloatingWebcamPreview={showFloatingWebcamPreview}
						onToggleFloatingPreview={() =>
							setShowFloatingWebcamPreview((current) => !current)
						}
						webcamPreviewLocked={webcamPreviewLocked}
						onToggleWebcamPreviewLocked={() =>
							setWebcamPreviewLocked(!webcamPreviewLocked)
						}
						showWebcamControls={showWebcamControls}
						setWebcamPreviewNode={setWebcamPreviewNode}
						videoDevices={videoDevices}
						webcamDeviceId={webcamDeviceId}
						selectedVideoDeviceId={selectedVideoDeviceId}
						onSelectVideoDevice={(deviceId) => {
							setWebcamEnabled(true);
							setSelectedVideoDeviceId(deviceId);
							setWebcamDeviceId(deviceId);
						}}
						trigger={
							<button
								type="button"
								className={`${styles.toggleBtn} ${
									webcamEnabled ? styles.toggleBtnActive : ""
								}`}
								title={
									webcamEnabled
										? t("recording.disableWebcam")
										: t("recording.enableWebcam")
								}
							>
								{webcamEnabled ? (
									<VideoCameraIcon size={18} />
								) : (
									<VideoCameraSlashIcon size={18} />
								)}
							</button>
						}
					/>

					<CountdownPopover
						countdownDelay={countdownDelay}
						onSelectDelay={setCountdownDelay}
						trigger={
							<button
								type="button"
								className={`${styles.toggleBtn} ${
									countdownDelay > 0 ? styles.toggleBtnActive : ""
								}`}
								title={t("recording.countdownDelay")}
							>
								<TimerIcon size={18} />
							</button>
						}
					/>

					<TeleprompterPopover
						enabled={teleprompterEnabled}
						onToggleEnabled={() => setTeleprompterEnabled(!teleprompterEnabled)}
						script={teleprompterScript}
						onScriptChange={setTeleprompterScript}
						speed={teleprompterSpeed}
						onSpeedChange={setTeleprompterSpeed}
						voicePaced={teleprompterVoicePaced}
						onToggleVoicePaced={() => setTeleprompterVoicePaced(!teleprompterVoicePaced)}
						fontSize={teleprompterFontSize}
						onFontSizeChange={setTeleprompterFontSize}
						trigger={
							<button
								type="button"
								className={`${styles.toggleBtn} ${
									teleprompterEnabled ? styles.toggleBtnActive : ""
								}`}
								title={t("recording.teleprompter", "Teleprompter")}
							>
								<ArticleIcon size={18} />
							</button>
						}
					/>
				</div>

				{/* Row 3 — REC capsule */}
				<button
					type="button"
					className={styles.recCapsule}
					onClick={
						hasSelectedSource || platform === "linux"
							? toggleRecording
							: () => {
									beginInteractiveHudAction();
									requestOpen("sources");
								}
					}
					disabled={countdownActive}
					title={t("recording.record")}
				>
					<span className={styles.recCapsuleDot} />
					{t("recording.rec", "REC")}
				</button>
			</div>
		</motion.div>
	);

	const orb = (
		<motion.div
			ref={hudBarRef}
			className={`${styles.orb} launch-theme ${styles.electronNoDrag} ${
				useNativeHudBarDrag ? styles.electronDrag : ""
			}`}
			role="button"
			tabIndex={0}
			aria-label={t("recording.record")}
			title={t("recording.record")}
			initial={{ opacity: 0, scale: 0.6 }}
			animate={{ opacity: 1, scale: 1 }}
			exit={{ opacity: 0, scale: 0.6 }}
			transition={clusterSpring}
			onPointerDown={handleOrbPointerDown}
			onPointerMove={handleHudBarPointerMove}
			onPointerUp={handleOrbPointerUp}
			onPointerCancel={handleHudBarPointerUp}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					setBloomed((current) => !current);
				}
			}}
			onMouseEnter={handleHudMouseEnter}
			onMouseLeave={handleHudMouseLeave}
		>
			{finalizing ? (
				<div className={styles.orbSpinner} />
			) : (
				<>
					<div className={styles.orbDot} />
					<span className={styles.orbLabel}>{t("recording.record")}</span>
				</>
			)}
		</motion.div>
	);

	const recordingCapsule = (
		<motion.div
			ref={hudBarRef}
			className={`${styles.recordingCapsule} launch-theme`}
			initial={{ opacity: 0, scale: 0.85, filter: "blur(6px)" }}
			animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
			exit={{ opacity: 0, scale: 0.85, filter: "blur(6px)" }}
			transition={hudStateTransition}
			onMouseEnter={handleHudMouseEnter}
			onMouseLeave={handleHudMouseLeave}
		>
			{/* Explicit drag grip — the ONLY drag region of the capsule. */}
			<div
				className={`${styles.recordingGrip} cursor-grab active:cursor-grabbing ${
					useNativeHudBarDrag ? styles.electronDrag : ""
				}`}
				title={t("recording.move", "Move")}
				aria-label={t("recording.move", "Move")}
				onPointerDown={(event) => {
					// Pressing an interactive control (popover triggers, hide/close)
					// must not start a window drag, or the click never lands and Radix
					// popover triggers (folder, 3-dots) never open.
					if ((event.target as HTMLElement).closest("button")) return;
					handleHudBarPointerDown(event);
				}}
				onPointerMove={handleHudBarPointerMove}
				onPointerUp={handleHudBarPointerUp}
				onPointerCancel={handleHudBarPointerUp}
			>
				<DotsSixVerticalIcon size={16} weight="bold" />
			</div>

			{/* Interactive controls — isolated from the grip's JS drag capture.
			    Without stopPropagation, pointer-down on pause/stop/hide starts a
			    drag and the click never lands (same bug fixed on the cluster strip). */}
			<div
				className={`${styles.recordingControls} ${styles.electronNoDrag}`}
				onPointerDown={(event) => event.stopPropagation()}
				onPointerUp={(event) => event.stopPropagation()}
			>
				<RecordingControls
					paused={paused}
					microphoneEnabled={microphoneEnabled}
					elapsed={elapsed}
					onToggleMicrophone={() => setMicrophoneEnabled(!microphoneEnabled)}
					onPauseResume={paused ? resumeRecording : pauseRecording}
					onStopRecording={toggleRecording}
					onHideHud={() => window.electronAPI?.hudOverlayHide?.()}
					onCancelRecording={cancelRecording}
					formatTime={formatTime}
				/>
			</div>
		</motion.div>
	);

	const hudMode = recording ? "recording" : bloomed && !finalizing ? "cluster" : "orb";

	return (
		<HudInteractionContext.Provider
			value={{ onMouseEnter: handleHudMouseEnter, onMouseLeave: handleHudMouseLeave }}
		>
			<div
				className="w-full flex justify-center bg-transparent overflow-visible items-end pb-5 pointer-events-none"
				style={{ height: "100vh" }}
			>
				<div
					ref={hudContentRef}
					className="flex items-center overflow-visible flex-col-reverse pointer-events-none"
				>
					<div
						className="flex flex-col items-center pointer-events-auto"
						onMouseEnter={handleHudMouseEnter}
						onMouseLeave={handleHudMouseLeave}
					>
						<div
							ref={hudBarTransformRef}
							style={{
								transform: `translate3d(${recordingHudOffset.x}px, ${recordingHudOffset.y}px, 0)`,
							}}
						>
							<AnimatePresence initial={false} mode="popLayout">
								{hudMode === "recording" ? (
									<div key="recording">{recordingCapsule}</div>
								) : hudMode === "cluster" ? (
									<div key="cluster">{cluster}</div>
								) : (
									<div key="orb">{orb}</div>
								)}
							</AnimatePresence>
						</div>
						{showRecordingWebcamPreview && (
							<div
								ref={recordingWebcamPreviewContainerRef}
								className={`${styles.recordingWebcamPreview} ${styles.electronNoDrag} ${
									webcamPreviewLocked ? "pointer-events-none" : "pointer-events-auto"
								}`}
								// When locked (default) the preview has NO hitbox: pointer-events:none
								// + no interactive markers/handlers, so it never captures clicks,
								// scroll, or keystrokes meant for the app being recorded.
								{...(webcamPreviewLocked ? {} : { "data-hud-interactive": true })}
								title={t("recording.webcam")}
								style={{
									transform: `translate(${webcamPreviewOffset.x}px, ${webcamPreviewOffset.y}px)`,
									transition: "box-shadow 200ms ease",
									borderRadius: "9999px",
									// Ring-only indicator for fullscreen framing (no size bump, so it
									// doesn't widen the area where the overlay eats scroll/clicks).
									boxShadow:
										webcamLayoutMode === "fullscreen"
											? "0 0 0 3px rgba(255,255,255,0.9), 0 0 22px 6px rgba(255,255,255,0.55)"
											: undefined,
								}}
								onMouseEnter={webcamPreviewLocked ? undefined : handleHudMouseEnter}
								onMouseLeave={webcamPreviewLocked ? undefined : handleHudMouseLeave}
								onPointerDown={webcamPreviewLocked ? undefined : handleWebcamPreviewPointerDown}
								onPointerMove={webcamPreviewLocked ? undefined : handleWebcamPreviewPointerMove}
								onPointerUp={webcamPreviewLocked ? undefined : handleWebcamPreviewPointerUp}
								onPointerCancel={webcamPreviewLocked ? undefined : handleWebcamPreviewPointerUp}
							>
								<video
									ref={setRecordingWebcamPreviewNode}
									className={styles.recordingWebcamPreviewVideo}
									muted
									playsInline
									style={{ transform: "scaleX(-1)" }}
								/>
							</div>
						)}
					</div>
				</div>
			</div>
		</HudInteractionContext.Provider>
	);
}
