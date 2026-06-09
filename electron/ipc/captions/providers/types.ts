import type { CaptionCuePayload } from "../../types";

export type CaptionProviderId = "local" | "openai" | "groq" | "deepgram" | "glasscast";

export type CaptionProviderKind = "local" | "cloud";

export interface CaptionProviderModel {
	/** Model id passed back into transcribe() (whisper registry id or cloud model name). */
	id: string;
	label: string;
}

export interface TranscribeOptions {
	/** Language hint; "auto" or empty means auto-detect. */
	language?: string;
	/** Provider-specific model selection. */
	modelId: string;
	/** Cloud API key (already fetched main-side); ignored by local provider. */
	apiKey?: string;
	/** Optional path to a user-selected whisper executable (local only). */
	whisperExecutablePath?: string | null;
	/** Optional explicit model path override (local only). */
	whisperModelPath?: string | null;
}

export interface CaptionProvider {
	id: CaptionProviderId;
	label: string;
	kind: CaptionProviderKind;
	listModels(): CaptionProviderModel[];
	/**
	 * Transcribe a 16kHz mono WAV file produced by the shared ffmpeg extraction
	 * step into caption cues. Cloud providers may upload the WAV directly.
	 */
	transcribe(wavPath: string, options: TranscribeOptions): Promise<CaptionCuePayload[]>;
}
