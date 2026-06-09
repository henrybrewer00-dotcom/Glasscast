import {
	MicrophoneIcon,
	MicrophoneSlashIcon,
	MinusIcon,
	PauseIcon,
	PlayIcon,
	SquareIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useMemo } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import styles from "./LaunchWindow.module.css";

interface RecordingControlsProps {
	paused: boolean;
	microphoneEnabled: boolean;
	elapsed: number;
	onToggleMicrophone: () => void;
	onPauseResume: () => void;
	onStopRecording: () => void;
	onHideHud: () => void;
	onCancelRecording: () => void;
	formatTime: (seconds: number) => string;
}

export const RecordingControls = ({
	paused,
	microphoneEnabled,
	elapsed,
	onToggleMicrophone,
	onPauseResume,
	onStopRecording,
	onHideHud,
	onCancelRecording,
	formatTime,
}: RecordingControlsProps) => {
	const t = useScopedT("launch");

	const memoizedControls = useMemo(() => {
		return (
			<>
				{/* Red pulsing dot */}
				<div
					className={`${styles.recordingDot} ${
						paused ? styles.recordingDotPaused : styles.recDotBlink
					}`}
				/>

				{/* Monospace timer */}
				<span
					className={`${styles.recordingTimer} ${
						paused ? styles.recordingTimerPaused : ""
					}`}
				>
					{formatTime(elapsed)}
				</span>

				<div className={styles.recordingSep} />

				{/* Mic toggle (disabled while recording, mirrors existing behavior) */}
				<span title={t("recording.micToggleDisabledTip")}>
					<button
						type="button"
						className={`${styles.recCtrlBtn} ${
							microphoneEnabled ? styles.recCtrlBtnActive : ""
						}`}
						aria-label={t("recording.micToggleDisabledTip")}
						disabled
						onClick={onToggleMicrophone}
					>
						{microphoneEnabled ? (
							<MicrophoneIcon size={18} />
						) : (
							<MicrophoneSlashIcon size={18} />
						)}
					</button>
				</span>

				{/* Pause / resume */}
				<button
					type="button"
					className={`${styles.recCtrlBtn} ${paused ? styles.recCtrlBtnActive : ""}`}
					onClick={onPauseResume}
					title={paused ? t("recording.resume") : t("recording.pause")}
					aria-label={paused ? t("recording.resume") : t("recording.pause")}
				>
					{paused ? (
						<PlayIcon size={18} fill="currentColor" strokeWidth={0} />
					) : (
						<PauseIcon size={18} />
					)}
				</button>

				{/* Stop */}
				<button
					type="button"
					className={styles.stopBtn}
					onClick={onStopRecording}
					title={t("recording.stop")}
					aria-label={t("recording.stop")}
				>
					<SquareIcon size={16} fill="currentColor" strokeWidth={0} />
				</button>

				<div className={styles.recordingSep} />

				{/* Hide HUD */}
				<button
					type="button"
					className={styles.recCtrlBtn}
					onClick={onHideHud}
					title={t("recording.hideHud")}
					aria-label={t("recording.hideHud")}
				>
					<MinusIcon size={16} />
				</button>

				{/* Cancel */}
				<button
					type="button"
					className={styles.recCtrlBtn}
					onClick={onCancelRecording}
					title={t("recording.cancel")}
					aria-label={t("recording.cancel")}
				>
					<XIcon size={18} />
				</button>
			</>
		);
	}, [
		paused,
		microphoneEnabled,
		elapsed,
		onToggleMicrophone,
		onPauseResume,
		onStopRecording,
		onHideHud,
		onCancelRecording,
		formatTime,
		t,
	]);

	return memoizedControls;
};
