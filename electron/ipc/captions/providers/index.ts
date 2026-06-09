import { deepgramProvider } from "./deepgram";
import { glasscastCloudProvider } from "./glasscastCloud";
import { groqWhisperProvider } from "./groqWhisper";
import { localWhisperProvider } from "./localWhisper";
import { openaiWhisperProvider } from "./openaiWhisper";
import type { CaptionProvider, CaptionProviderId } from "./types";

export const CAPTION_PROVIDERS: Record<CaptionProviderId, CaptionProvider> = {
	local: localWhisperProvider,
	openai: openaiWhisperProvider,
	groq: groqWhisperProvider,
	deepgram: deepgramProvider,
	glasscast: glasscastCloudProvider,
};

export const CAPTION_PROVIDER_IDS = Object.keys(CAPTION_PROVIDERS) as CaptionProviderId[];

export const DEFAULT_CAPTION_PROVIDER_ID: CaptionProviderId = "local";

export function isCaptionProviderId(value: unknown): value is CaptionProviderId {
	return (
		typeof value === "string" &&
		Object.prototype.hasOwnProperty.call(CAPTION_PROVIDERS, value)
	);
}

export function getCaptionProvider(providerId: string): CaptionProvider {
	if (!isCaptionProviderId(providerId)) {
		throw new Error(`Unknown caption provider: ${String(providerId)}`);
	}
	return CAPTION_PROVIDERS[providerId];
}

export type { CaptionProvider, CaptionProviderId, CaptionProviderModel } from "./types";
