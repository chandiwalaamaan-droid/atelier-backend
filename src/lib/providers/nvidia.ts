import { streamOpenAICompatibleChat, completeOpenAICompatibleChat } from "./openaiCompatible";

const BASE_URL = "https://integrate.api.nvidia.com/v1";
const MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.1-70b-instruct";

export function isNvidiaConfigured() {
  return Boolean(process.env.NVIDIA_API_KEY);
}

/** Same idea as getGroqKeys() — second slot is optional. See groq.ts. */
export function getNvidiaKeys(): string[] {
  return [process.env.NVIDIA_API_KEY, process.env.NVIDIA_API_KEY_2].filter(
    (k): k is string => Boolean(k)
  );
}

export async function streamNvidiaChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  onToken: (chunk: string) => void,
  apiKey: string,
  timeoutMs: number
): Promise<string> {
  return streamOpenAICompatibleChat(BASE_URL, apiKey, MODEL, messages, onToken, timeoutMs);
}

export async function completeNvidiaChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  apiKey: string,
  timeoutMs: number
): Promise<string> {
  return completeOpenAICompatibleChat(BASE_URL, apiKey, MODEL, messages, timeoutMs);
}
