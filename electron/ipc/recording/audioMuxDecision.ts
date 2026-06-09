/**
 * Pure decision logic for how a native macOS recording's audio tracks should be
 * handled after capture stops.
 *
 * The Swift ScreenCaptureKit helper can write microphone (and/or system) audio
 * *inline* into the video container. When it does, muxing the sidecar mic track
 * back in produces a duplicated / echoing mic track (issues #628, #636, #602,
 * #642). The source of truth must therefore be explicit: probe the recorded
 * video for an inline audio stream, and only fold in a sidecar mic track when
 * the video has no inline audio of its own.
 *
 * This module is intentionally free of any I/O so it can be unit tested. The
 * caller is responsible for running ffprobe and supplying the result via
 * {@link InlineAudioProbe}.
 */

export interface InlineAudioProbe {
	/** True when the recorded video container carries at least one audio stream. */
	hasInlineAudio: boolean;
	/**
	 * Optional: the codec name of the first inline audio stream (e.g. "aac").
	 * Only used for diagnostics; it does not change the decision.
	 */
	inlineAudioCodec?: string | null;
}

export interface AudioMuxDecisionInput {
	/** Result of probing the recorded video for inline audio. */
	probe: InlineAudioProbe;
	/** Sidecar system-audio file path written by the helper, if any. */
	systemAudioPath?: string | null;
	/** Sidecar microphone file path written by the helper, if any. */
	microphonePath?: string | null;
}

export type AudioMuxSkipReason =
	| "no-sidecar"
	| "inline-audio-present";

export interface AudioMuxDecision {
	/**
	 * When true, the sidecar microphone track should be kept/placed alongside the
	 * video so the editor can use it. When false, the sidecar mic is redundant
	 * (the video already has inline audio) and must be ignored to avoid echo.
	 */
	muxMicrophone: boolean;
	/**
	 * The system-audio sidecar is never inline (the helper writes mic inline, not
	 * system audio), so it is kept whenever it is present.
	 */
	keepSystemAudio: boolean;
	/** Reason the mic sidecar was skipped, when {@link muxMicrophone} is false. */
	skipMicReason: AudioMuxSkipReason | null;
}

/**
 * Decide which audio sidecars to keep for a native macOS recording.
 *
 * Rules:
 *  - If the recorded video already contains inline audio, NEVER add the mic
 *    sidecar (it is the same mic the helper wrote inline → duplicate/echo).
 *  - If the recorded video has no inline audio, the mic sidecar IS the audio,
 *    so keep it when present.
 *  - System-audio sidecars are always kept when present (the helper does not
 *    write system audio inline).
 */
export function decideMacAudioMux(input: AudioMuxDecisionInput): AudioMuxDecision {
	const hasMicSidecar = Boolean(input.microphonePath);
	const hasSystemSidecar = Boolean(input.systemAudioPath);
	const inlineAudioPresent = Boolean(input.probe?.hasInlineAudio);

	let muxMicrophone = false;
	let skipMicReason: AudioMuxSkipReason | null = null;

	if (!hasMicSidecar) {
		skipMicReason = "no-sidecar";
	} else if (inlineAudioPresent) {
		// The video already carries the mic inline — adding the sidecar would
		// double the mic track and cause the echo reported in #628.
		muxMicrophone = false;
		skipMicReason = "inline-audio-present";
	} else {
		muxMicrophone = true;
		skipMicReason = null;
	}

	return {
		muxMicrophone,
		keepSystemAudio: hasSystemSidecar,
		skipMicReason,
	};
}

/**
 * Parse `ffprobe -show_streams` style output (or any text containing
 * `codec_type=audio`) into an {@link InlineAudioProbe}. Kept pure for testing;
 * the caller runs ffprobe and passes its stdout here.
 *
 * Accepts both the `-of default` key=value format and the compact
 * `-show_entries stream=codec_type,codec_name` output.
 */
export function parseInlineAudioProbeOutput(probeOutput: string): InlineAudioProbe {
	if (typeof probeOutput !== "string" || probeOutput.trim().length === 0) {
		return { hasInlineAudio: false, inlineAudioCodec: null };
	}

	const lines = probeOutput.split(/\r?\n/);
	let hasInlineAudio = false;
	let inlineAudioCodec: string | null = null;

	// Track codec_name per stream block so we can attribute it to an audio stream.
	let pendingCodecName: string | null = null;
	let sawStreamSeparator = false;

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (line.length === 0) {
			continue;
		}

		if (line === "[STREAM]") {
			pendingCodecName = null;
			sawStreamSeparator = true;
			continue;
		}
		if (line === "[/STREAM]") {
			pendingCodecName = null;
			continue;
		}

		const codecNameMatch = line.match(/^codec_name=(.+)$/i);
		if (codecNameMatch) {
			pendingCodecName = codecNameMatch[1].trim() || null;
			continue;
		}

		if (/^codec_type=audio$/i.test(line)) {
			hasInlineAudio = true;
			if (!inlineAudioCodec && pendingCodecName) {
				inlineAudioCodec = pendingCodecName;
			}
		}
	}

	// Fallback: some ffprobe invocations emit a single compact token list rather
	// than [STREAM] blocks. If we never saw a stream separator but the text still
	// mentions an audio codec_type, treat it as inline audio.
	if (!hasInlineAudio && !sawStreamSeparator && /codec_type=audio/i.test(probeOutput)) {
		hasInlineAudio = true;
	}

	return { hasInlineAudio, inlineAudioCodec };
}
