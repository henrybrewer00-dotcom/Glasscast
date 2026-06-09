import fs from "node:fs/promises";
import path from "node:path";
import { INSFORGE_BASE_URL } from "../../../cloud/insforgeClient";
import { loadSession } from "../../../cloud/sessionStore";
import type { CaptionCuePayload } from "../../types";
import { mapVerboseTranscriptionToCues, type VerboseTranscriptionResponse } from "./cloudMapping";
import type { CaptionProvider, CaptionProviderModel, TranscribeOptions } from "./types";

/**
 * "Glasscast Cloud" — the free, login-based AI captions path.
 *
 * Instead of asking the user for their own provider key, this provider relays the
 * extracted WAV to a Glasscast-hosted InsForge edge function which holds the
 * server-side transcription key. The only requirement is that the user is signed
 * in to their (free) Glasscast cloud account, so the request can be authenticated
 * with their session access token.
 *
 * The edge function is expected to return a Whisper-style `verbose_json` payload
 * ({ text, segments[], words[] }) so it reuses the shared cue mapper.
 */
const TRANSCRIBE_FUNCTION_URL = `${INSFORGE_BASE_URL}/functions/transcribe`;

const GLASSCAST_MODELS: CaptionProviderModel[] = [
	{ id: "auto", label: "Auto (recommended)" },
	{ id: "fast", label: "Fast" },
	{ id: "accurate", label: "Accurate" },
];

const DEFAULT_GLASSCAST_MODEL = "auto";

function resolveModel(modelId: string): string {
	const match = GLASSCAST_MODELS.find((model) => model.id === modelId);
	return match ? match.id : DEFAULT_GLASSCAST_MODEL;
}

export function buildGlasscastTranscriptionForm(
	wavBytes: ArrayBuffer,
	wavName: string,
	model: string,
	language?: string,
): FormData {
	const form = new FormData();
	const blob = new Blob([wavBytes], { type: "audio/wav" });
	form.append("file", blob, wavName);
	form.append("model", model);
	if (language && language.trim() && language.trim().toLowerCase() !== "auto") {
		form.append("language", language.trim());
	}
	return form;
}

export async function transcribeWithGlasscastCloud(
	wavPath: string,
	options: TranscribeOptions,
): Promise<CaptionCuePayload[]> {
	// Prefer an explicitly supplied token (e.g. tests / future flows); otherwise
	// fall back to the persisted Glasscast cloud session.
	let accessToken = options.apiKey?.trim();
	if (!accessToken) {
		const session = await loadSession();
		accessToken = session?.accessToken?.trim();
	}

	if (!accessToken) {
		throw new Error(
			"Sign in to your free Glasscast account to use cloud captions — no API key needed.",
		);
	}

	const model = resolveModel(options.modelId);
	const wavBuffer = await fs.readFile(wavPath);
	const wavBytes = wavBuffer.buffer.slice(
		wavBuffer.byteOffset,
		wavBuffer.byteOffset + wavBuffer.byteLength,
	) as ArrayBuffer;

	const form = buildGlasscastTranscriptionForm(
		wavBytes,
		path.basename(wavPath),
		model,
		options.language,
	);

	const response = await fetch(TRANSCRIBE_FUNCTION_URL, {
		method: "POST",
		headers: { Authorization: `Bearer ${accessToken}` },
		body: form,
	});

	if (response.status === 401 || response.status === 403) {
		throw new Error("Your Glasscast session has expired. Sign in again to use cloud captions.");
	}
	if (response.status === 429) {
		throw new Error(
			"Free cloud caption limit reached for now. Try again later, or add your own provider key.",
		);
	}
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(
			`Glasscast cloud transcription failed (${response.status}). ${detail}`.trim(),
		);
	}

	const payload = (await response.json()) as VerboseTranscriptionResponse;
	const cues = mapVerboseTranscriptionToCues(payload);
	if (cues.length === 0) {
		throw new Error(
			"Glasscast cloud transcription completed, but no caption cues were produced.",
		);
	}

	return cues;
}

export const glasscastCloudProvider: CaptionProvider = {
	id: "glasscast",
	label: "Glasscast Cloud (Free)",
	kind: "cloud",
	listModels: () => GLASSCAST_MODELS,
	transcribe: transcribeWithGlasscastCloud,
};
