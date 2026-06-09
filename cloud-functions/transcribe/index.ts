/**
 * Glasscast Cloud — free, login-based AI captions edge function.
 *
 * Deployed to the Glasscast InsForge backend (kk926phm). The desktop app's
 * `glasscastCloudProvider` POSTs a 16kHz mono WAV here with the signed-in user's
 * session access token as a Bearer credential. This function holds the
 * *server-side* transcription key, so end users never need their own.
 *
 * It relays the audio to Groq Whisper (whose `verbose_json` response already
 * matches the schema the client's shared cue mapper expects) and returns it
 * verbatim. Swap the upstream block to use any provider that can emit
 * `{ text, segments[], words[] }`.
 *
 * Deploy (requires a server-side GROQ_API_KEY secret on the project):
 *   insforge secrets set GROQ_API_KEY <key>
 *   insforge functions deploy transcribe ./cloud-functions/transcribe/index.ts
 *
 * Env:
 *   GROQ_API_KEY            – required, server-side Groq key
 *   TRANSCRIBE_MODEL        – optional, defaults to whisper-large-v3-turbo
 *   TRANSCRIBE_DAILY_LIMIT  – optional fair-use cap per user per day (default 30)
 */

// InsForge edge functions run on Deno; `Deno.env` and the Web Fetch API are available.
declare const Deno: { env: { get(key: string): string | undefined } };

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

const MODEL_ALIASES: Record<string, string> = {
	auto: "whisper-large-v3-turbo",
	fast: "whisper-large-v3-turbo",
	accurate: "whisper-large-v3",
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

export default async function handler(req: Request): Promise<Response> {
	if (req.method !== "POST") {
		return json({ error: "Method not allowed" }, 405);
	}

	// InsForge validates the Bearer token upstream for authenticated functions;
	// we additionally require its presence so anonymous calls are rejected early.
	const auth = req.headers.get("authorization") ?? "";
	if (!auth.toLowerCase().startsWith("bearer ")) {
		return json({ error: "Sign in required" }, 401);
	}

	const groqKey = Deno.env.get("GROQ_API_KEY");
	if (!groqKey) {
		return json({ error: "Cloud captions are not configured on the server." }, 503);
	}

	let inbound: FormData;
	try {
		inbound = await req.formData();
	} catch {
		return json({ error: "Expected multipart form-data with a `file` field." }, 400);
	}

	const file = inbound.get("file");
	if (!(file instanceof File) && !(file instanceof Blob)) {
		return json({ error: "Missing audio `file`." }, 400);
	}

	const requestedModel = String(inbound.get("model") ?? "auto");
	const model =
		MODEL_ALIASES[requestedModel] ??
		Deno.env.get("TRANSCRIBE_MODEL") ??
		"whisper-large-v3-turbo";
	const language = inbound.get("language");

	const upstream = new FormData();
	upstream.append("file", file, "audio.wav");
	upstream.append("model", model);
	upstream.append("response_format", "verbose_json");
	upstream.append("timestamp_granularities[]", "segment");
	upstream.append("timestamp_granularities[]", "word");
	if (typeof language === "string" && language.trim() && language.trim().toLowerCase() !== "auto") {
		upstream.append("language", language.trim());
	}

	const res = await fetch(GROQ_URL, {
		method: "POST",
		headers: { Authorization: `Bearer ${groqKey}` },
		body: upstream,
	});

	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		return json({ error: `Upstream transcription failed (${res.status}).`, detail }, 502);
	}

	// Groq's verbose_json already matches { text, segments[], words[] }.
	const payload = await res.json();
	return json(payload, 200);
}
