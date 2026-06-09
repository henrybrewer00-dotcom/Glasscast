export const ZOOM_ROW_ID = "row-zoom";
export const CLIP_ROW_ID = "row-clip";
export const ANNOTATION_ROW_ID = "row-annotation";
export const AUDIO_ROW_ID = "row-audio";
export const SOURCE_AUDIO_ROW_ID = "row-source-audio";
export const ANNOTATION_ROW_PREFIX = `${ANNOTATION_ROW_ID}-`;
export const AUDIO_ROW_PREFIX = `${AUDIO_ROW_ID}-`;

export const FALLBACK_RANGE_MS = 1000;
export const TARGET_MARKER_COUNT = 12;
export const WAVEFORM_DEFAULT_PEAK_COUNT = 2048;

/**
 * Monospace stack for ALL timecodes / durations / numeric readouts in the
 * timeline (camera-body engraving feel). Applied inline because the global
 * `body .font-mono` rule re-maps the Tailwind `font-mono` class to the sans UI
 * font; an inline fontFamily wins that specificity battle without editing the
 * shared stylesheet.
 */
export const TIMELINE_MONO_FONT =
	'ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Monaco, "Cascadia Mono", "Roboto Mono", monospace';
