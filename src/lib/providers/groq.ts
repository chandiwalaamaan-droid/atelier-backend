import { streamOpenAICompatibleChat, completeOpenAICompatibleChat } from "./openaiCompatible";

const BASE_URL = "https://api.groq.com/openai/v1";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

export function isGroqConfigured() {
  return Boolean(process.env.GROQ_API_KEY);
}

/**
 * The two configured Groq API keys, if any. A second key is optional —
 * ideally from a SEPARATE Groq account/signup, since most providers
 * enforce free-tier limits per account, not per key, so two keys from one
 * account may still share a single limit. Leave GROQ_API_KEY_2 unset to
 * just use one key; the slot is then simply left out of the fallback chain.
 */
export function getGroqKeys(): string[] {
  return [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2].filter(
    (k): k is string => Boolean(k)
  );
}

export async function streamGroqChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  onToken: (chunk: string) => void,
  apiKey: string,
  timeoutMs: number
): Promise<string> {
  return streamOpenAICompatibleChat(BASE_URL, apiKey, MODEL, messages, onToken, timeoutMs);
}

export async function completeGroqChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  apiKey: string,
  timeoutMs: number
): Promise<string> {
  return completeOpenAICompatibleChat(BASE_URL, apiKey, MODEL, messages, timeoutMs);
}
