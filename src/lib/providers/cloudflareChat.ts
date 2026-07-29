import { streamOpenAICompatibleChat, completeOpenAICompatibleChat } from "./openaiCompatible";

// Cloudflare Workers AI — TEXT chat, via their OpenAI-compatible endpoint
// (https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1). This
// is a separate account/token from the one in cloudflare.ts, which is only
// used for image generation (avatar.ts) — keep them on distinct env vars
// so swapping one doesn't touch the other.
//
// Model defaults to Llama 4 Scout: Cloudflare's own docs point new/migrating
// users at this one (see the 2026-05-08 deprecation notice, which retired a
// pile of older Llama 3.x / Mistral / Gemma models and recommended Llama 4
// or gpt-oss as the replacement). Going with Llama 4 over gpt-oss here on
// purpose — gpt-oss has refusals baked in deep (same reasoning documented
// in providers/index.ts for why Groq's GROQ_MODEL avoids it), while Llama 4
// is the same raw, lightly-tuned Llama family the rest of this fallback
// chain already relies on for explicit-mode permissiveness.
//
// THIS PROVIDER IS UNVERIFIED for explicit-mode content specifically.
// Cloudflare's docs don't clearly state whether any default-on moderation
// applies to raw /ai/run or /ai/v1 chat calls (as opposed to the opt-in
// Guardrails/Firewall-for-AI product, which is off unless you turn it on
// in the dashboard). Test with a real explicit-mode prompt before trusting
// this in the primary rotation for real traffic.
const DEFAULT_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const MODEL = process.env.CLOUDFLARE_CHAT_MODEL || DEFAULT_MODEL;

function baseUrl(): string {
  const accountId = process.env.CLOUDFLARE_CHAT_ACCOUNT_ID;
  if (!accountId) throw new Error("CLOUDFLARE_CHAT_ACCOUNT_ID not set");
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
}

export function isCloudflareChatConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_CHAT_ACCOUNT_ID && process.env.CLOUDFLARE_CHAT_API_TOKEN);
}

export async function streamCloudflareChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  onToken: (chunk: string) => void,
  apiKey: string,
  timeoutMs: number,
  clientSignal?: AbortSignal
): Promise<string> {
  return streamOpenAICompatibleChat(baseUrl(), apiKey, MODEL, messages, onToken, timeoutMs, clientSignal);
}

export async function completeCloudflareChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  apiKey: string,
  timeoutMs: number
): Promise<string> {
  return completeOpenAICompatibleChat(baseUrl(), apiKey, MODEL, messages, timeoutMs);
}
