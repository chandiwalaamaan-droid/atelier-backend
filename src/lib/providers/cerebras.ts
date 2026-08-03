import { streamOpenAICompatibleChat, completeOpenAICompatibleChat } from "./openaiCompatible";
import type { GenParams } from "./index";

const BASE_URL = "https://api.cerebras.ai/v1";
const MODEL = process.env.CEREBRAS_MODEL || "gpt-oss-120b";

export function isCerebrasConfigured() {
  return Boolean(process.env.CEREBRAS_API_KEY);
}

export function getCerebrasKeys(): { key: string; slot: number }[] {
  return [process.env.CEREBRAS_API_KEY, process.env.CEREBRAS_API_KEY_2]
    .map((key, i) => ({ key, slot: i + 1 }))
    .filter((entry): entry is { key: string; slot: number } => Boolean(entry.key));
}

function genParamsExtraBody(params?: GenParams): Record<string, unknown> | undefined {
  const body: Record<string, unknown> = {};
  if (params?.temperature !== undefined) body.temperature = params.temperature;
  if (params?.topP !== undefined) body.top_p = params.topP;
  return Object.keys(body).length ? body : undefined;
}

export async function streamCerebrasChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  onToken: (chunk: string) => void,
  apiKey: string,
  timeoutMs: number,
  clientSignal?: AbortSignal,
  params?: GenParams
): Promise<string> {
  return streamOpenAICompatibleChat(BASE_URL, apiKey, MODEL, messages, onToken, timeoutMs, clientSignal, genParamsExtraBody(params));
}

export async function completeCerebrasChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  apiKey: string,
  timeoutMs: number,
  params?: GenParams
): Promise<string> {
  return completeOpenAICompatibleChat(BASE_URL, apiKey, MODEL, messages, timeoutMs, genParamsExtraBody(params));
}
