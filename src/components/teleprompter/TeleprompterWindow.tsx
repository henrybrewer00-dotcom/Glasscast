import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Teleprompter overlay. Runs in a dedicated transparent, always-click-through
 * window (windowType=teleprompter) so it floats over whatever you're recording
 * without ever capturing the mouse. It shows your script in large type, scrolls
 * it slowly downward, and — when voice pacing is on — only advances while you're
 * actually speaking (measured from the mic level), easing to a crawl when you
 * pause so the line you're reading stays under the guide.
 */

interface TeleprompterState {
	visible: boolean;
	script: string;
	/** Base scroll speed in px/sec at normal speaking pace. */
	speed: number;
	fontSize: number;
	opacity: number;
	/** When true, scroll speed follows mic level (voice activity). */
	voicePaced: boolean;
	microphoneDeviceId?: string | null;
}

const DEFAULT_STATE: TeleprompterState = {
	visible: false,
	script: "",
	speed: 40,
	fontSize: 34,
	opacity: 0.85,
	voicePaced: true,
	microphoneDeviceId: null,
};

export function TeleprompterWindow() {
	const [state, setState] = useState<TeleprompterState>(DEFAULT_STATE);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const scrollPosRef = useRef(0);
	const rafRef = useRef<number | null>(null);
	const lastTsRef = useRef<number | null>(null);
	// Smoothed voice "pace" 0..~1.3 derived from mic RMS.
	const paceRef = useRef(0);
	const stateRef = useRef(state);
	stateRef.current = state;

	// Receive state from the launch window via main.
	useEffect(() => {
		const unsubscribe = window.electronAPI?.onTeleprompterState?.((next) => {
			setState((prev) => ({ ...prev, ...next }));
		});
		// Ask for the current state on mount (window may open after state is set).
		void window.electronAPI?.requestTeleprompterState?.();
		return () => unsubscribe?.();
	}, []);

	// Reset scroll to top whenever the script changes or it becomes visible.
	useEffect(() => {
		scrollPosRef.current = 0;
		paceRef.current = 0;
		if (scrollRef.current) scrollRef.current.scrollTop = 0;
	}, [state.script, state.visible]);

	// Mic-level voice-activity detection → drives `paceRef`.
	useEffect(() => {
		if (!state.visible || !state.voicePaced) {
			paceRef.current = state.voicePaced ? paceRef.current : 1;
			return;
		}
		let cancelled = false;
		let audioContext: AudioContext | null = null;
		let stream: MediaStream | null = null;
		let analyser: AnalyserNode | null = null;
		let levelRaf: number | null = null;

		const start = async () => {
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					audio: state.microphoneDeviceId
						? { deviceId: { exact: state.microphoneDeviceId } }
						: true,
					video: false,
				});
				if (cancelled) {
					stream.getTracks().forEach((t) => t.stop());
					return;
				}
				audioContext = new AudioContext();
				const source = audioContext.createMediaStreamSource(stream);
				analyser = audioContext.createAnalyser();
				analyser.fftSize = 1024;
				source.connect(analyser);
				const data = new Uint8Array(analyser.fftSize);

				const measure = () => {
					if (cancelled || !analyser) return;
					analyser.getByteTimeDomainData(data);
					let sumSquares = 0;
					for (let i = 0; i < data.length; i++) {
						const v = (data[i] - 128) / 128;
						sumSquares += v * v;
					}
					const rms = Math.sqrt(sumSquares / data.length);
					// Map RMS to a 0..1.3 pace. ~0.02 is quiet-room noise floor.
					const speaking = Math.max(0, (rms - 0.02) / 0.12);
					const target = Math.min(1.3, speaking);
					// Smooth: rise fast, fall slower so brief pauses don't jerk.
					const smoothing = target > paceRef.current ? 0.4 : 0.06;
					paceRef.current += (target - paceRef.current) * smoothing;
					levelRaf = requestAnimationFrame(measure);
				};
				measure();
			} catch (error) {
				console.warn("[teleprompter] mic level unavailable, using steady pace:", error);
				paceRef.current = 1;
			}
		};
		void start();

		return () => {
			cancelled = true;
			if (levelRaf !== null) cancelAnimationFrame(levelRaf);
			analyser?.disconnect();
			stream?.getTracks().forEach((t) => t.stop());
			void audioContext?.close();
		};
	}, [state.visible, state.voicePaced, state.microphoneDeviceId]);

	// Scroll loop.
	useEffect(() => {
		if (!state.visible) {
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
			lastTsRef.current = null;
			return;
		}

		const tick = (ts: number) => {
			const el = scrollRef.current;
			if (lastTsRef.current === null) lastTsRef.current = ts;
			const dt = Math.min(0.1, (ts - lastTsRef.current) / 1000);
			lastTsRef.current = ts;

			if (el) {
				const pace = stateRef.current.voicePaced
					? // Keep a slow drift even in silence so it never fully stalls.
						Math.max(0.12, paceRef.current)
					: 1;
				const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
				scrollPosRef.current = Math.min(
					maxScroll,
					scrollPosRef.current + stateRef.current.speed * pace * dt,
				);
				el.scrollTop = scrollPosRef.current;
			}
			rafRef.current = requestAnimationFrame(tick);
		};
		rafRef.current = requestAnimationFrame(tick);
		return () => {
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
			lastTsRef.current = null;
		};
	}, [state.visible]);

	const containerStyle = useMemo<React.CSSProperties>(
		() => ({ opacity: state.visible ? state.opacity : 0 }),
		[state.visible, state.opacity],
	);

	if (!state.visible || !state.script.trim()) {
		return <div style={{ width: "100%", height: "100%", background: "transparent" }} />;
	}

	return (
		<div
			style={{
				width: "100%",
				height: "100vh",
				background: "transparent",
				pointerEvents: "none",
				userSelect: "none",
				...containerStyle,
				transition: "opacity 200ms ease",
			}}
		>
			<div
				style={{
					position: "relative",
					width: "100%",
					height: "100%",
					display: "flex",
					justifyContent: "center",
				}}
			>
				{/* Soft dark scrim behind the text for legibility on any background. */}
				<div
					style={{
						position: "absolute",
						inset: 0,
						background:
							"linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 14%, rgba(0,0,0,0.55) 78%, rgba(0,0,0,0) 100%)",
						maskImage:
							"linear-gradient(to bottom, transparent 0%, black 12%, black 80%, transparent 100%)",
						WebkitMaskImage:
							"linear-gradient(to bottom, transparent 0%, black 12%, black 80%, transparent 100%)",
					}}
				/>
				{/* Reading guide line. */}
				<div
					style={{
						position: "absolute",
						top: "38%",
						left: "8%",
						right: "8%",
						height: 2,
						background:
							"linear-gradient(to right, rgba(190,242,100,0) 0%, rgba(190,242,100,0.6) 50%, rgba(190,242,100,0) 100%)",
					}}
				/>
				<div
					ref={scrollRef}
					style={{
						position: "relative",
						width: "min(78%, 980px)",
						height: "100%",
						overflow: "hidden",
						maskImage:
							"linear-gradient(to bottom, transparent 0%, black 14%, black 78%, transparent 100%)",
						WebkitMaskImage:
							"linear-gradient(to bottom, transparent 0%, black 14%, black 78%, transparent 100%)",
					}}
				>
					{/* Top spacer so the script starts under the guide, plus bottom spacer
					    so the last line can scroll up to the guide. */}
					<div style={{ height: "38vh" }} />
					<div
						style={{
							color: "#f5f5f5",
							fontSize: state.fontSize,
							lineHeight: 1.5,
							fontWeight: 600,
							textAlign: "center",
							textShadow: "0 2px 10px rgba(0,0,0,0.9)",
							whiteSpace: "pre-wrap",
							fontFamily:
								"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
						}}
					>
						{state.script}
					</div>
					<div style={{ height: "62vh" }} />
				</div>
			</div>
		</div>
	);
}
