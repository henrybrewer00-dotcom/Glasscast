import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./CountdownOverlay.module.css";

export function CountdownOverlay() {
	const [countdown, setCountdown] = useState<number | null>(null);
	const prevRef = useRef<number | null>(null);
	const [prev, setPrev] = useState<number | null>(null);

	const applyTick = useCallback((seconds: number) => {
		setPrev(prevRef.current);
		prevRef.current = seconds;
		setCountdown(seconds);
	}, []);

	useEffect(() => {
		void window.electronAPI.getActiveCountdown().then((result) => {
			if (result.success && typeof result.seconds === "number") {
				applyTick(result.seconds);
			}
		});

		const cleanup = window.electronAPI.onCountdownTick((seconds: number) => {
			applyTick(seconds);
		});

		return cleanup;
	}, [applyTick]);

	const handleCancel = useCallback(() => {
		window.electronAPI.cancelCountdown();
	}, []);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (event.key === "Escape") {
				handleCancel();
			}
		},
		[handleCancel],
	);

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleKeyDown]);

	if (countdown === null) {
		return null;
	}

	return (
		<div
			className={styles.backdrop}
			onClick={handleCancel}
			onKeyDown={(e) => e.key === "Escape" && handleCancel()}
		>
			<div className={styles.stage}>
				<div key={`glow-${countdown}`} className={styles.glow} />
				{prev !== null && prev !== countdown ? (
					<span key={`out-${prev}`} className={styles.numberOut} aria-hidden="true">
						{prev}
					</span>
				) : null}
				<span key={`in-${countdown}`} className={styles.number}>
					{countdown}
				</span>
			</div>
			<div className={styles.hintPill}>
				<span className={styles.recDot} />
				<span className={styles.hintText}>Recording in {countdown}</span>
				<span className={styles.hintDivider} />
				<span className={styles.hintKey}>Esc</span>
				<span className={styles.hintText}>to cancel</span>
			</div>
		</div>
	);
}
