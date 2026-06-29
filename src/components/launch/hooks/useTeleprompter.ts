import { useCallback, useEffect, useState } from "react";

const SCRIPT_KEY = "glasscast.teleprompter.script";
const ENABLED_KEY = "glasscast.teleprompter.enabled";
const SPEED_KEY = "glasscast.teleprompter.speed";
const VOICE_PACED_KEY = "glasscast.teleprompter.voicePaced";
const FONT_SIZE_KEY = "glasscast.teleprompter.fontSize";

const DEFAULT_SPEED = 40;
const DEFAULT_FONT_SIZE = 34;

function loadString(key: string, fallback: string): string {
	try {
		return window.localStorage?.getItem(key) ?? fallback;
	} catch {
		return fallback;
	}
}
function loadNumber(key: string, fallback: number): number {
	try {
		const raw = window.localStorage?.getItem(key);
		const n = raw === null || raw === undefined ? Number.NaN : Number(raw);
		return Number.isFinite(n) ? n : fallback;
	} catch {
		return fallback;
	}
}
function loadBool(key: string, fallback: boolean): boolean {
	try {
		const raw = window.localStorage?.getItem(key);
		if (raw === null || raw === undefined) return fallback;
		return raw !== "false";
	} catch {
		return fallback;
	}
}
function store(key: string, value: string): void {
	try {
		window.localStorage?.setItem(key, value);
	} catch {
		// ignore
	}
}

/**
 * Manages the teleprompter script + settings and drives the dedicated
 * teleprompter overlay window (via the main process) so the script is shown,
 * auto-scrolled, and voice-paced only while recording.
 */
export function useTeleprompter({
	recording,
	microphoneDeviceId,
}: {
	recording: boolean;
	microphoneDeviceId?: string;
}) {
	const [teleprompterEnabled, setTeleprompterEnabledState] = useState(() =>
		loadBool(ENABLED_KEY, false),
	);
	const [teleprompterScript, setTeleprompterScriptState] = useState(() => loadString(SCRIPT_KEY, ""));
	const [teleprompterSpeed, setTeleprompterSpeedState] = useState(() =>
		loadNumber(SPEED_KEY, DEFAULT_SPEED),
	);
	const [teleprompterVoicePaced, setTeleprompterVoicePacedState] = useState(() =>
		loadBool(VOICE_PACED_KEY, true),
	);
	const [teleprompterFontSize, setTeleprompterFontSizeState] = useState(() =>
		loadNumber(FONT_SIZE_KEY, DEFAULT_FONT_SIZE),
	);

	const setTeleprompterEnabled = useCallback((value: boolean) => {
		setTeleprompterEnabledState(value);
		store(ENABLED_KEY, value ? "true" : "false");
	}, []);
	const setTeleprompterScript = useCallback((value: string) => {
		setTeleprompterScriptState(value);
		store(SCRIPT_KEY, value);
	}, []);
	const setTeleprompterSpeed = useCallback((value: number) => {
		setTeleprompterSpeedState(value);
		store(SPEED_KEY, String(value));
	}, []);
	const setTeleprompterVoicePaced = useCallback((value: boolean) => {
		setTeleprompterVoicePacedState(value);
		store(VOICE_PACED_KEY, value ? "true" : "false");
	}, []);
	const setTeleprompterFontSize = useCallback((value: number) => {
		setTeleprompterFontSizeState(value);
		store(FONT_SIZE_KEY, String(value));
	}, []);

	// Show the teleprompter only while recording with a non-empty script.
	const visible = recording && teleprompterEnabled && teleprompterScript.trim().length > 0;

	useEffect(() => {
		void window.electronAPI?.teleprompterSetState?.({
			visible,
			script: teleprompterScript,
			speed: teleprompterSpeed,
			fontSize: teleprompterFontSize,
			opacity: 0.9,
			voicePaced: teleprompterVoicePaced,
			microphoneDeviceId: microphoneDeviceId ?? null,
		});
	}, [
		visible,
		teleprompterScript,
		teleprompterSpeed,
		teleprompterFontSize,
		teleprompterVoicePaced,
		microphoneDeviceId,
	]);

	// Hide on unmount.
	useEffect(() => {
		return () => {
			void window.electronAPI?.teleprompterSetState?.({ visible: false });
		};
	}, []);

	return {
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
	};
}
