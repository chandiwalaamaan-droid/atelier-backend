import { streamOpenAICompatibleChat, completeOpenAICompatibleChat } from "./openaiCompatible";

/**
 * Cerebras (https://cloud.cerebras.ai) — free tier, no credit card, 1M
 * tokens/day, generous rate limit. Added as a hosted slot: another shot at
 * a fast hosted reply before dropping down to the local-only fallback.
 *
 * Their free model catalog changes often — llama-3.3-70b (this app's
 * previous default) and qwen-3-32b were both deprecated by Cerebras on
 * 2026-02-16, and llama3.1-8b followed on 2026-05-27. As of this writing the
 * only two models left on Cerebras are gpt-oss-120b and zai-glm-4.7.
 * gpt-oss-120b is deliberately avoided here for the same reason noted for
 * Groq in ./index.ts — it has refusals baked in deep and resists this app's
 * explicit/NSFW roleplay mode even with a permissive system prompt.
 * zai-glm-4.7 is used instead: it's a raw, unfiltered model, and Cerebras's
 * own migration notes highlight "improved role play and general chat
 * quality" for it specifically. If CEREBRAS_MODEL 404s in the future, check
 * https://inference-docs.cerebras.ai for the current list.
 */
const BASE_URL = "https://api.cerebras.ai/v1";
const MODEL = process.env.CEREBRAS_MODEL || "zai-glm-4.7";

// zai-glm-4.7 reasons by default, which both adds latency (an extra
// "thinking" pass before the real reply starts) and would otherwise need
// the same <think>-tag stripping as Qwen on Groq. reasoning_effort: "none"
// turns that off at the source. This is a no-op (and harmless) for other
// models that don't support the field.
const REASONING_EXTRA_BODY = MODEL === "zai-glm-4.7" ? { reasoning_effort: "none" } : undefined;

export function isCerebrasConfigured() {
  return Boolean(process.env.CEREBRAS_API_KEY);
}

/**
 * Same idea as getNvidiaKeys()/getGroqKeys() — a second key
 * (CEREBRAS_API_KEY_2) is optional, ideally from a separate account/signup
 * since free-tier limits are enforced per account, not per key. Leave it
 * unset to just use one key; that slot is then simply left out of the chain.
 *
 * Returns each configured key tagged with its original 1-based slot number,
 * not its position in this filtered array — otherwise, if only
 * CEREBRAS_API_KEY_2 is set, that key would end up at array index 0 and get
 * labeled "Cerebras #1" even though it's really the second key.
 */
export function getCerebrasKeys(): { key: string; slot: number }[] {
  return [process.env.CEREBRAS_API_KEY, process.env.CEREBRAS_API_KEY_2]
    .map((key, i) => ({ key, slot: i + 1 }))
    .filter((entry): entry is { key: string; slot: number } => Boolean(entry.key));
}

export async function streamCerebrasChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  onToken: (chunk: string) => void,
  apiKey: string,
  timeoutMs: number,
  clientSignal?: AbortSignal
): Promise<string> {
  return streamOpenAICompatibleChat(BASE_URL, apiKey, MODEL, messages, onToken, timeoutMs, clientSignal, REASONING_EXTRA_BODY);
}

export async function completeCerebrasChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  apiKey: string,
  timeoutMs: number
): Promise<string> {
  return completeOpenAICompatibleChat(BASE_URL, apiKey, MODEL, messages, timeoutMs, REASONING_EXTRA_BODY);
}
