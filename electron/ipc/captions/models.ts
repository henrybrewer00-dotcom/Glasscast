import { WHISPER_SMALL_MODEL_PATH, whisperModelPathForFile } from "../constants";

export type WhisperModelId = "tiny" | "base" | "small" | "medium" | "large-v3-turbo";

export interface WhisperModelDescriptor {
	/** Stable identifier used across IPC + UI selection state. */
	id: WhisperModelId;
	/** Human-readable label for the model picker. */
	label: string;
	/** ggml file name as it is stored on disk and served by Hugging Face. */
	fileName: string;
	/** Hugging Face resolve URL for the ggml weights. */
	downloadUrl: string;
	/** Approximate on-disk size in bytes (for UI hints, not validation). */
	sizeBytes: number;
}

const HF_RESOLVE_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

function resolveUrl(fileName: string): string {
	return `${HF_RESOLVE_BASE}/${fileName}`;
}

/**
 * Registry of locally-runnable whisper.cpp models. The `small` entry keeps the
 * exact file name + path used by the previous single-model implementation so
 * already-downloaded models keep working without a re-download.
 */
export const WHISPER_MODELS: Record<WhisperModelId, WhisperModelDescriptor> = {
	tiny: {
		id: "tiny",
		label: "Tiny",
		fileName: "ggml-tiny.bin",
		downloadUrl: resolveUrl("ggml-tiny.bin"),
		sizeBytes: 77_700_000,
	},
	base: {
		id: "base",
		label: "Base",
		fileName: "ggml-base.bin",
		downloadUrl: resolveUrl("ggml-base.bin"),
		sizeBytes: 148_000_000,
	},
	small: {
		id: "small",
		label: "Small",
		fileName: "ggml-small.bin",
		downloadUrl: resolveUrl("ggml-small.bin"),
		sizeBytes: 488_000_000,
	},
	medium: {
		id: "medium",
		label: "Medium",
		fileName: "ggml-medium.bin",
		downloadUrl: resolveUrl("ggml-medium.bin"),
		sizeBytes: 1_530_000_000,
	},
	"large-v3-turbo": {
		id: "large-v3-turbo",
		label: "Large v3 Turbo",
		fileName: "ggml-large-v3-turbo.bin",
		downloadUrl: resolveUrl("ggml-large-v3-turbo.bin"),
		sizeBytes: 1_620_000_000,
	},
};

export const WHISPER_MODEL_IDS = Object.keys(WHISPER_MODELS) as WhisperModelId[];

export const DEFAULT_WHISPER_MODEL_ID: WhisperModelId = "small";

export function isWhisperModelId(value: unknown): value is WhisperModelId {
	return typeof value === "string" && Object.prototype.hasOwnProperty.call(WHISPER_MODELS, value);
}

export function getWhisperModel(modelId: string): WhisperModelDescriptor {
	if (!isWhisperModelId(modelId)) {
		throw new Error(`Unknown Whisper model id: ${String(modelId)}`);
	}
	return WHISPER_MODELS[modelId];
}

/**
 * Resolve the on-disk path for a registry model. The `small` model intentionally
 * resolves to the legacy WHISPER_SMALL_MODEL_PATH for backwards compatibility.
 */
export function getWhisperModelPath(modelId: WhisperModelId): string {
	if (modelId === "small") {
		return WHISPER_SMALL_MODEL_PATH;
	}
	return whisperModelPathForFile(WHISPER_MODELS[modelId].fileName);
}
