import { streamOpenAICompatibleChat, completeOpenAICompatibleChat } from "./openaiCompatible";
import type { GenParams } from "./index";

const BASE_URL = "https://integrate.api.nvidia.com/v1";
const MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct";

export function isNvidiaConfigured() {
  return Boolean(process.env.NVIDIA_API_KEY);
}

/**
 * Same idea as getSambanovaKeys()/getGroqKeys() — additional keys
 * (NVIDIA_API_KEY_2, NVIDIA_API_KEY_3) are optional, ideally from
 * separate accounts/signups since free-tier limits are enforced per
 * account, not per key. Leave any unset to just use the keys you have;
 * unused slots are then simply left out of the chain.
 *
 * Returns each configured key tagged with its original 1-based slot number
 * (1 for NVIDIA_API_KEY, 2 for NVIDIA_API_KEY_2, 3 for NVIDIA_API_KEY_3),
 * not its position in this filtered array — otherwise, if only
 * NVIDIA_API_KEY_3 is set, that key would end up at array index 0 and get
 * labeled "NVIDIA #1" even though it's really the third key.
 */
export function getNvidiaKeys(): { key: string; slot: number }[] {
  return [process.env.NVIDIA_API_KEY, process.env.NVIDIA_API_KEY_2, process.env.NVIDIA_API_KEY_3]
    .map((key, i) => ({ key, slot: i + 1 }))
    .filter((entry): entry is { key: string; slot: number } => Boolean(entry.key));
}

function genParamsExtraBody(params?: GenParams): Record<string, unknown> | undefined {
  const body: Record<string, unknown> = {};
  if (params?.temperature !== undefined) body.temperature = params.temperature;
  if (params?.topP !== undefined) body.top_p = params.topP;
  return Object.keys(body).length ? body : undefined;
}

export async function streamNvidiaChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  onToken: (chunk: string) => void,
  apiKey: string,
  timeoutMs: number,
  clientSignal?: AbortSignal,
  params?: GenParams
): Promise<string> {
  return streamOpenAICompatibleChat(BASE_URL, apiKey, MODEL, messages, onToken, timeoutMs, clientSignal, genParamsExtraBody(params));
}

export async function completeNvidiaChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  apiKey: string,
  timeoutMs: number,
  params?: GenParams
): Promise<string> {
  return completeOpenAICompatibleChat(BASE_URL, apiKey, MODEL, messages, timeoutMs, genParamsExtraBody(params));
}
