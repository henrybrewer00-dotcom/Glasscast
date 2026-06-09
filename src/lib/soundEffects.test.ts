import { describe, expect, it, vi } from "vitest";
import {
	clampVolume,
	getKeyboardVoice,
	getMouseVoice,
	getSfxVoice,
	type KeyboardSoundPreset,
	type MouseSoundPreset,
	planZoomWhoosh,
	type SfxName,
	SoundEffectsEngine,
} from "./soundEffects";

const ALL_EFFECTS: SfxName[] = [
	"click",
	"pop",
	"whoosh-in",
	"whoosh-out",
	"success",
	"capture-start",
	"capture-stop",
	"error",
];

describe("getSfxVoice", () => {
	it("returns a well-formed voice for every effect", () => {
		for (const name of ALL_EFFECTS) {
			const voice = getSfxVoice(name);
			expect(voice.duration).toBeGreaterThan(0);
			expect(voice.attack).toBeGreaterThanOrEqual(0);
			expect(voice.attack).toBeLessThan(voice.duration);
			expect(voice.tones.length).toBeGreaterThan(0);
			for (const tone of voice.tones) {
				expect(tone.gain).toBeGreaterThan(0);
				expect(tone.gain).toBeLessThanOrEqual(1);
				expect(tone.startFreq).toBeGreaterThan(0);
				expect(tone.endFreq).toBeGreaterThan(0);
			}
		}
	});

	it("makes whoosh-in rise and whoosh-out fall", () => {
		const inVoice = getSfxVoice("whoosh-in");
		const outVoice = getSfxVoice("whoosh-out");
		expect(inVoice.tones[0].endFreq).toBeGreaterThan(inVoice.tones[0].startFreq);
		expect(outVoice.tones[0].endFreq).toBeLessThan(outVoice.tones[0].startFreq);
	});

	it("plays the success chime as an ascending arpeggio", () => {
		const success = getSfxVoice("success");
		const freqs = success.tones.map((t) => t.startFreq);
		const delays = success.tones.map((t) => t.delay ?? 0);
		expect(freqs).toEqual([...freqs].sort((a, b) => a - b));
		expect(delays).toEqual([...delays].sort((a, b) => a - b));
	});
});

describe("planZoomWhoosh", () => {
	it("fires whoosh-in only on the upward crossing", () => {
		expect(planZoomWhoosh(0, 0.5)).toBe("whoosh-in");
		expect(planZoomWhoosh(0.5, 0.9)).toBeNull(); // already in
		expect(planZoomWhoosh(0.2, 0.3)).toBeNull(); // both above threshold
	});

	it("fires whoosh-out only on the downward crossing", () => {
		expect(planZoomWhoosh(0.9, 0.05)).toBe("whoosh-out");
		expect(planZoomWhoosh(0.05, 0)).toBeNull(); // already out
	});

	it("does nothing while idle", () => {
		expect(planZoomWhoosh(0, 0)).toBeNull();
		expect(planZoomWhoosh(0.1, 0.1)).toBeNull();
	});

	it("respects a custom threshold", () => {
		expect(planZoomWhoosh(0.3, 0.6, 0.5)).toBe("whoosh-in");
		expect(planZoomWhoosh(0.3, 0.6, 0.1)).toBeNull();
	});
});

describe("clampVolume", () => {
	it("clamps into 0..1 and rejects NaN", () => {
		expect(clampVolume(-1)).toBe(0);
		expect(clampVolume(2)).toBe(1);
		expect(clampVolume(0.5)).toBe(0.5);
		expect(clampVolume(Number.NaN)).toBe(0);
	});
});

/** Minimal fake AudioContext that records oscillator scheduling. */
function createFakeAudioContext() {
	const started: Array<{ start: number; stop: number }> = [];
	const ctor = vi.fn().mockImplementation(function FakeCtx(this: Record<string, unknown>) {
		this.currentTime = 0;
		this.state = "running";
		this.destination = {};
		this.createGain = () => ({
			gain: {
				value: 0,
				setValueAtTime: () => undefined,
				linearRampToValueAtTime: () => undefined,
				exponentialRampToValueAtTime: () => undefined,
			},
			connect: () => undefined,
		});
		this.createOscillator = () => ({
			type: "sine",
			frequency: {
				setValueAtTime: () => undefined,
				linearRampToValueAtTime: () => undefined,
			},
			connect: () => undefined,
			start: (t: number) => started.push({ start: t, stop: -1 }),
			stop: (t: number) => {
				if (started.length) started[started.length - 1].stop = t;
			},
		});
		this.resume = () => Promise.resolve();
		this.close = () => Promise.resolve();
	});
	return { ctor: ctor as unknown as typeof AudioContext, started };
}

describe("SoundEffectsEngine", () => {
	it("does nothing when disabled", () => {
		const { ctor, started } = createFakeAudioContext();
		const engine = new SoundEffectsEngine(ctor);
		engine.play("click");
		expect(started.length).toBe(0);
		expect(ctor).not.toHaveBeenCalled();
	});

	it("schedules one oscillator per tone when enabled", () => {
		const { ctor, started } = createFakeAudioContext();
		const engine = new SoundEffectsEngine(ctor);
		engine.setEnabled(true);
		engine.play("whoosh-in"); // 2 tones
		expect(started.length).toBe(2);
		engine.play("success"); // 3 tones
		expect(started.length).toBe(5);
	});

	it("is a no-op when no AudioContext is available", () => {
		const engine = new SoundEffectsEngine(null);
		engine.setEnabled(true);
		expect(() => engine.play("pop")).not.toThrow();
	});

	it("clamps the volume", () => {
		const { ctor } = createFakeAudioContext();
		const engine = new SoundEffectsEngine(ctor);
		engine.setVolume(5);
		expect(engine.getVolume()).toBe(1);
		engine.setVolume(-3);
		expect(engine.getVolume()).toBe(0);
	});
});

describe("keyboard & mouse sound presets", () => {
	const KB: KeyboardSoundPreset[] = ["typewriter", "mechanical", "soft", "clicky", "thock"];
	const MOUSE: MouseSoundPreset[] = ["soft", "click", "thock", "tactile"];

	it("returns a voice for every real keyboard/mouse preset and null for off", () => {
		for (const preset of KB) {
			const voice = getKeyboardVoice(preset);
			expect(voice).not.toBeNull();
			expect(voice?.tones.length).toBeGreaterThan(0);
		}
		for (const preset of MOUSE) {
			expect(getMouseVoice(preset)).not.toBeNull();
		}
		expect(getKeyboardVoice("off")).toBeNull();
		expect(getMouseVoice("off")).toBeNull();
	});

	it("plays a keypress only when a keyboard preset is set", () => {
		const { ctor, started } = createFakeAudioContext();
		const engine = new SoundEffectsEngine(ctor);
		// Note: independent of the master enabled flag.
		engine.playKeyboard();
		expect(started.length).toBe(0);
		engine.setKeyboardSound("mechanical");
		engine.playKeyboard();
		expect(started.length).toBe(1);
	});

	it("plays a click only when a mouse preset is set", () => {
		const { ctor, started } = createFakeAudioContext();
		const engine = new SoundEffectsEngine(ctor);
		engine.playMouse();
		expect(started.length).toBe(0);
		engine.setMouseSound("click");
		engine.playMouse();
		expect(started.length).toBe(1);
	});

	it("exposes the current presets", () => {
		const engine = new SoundEffectsEngine(null);
		engine.setKeyboardSound("thock");
		engine.setMouseSound("tactile");
		expect(engine.getKeyboardSound()).toBe("thock");
		expect(engine.getMouseSound()).toBe("tactile");
	});
});
