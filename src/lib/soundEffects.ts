/**
 * Glasscast sound-effects engine.
 *
 * A tiny synth-based SFX system — every sound is generated on the fly with the
 * Web Audio API, so there are **no audio asset files** to ship or load. Each
 * effect is described by a pure {@link SfxVoice} (oscillator type, a pitch sweep
 * and an amplitude envelope), which makes the sound design unit-testable without
 * a real AudioContext.
 *
 * Usage (renderer only):
 *   import { soundEffects } from "@/lib/soundEffects";
 *   soundEffects.setEnabled(true);
 *   soundEffects.play("whoosh-in");
 */

export type SfxName =
	| "click"
	| "pop"
	| "whoosh-in"
	| "whoosh-out"
	| "success"
	| "capture-start"
	| "capture-stop"
	| "error";

export interface SfxTone {
	/** Oscillator waveform. */
	type: OscillatorType;
	/** Start frequency in Hz. */
	startFreq: number;
	/** End frequency in Hz (linear ramp from startFreq). */
	endFreq: number;
	/** Peak gain for this tone (0–1), before the master volume is applied. */
	gain: number;
	/** Delay before this tone starts, in seconds (for layered/arpeggiated effects). */
	delay?: number;
}

export interface SfxVoice {
	/** Total duration of the effect in seconds. */
	duration: number;
	/** Attack time in seconds (gain ramps 0 -> peak). */
	attack: number;
	/** One or more layered tones. */
	tones: SfxTone[];
}

/** Selectable keyboard-typing sound packs. "off" disables the sound. */
export type KeyboardSoundPreset = "off" | "typewriter" | "mechanical" | "soft" | "clicky" | "thock";
/** Selectable mouse-click sound packs. "off" disables the sound. */
export type MouseSoundPreset = "off" | "soft" | "click" | "thock" | "tactile";

export const KEYBOARD_SOUND_PRESETS: ReadonlyArray<{ value: KeyboardSoundPreset; label: string }> =
	[
		{ value: "off", label: "Off" },
		{ value: "typewriter", label: "Typewriter" },
		{ value: "mechanical", label: "Mechanical" },
		{ value: "clicky", label: "Clicky (blue)" },
		{ value: "thock", label: "Thock (deep)" },
		{ value: "soft", label: "Soft" },
	];

export const MOUSE_SOUND_PRESETS: ReadonlyArray<{ value: MouseSoundPreset; label: string }> = [
	{ value: "off", label: "Off" },
	{ value: "soft", label: "Soft" },
	{ value: "click", label: "Click" },
	{ value: "thock", label: "Thock" },
	{ value: "tactile", label: "Tactile" },
];

/** Voice for a single keypress in the chosen preset. Exported for testing. */
export function getKeyboardVoice(preset: KeyboardSoundPreset): SfxVoice | null {
	switch (preset) {
		case "typewriter":
			return {
				duration: 0.06,
				attack: 0.001,
				tones: [
					{ type: "square", startFreq: 1400, endFreq: 900, gain: 0.16 },
					{ type: "triangle", startFreq: 300, endFreq: 180, gain: 0.1 },
				],
			};
		case "mechanical":
			return {
				duration: 0.05,
				attack: 0.001,
				tones: [{ type: "square", startFreq: 760, endFreq: 520, gain: 0.16 }],
			};
		case "clicky":
			return {
				duration: 0.045,
				attack: 0.001,
				tones: [{ type: "square", startFreq: 1600, endFreq: 1100, gain: 0.14 }],
			};
		case "thock":
			return {
				duration: 0.08,
				attack: 0.002,
				tones: [{ type: "sine", startFreq: 240, endFreq: 150, gain: 0.26 }],
			};
		case "soft":
			return {
				duration: 0.05,
				attack: 0.003,
				tones: [{ type: "sine", startFreq: 480, endFreq: 360, gain: 0.14 }],
			};
		default:
			return null;
	}
}

/** Voice for a single mouse click in the chosen preset. Exported for testing. */
export function getMouseVoice(preset: MouseSoundPreset): SfxVoice | null {
	switch (preset) {
		case "soft":
			return {
				duration: 0.05,
				attack: 0.002,
				tones: [{ type: "sine", startFreq: 600, endFreq: 420, gain: 0.16 }],
			};
		case "click":
			return {
				duration: 0.04,
				attack: 0.001,
				tones: [{ type: "square", startFreq: 1200, endFreq: 800, gain: 0.14 }],
			};
		case "thock":
			return {
				duration: 0.09,
				attack: 0.002,
				tones: [{ type: "sine", startFreq: 220, endFreq: 130, gain: 0.28 }],
			};
		case "tactile":
			return {
				duration: 0.06,
				attack: 0.001,
				tones: [
					{ type: "square", startFreq: 900, endFreq: 600, gain: 0.13 },
					{ type: "sine", startFreq: 280, endFreq: 200, gain: 0.12 },
				],
			};
		default:
			return null;
	}
}

/** Pure, deterministic description of every effect — exported for testing. */
export function getSfxVoice(name: SfxName): SfxVoice {
	switch (name) {
		case "click":
			return {
				duration: 0.05,
				attack: 0.001,
				tones: [{ type: "square", startFreq: 880, endFreq: 660, gain: 0.18 }],
			};
		case "pop":
			return {
				duration: 0.12,
				attack: 0.002,
				tones: [{ type: "sine", startFreq: 320, endFreq: 720, gain: 0.3 }],
			};
		case "whoosh-in":
			// Rising sweep — "punching in".
			return {
				duration: 0.32,
				attack: 0.04,
				tones: [
					{ type: "sawtooth", startFreq: 180, endFreq: 720, gain: 0.16 },
					{ type: "sine", startFreq: 90, endFreq: 360, gain: 0.12 },
				],
			};
		case "whoosh-out":
			// Falling sweep — "pulling back".
			return {
				duration: 0.34,
				attack: 0.04,
				tones: [
					{ type: "sawtooth", startFreq: 640, endFreq: 160, gain: 0.16 },
					{ type: "sine", startFreq: 320, endFreq: 80, gain: 0.12 },
				],
			};
		case "success":
			// Major triad arpeggio (C5 - E5 - G5).
			return {
				duration: 0.5,
				attack: 0.005,
				tones: [
					{ type: "triangle", startFreq: 523, endFreq: 523, gain: 0.24, delay: 0 },
					{ type: "triangle", startFreq: 659, endFreq: 659, gain: 0.24, delay: 0.09 },
					{ type: "triangle", startFreq: 784, endFreq: 784, gain: 0.24, delay: 0.18 },
				],
			};
		case "capture-start":
			return {
				duration: 0.18,
				attack: 0.004,
				tones: [{ type: "sine", startFreq: 520, endFreq: 880, gain: 0.26 }],
			};
		case "capture-stop":
			return {
				duration: 0.2,
				attack: 0.004,
				tones: [{ type: "sine", startFreq: 660, endFreq: 330, gain: 0.26 }],
			};
		case "error":
			return {
				duration: 0.3,
				attack: 0.004,
				tones: [
					{ type: "square", startFreq: 200, endFreq: 140, gain: 0.2 },
					{ type: "square", startFreq: 150, endFreq: 100, gain: 0.16, delay: 0.12 },
				],
			};
		default: {
			// Exhaustiveness guard — `name` is `never` here if the switch is complete.
			const _never: never = name;
			void _never;
			return { duration: 0.05, attack: 0.001, tones: [] };
		}
	}
}

/**
 * Decide whether a zoom progress transition should fire a whoosh.
 *
 * Returns "whoosh-in" the first time progress crosses up through `threshold`,
 * "whoosh-out" the first time it crosses back down, and null otherwise — so the
 * caller can drive cinematic SFX straight from the playback progress value
 * without double-triggering each frame. Pure & exported for testing.
 */
export function planZoomWhoosh(
	prevProgress: number,
	progress: number,
	threshold = 0.15,
): SfxName | null {
	if (prevProgress <= threshold && progress > threshold) {
		return "whoosh-in";
	}
	if (prevProgress > threshold && progress <= threshold) {
		return "whoosh-out";
	}
	return null;
}

/** Clamp a user-facing volume (0–1). Exported for testing. */
export function clampVolume(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

type AudioContextCtor = typeof AudioContext;

export class SoundEffectsEngine {
	private enabled = false;
	private volume = 0.6;
	private keyboardPreset: KeyboardSoundPreset = "off";
	private mousePreset: MouseSoundPreset = "off";
	private context: AudioContext | null = null;
	private master: GainNode | null = null;
	private readonly ctor: AudioContextCtor | null;

	constructor(ctor?: AudioContextCtor | null) {
		this.ctor =
			ctor ??
			(typeof window !== "undefined"
				? (window.AudioContext ??
					(window as unknown as { webkitAudioContext?: AudioContextCtor })
						.webkitAudioContext ??
					null)
				: null);
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	setVolume(volume: number): void {
		this.volume = clampVolume(volume);
		if (this.master) {
			this.master.gain.value = this.volume;
		}
	}

	getVolume(): number {
		return this.volume;
	}

	setKeyboardSound(preset: KeyboardSoundPreset): void {
		this.keyboardPreset = preset;
	}

	getKeyboardSound(): KeyboardSoundPreset {
		return this.keyboardPreset;
	}

	setMouseSound(preset: MouseSoundPreset): void {
		this.mousePreset = preset;
	}

	getMouseSound(): MouseSoundPreset {
		return this.mousePreset;
	}

	private ensureContext(): AudioContext | null {
		if (!this.ctor) return null;
		if (!this.context) {
			this.context = new this.ctor();
			this.master = this.context.createGain();
			this.master.gain.value = this.volume;
			this.master.connect(this.context.destination);
		}
		// Browsers may start the context suspended until a user gesture.
		if (this.context.state === "suspended") {
			void this.context.resume().catch(() => undefined);
		}
		return this.context;
	}

	/** Play an effect. No-op when disabled or when Web Audio is unavailable. */
	play(name: SfxName): void {
		if (!this.enabled) return;
		this.playVoice(getSfxVoice(name));
	}

	/**
	 * Play a single keypress sound for the configured keyboard preset. Independent
	 * of the master editor-SFX toggle — driven only by the keyboard preset. A small
	 * random pitch wobble keeps fast typing from sounding robotic.
	 */
	playKeyboard(): void {
		const voice = getKeyboardVoice(this.keyboardPreset);
		if (voice) this.playVoice(voice, 0.94 + Math.random() * 0.12);
	}

	/** Play a single mouse-click sound for the configured mouse preset. */
	playMouse(): void {
		const voice = getMouseVoice(this.mousePreset);
		if (voice) this.playVoice(voice, 0.97 + Math.random() * 0.06);
	}

	private playVoice(voice: SfxVoice, pitchMultiplier = 1): void {
		const ctx = this.ensureContext();
		const master = this.master;
		if (!ctx || !master) return;

		const now = ctx.currentTime;
		for (const tone of voice.tones) {
			const start = now + (tone.delay ?? 0);
			const end = start + voice.duration;
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();

			osc.type = tone.type;
			osc.frequency.setValueAtTime(tone.startFreq * pitchMultiplier, start);
			if (tone.endFreq !== tone.startFreq) {
				osc.frequency.linearRampToValueAtTime(tone.endFreq * pitchMultiplier, end);
			}

			gain.gain.setValueAtTime(0, start);
			gain.gain.linearRampToValueAtTime(tone.gain, start + voice.attack);
			gain.gain.exponentialRampToValueAtTime(0.0001, end);

			osc.connect(gain);
			gain.connect(master);
			osc.start(start);
			osc.stop(end + 0.02);
		}
	}

	/** Release audio resources. */
	dispose(): void {
		if (this.context) {
			void this.context.close().catch(() => undefined);
			this.context = null;
			this.master = null;
		}
	}
}

/** Shared singleton used across the editor UI. */
export const soundEffects = new SoundEffectsEngine();
