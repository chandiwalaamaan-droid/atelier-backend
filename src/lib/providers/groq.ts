import { streamOpenAICompatibleChat, completeOpenAICompatibleChat } from "./openaiCompatible";
import type { GenParams } from "./index";

const BASE_URL = "https://api.groq.com/openai/v1";
// llama-3.3-70b-versatile was deprecated by Groq on 2026-06-17 and is slated
// for full shutdown by August 2026. Groq's recommended replacement is
// openai/gpt-oss-120b, but gpt-oss has refusals baked in deep and resists
// this app's explicit/NSFW roleplay mode even with a permissive system
// prompt (see the fallback-chain note in ./index.ts). qwen/qwen3.6-27b is
// the other Groq-recommended replacement and — like the Llama models this
// app is built around — has no extra safety layer applied server-side, so
// it's used as the default here instead. Override with GROQ_MODEL if you
// want gpt-oss-120b or anything else.
const MODEL = process.env.GROQ_MODEL || "qwen/qwen3.6-27b";

export function isGroqConfigured() {
  return Boolean(process.env.GROQ_API_KEY);
}

/**
 * The configured Groq API keys, if any. Up to 4 keys are supported —
 * ideally from separate Groq accounts/signups, since most providers
 * enforce free-tier limits per account, not per key. Leave
 * GROQ_API_KEY_2/3/4 unset to just use one key; extra slots are then
 * simply left out of the fallback chain.
 *
 * Returns each configured key tagged with its original 1-based slot number
 * rather than its position in this filtered array — otherwise, if only
 * GROQ_API_KEY_3 is set, that key would end up at array index 0 and get
 * labeled "Groq #1" even though it's really the third key.
 */
export function getGroqKeys(): { key: string; slot: number }[] {
  return [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY_3, process.env.GROQ_API_KEY_4]
    .map((key, i) => ({ key, slot: i + 1 }))
    .filter((entry): entry is { key: string; slot: number } => Boolean(entry.key));
}

// Qwen's "thinking mode" reasoning tokens are wrapped in <think>...</think>.
// reasoning_format: "hidden" (below) only stops that text from being
// returned — the model still generates it, and those tokens still count
// against your TPD/TPM quota. reasoning_effort is the real fix: "none" is
// documented by Groq as disabling reasoning outright for Qwen 3.6 27B
// specifically ("default" is the other option, and is what re-enables it).
// This app is casual roleplay dialogue, not math/coding, so there's no
// quality reason to pay for chain-of-thought — Groq's own guidance is to
// use non-thinking mode for "efficient, general-purpose dialogue" like
// this. Restricted to exactly qwen/qwen3.6-27b since reasoning_effort's
// accepted values differ per model family (gpt-oss takes low/medium/high
// instead) and sending the wrong value can 400.
// Override with GROQ_REASONING_EFFORT=default if you ever want thinking
// mode back (e.g. testing a task that actually benefits from it).
const IS_REASONING_MODEL = MODEL.startsWith("qwen/");
const SUPPORTS_REASONING_EFFORT = MODEL === "qwen/qwen3.6-27b";
const REASONING_EFFORT = process.env.GROQ_REASONING_EFFORT === "default" ? "default" : "none";
const REASONING_EXTRA_BODY = IS_REASONING_MODEL
  ? {
      reasoning_format: "hidden",
      ...(SUPPORTS_REASONING_EFFORT ? { reasoning_effort: REASONING_EFFORT } : {}),
    }
  : undefined;

// With reasoning_effort="none" the model never spends budget on hidden
// <think> tokens, so there's no reason to reserve the old 3072-token
// cushion for it — that cushion was pure overhead being burned (and
// counted against TPD) on every single reply. Only fall back to the
// bigger budget if reasoning has been explicitly re-enabled via
// GROQ_REASONING_EFFORT=default, where the old empty-completion failure
// mode (stream ending mid-<think>) can recur. Override either way with
// GROQ_MAX_TOKENS.
const THINKING_ACTUALLY_ON = IS_REASONING_MODEL && (!SUPPORTS_REASONING_EFFORT || REASONING_EFFORT === "default");
const MAX_TOKENS = envInt("GROQ_MAX_TOKENS", THINKING_ACTUALLY_ON ? 3072 : 1024);

function envInt(name: string, def: number): number {
  const raw = process.env[name];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : def;
}

function genParamsExtraBody(params?: GenParams): Record<string, unknown> | undefined {
  const body: Record<string, unknown> = { ...REASONING_EXTRA_BODY };
  if (params?.temperature !== undefined) body.temperature = params.temperature;
  if (params?.topP !== undefined) body.top_p = params.topP;
  return Object.keys(body).length ? body : undefined;
}

export async function streamGroqChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  onToken: (chunk: string) => void,
  apiKey: string,
  timeoutMs: number,
  clientSignal?: AbortSignal,
  params?: GenParams
): Promise<string> {
  return streamOpenAICompatibleChat(BASE_URL, apiKey, MODEL, messages, onToken, timeoutMs, clientSignal, genParamsExtraBody(params), MAX_TOKENS);
}

export async function completeGroqChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  apiKey: string,
  timeoutMs: number,
  params?: GenParams
): Promise<string> {
  return completeOpenAICompatibleChat(BASE_URL, apiKey, MODEL, messages, timeoutMs, genParamsExtraBody(params), MAX_TOKENS);
}

// ---------------------------------------------------------------------------
// Text-to-speech (Orpheus, via Groq)
// ---------------------------------------------------------------------------

const TTS_MODEL = "canopylabs/orpheus-v1-english";
// Hard limit set by Groq's Orpheus endpoint — inputs over this are rejected outright.
export const TTS_MAX_CHARS = 200;

export const TTS_VOICES = ["autumn", "diana", "hannah", "austin", "daniel", "troy"] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

/** Synthesizes a single chunk of text (must already be <= TTS_MAX_CHARS) into
 * WAV audio bytes. Callers needing longer text should split it first — see
 * splitForSpeech() in this module. */
export async function synthesizeGroqSpeech(
  text: string,
  voice: TtsVoice,
  apiKey: string,
  timeoutMs: number
): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: TTS_MODEL, input: text, voice, response_format: "wav" }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq TTS failed (${res.status}): ${errText.slice(0, 300)}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Splits text into chunks that each fit under TTS_MAX_CHARS, preferring to
 * break on sentence boundaries (falling back to a hard split only for a
 * single sentence that's already too long on its own). */
export function splitForSpeech(text: string, maxChars: number = TTS_MAX_CHARS): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      // A single sentence longer than the limit on its own — hard-split on
      // word boundaries as a fallback so nothing gets silently dropped.
      let rest = sentence;
      while (rest.length > maxChars) {
        let cut = rest.lastIndexOf(" ", maxChars);
        if (cut <= 0) cut = maxChars;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) current = rest;
      continue;
    }
    if ((current + " " + sentence).trim().length > maxChars) {
      chunks.push(current);
      current = sentence;
    } else {
      current = (current + " " + sentence).trim();
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

/** Groq's Orpheus WAV output has a standard RIFF/WAVE/fmt /data layout.
 * Playing several chunks back as one clip needs a single valid WAV file, not
 * several concatenated headers, so this rewrites one combined header over
 * the concatenated PCM payloads instead. */
export function concatWavBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 1) return buffers[0];

  function findDataChunk(buffer: Buffer): { headerBeforeData: Buffer; data: Buffer } {
    let offset = 12; // past "RIFF" + size(4) + "WAVE"
    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString("ascii", offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      if (chunkId === "data") {
        return { headerBeforeData: buffer.subarray(0, offset), data: buffer.subarray(offset + 8, offset + 8 + chunkSize) };
      }
      offset += 8 + chunkSize + (chunkSize % 2); // chunks are word-aligned
    }
    throw new Error("No 'data' chunk found in WAV audio from TTS provider.");
  }

  const parsed = buffers.map(findDataChunk);
  const totalDataLength = parsed.reduce((sum, p) => sum + p.data.length, 0);
  const header = Buffer.from(parsed[0].headerBeforeData); // fmt chunk etc., identical across chunks from the same call
  header.writeUInt32LE(header.length + 8 + totalDataLength - 8, 4); // RIFF chunk size

  const dataTag = Buffer.alloc(8);
  dataTag.write("data", 0, "ascii");
  dataTag.writeUInt32LE(totalDataLength, 4);

  return Buffer.concat([header, dataTag, ...parsed.map((p) => p.data)]);
}
