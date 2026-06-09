import { useCallback, useEffect, useState } from "react";
import styles from "./CountdownOverlay.module.css";

export function CountdownOverlay() {
	const [countdown, setCountdown] = useState<number | null>(null);

	useEffect(() => {
		void window.electronAPI.getActiveCountdown().then((result) => {
			if (result.success && typeof result.seconds === "number") {
				setCountdown(result.seconds);
			}
		});

		const cleanup = window.electronAPI.onCountdownTick((seconds: number) => {
			setCountdown(seconds);
		});

		return cleanup;
	}, []);

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
				<svg className={styles.ring} viewBox="0 0 240 240" aria-hidden="true">
					<title>Countdown ring</title>
					<circle className={styles.ringTrack} cx="120" cy="120" r="110" />
					{/* key re-mounts the circle each tick so the deplete animation replays */}
					<circle key={countdown} className={styles.ringProgress} cx="120" cy="120" r="110" />
				</svg>
				<div className={styles.disc}>
					<span key={countdown} className={styles.number}>
						{countdown}
					</span>
				</div>
			</div>
			<p className={styles.hint}>
				<span className={styles.recDot} />
				Recording starts soon · Esc to cancel
			</p>
		</div>
	);
}
