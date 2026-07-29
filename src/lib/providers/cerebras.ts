import { streamOpenAICompatibleChat, completeOpenAICompatibleChat } from "./openaiCompatible";

/**
 * Cerebras (https://cloud.cerebras.ai) — free tier, no credit card, 1M
 * tokens/day, generous rate limit. Added as a hosted slot between NVIDIA
 * and Ollama: another shot at a fast hosted reply before dropping down to
 * the local-only fallback. Their free model catalog changes more often
 * than Groq's or NVIDIA's — if CEREBRAS_MODEL 404s, check
 * https://inference-docs.cerebras.ai for the current free list.
 */
const BASE_URL = "https://api.cerebras.ai/v1";
const MODEL = process.env.CEREBRAS_MODEL || "llama-3.3-70b";

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
  return streamOpenAICompatibleChat(BASE_URL, apiKey, MODEL, messages, onToken, timeoutMs, clientSignal);
}

export async function completeCerebrasChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  apiKey: string,
  timeoutMs: number
): Promise<string> {
  return completeOpenAICompatibleChat(BASE_URL, apiKey, MODEL, messages, timeoutMs);
}
