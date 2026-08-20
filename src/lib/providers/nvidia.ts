import { streamOpenAICompatibleChat, completeOpenAICompatibleChat } from "./openaiCompatible";
import type { GenParams } from "./index";

const BASE_URL = "https://integrate.api.nvidia.com/v1";
// User explicitly deprioritized uncensored-ness for this pick in favor of
// speed + intelligence, which reopens NVIDIA's own Nemotron line (earlier
// ruled out for llama-3.1-nemotron-nano-8b-v1 specifically because
// NVIDIA's RLHF pass reintroduces refusal behavior — noted below, still
// true, just no longer disqualifying given the new priority).
//
// Current default: nvidia/nemotron-nano-12b-v2-vl — 12B hybrid
// Mamba-Transformer reasoning model, confirmed Free Endpoint on NVIDIA's
// catalog (unlike nemotron-3-nano-30b-a3b / nemotron-3-super-120b-a12b,
// which list as Downloadable-only despite third-party trackers like
// OpenRouter showing them as "free" — that's a different host, not
// integrate.api.nvidia.com). Sits well under the 49B/70B latency-risk
// zone while scoring meaningfully higher than the 8B on reasoning
// benchmarks. Vision-capable but works fine text-only for this app's
// purposes.
//
// Its reasoning toggle is NOT chat_template_kwargs like DeepSeek's — it's
// a literal "/think" or "/no_think" token NVIDIA expects inside a system
// message (see withReasoningToggle() below). Off by default, same
// rationale as every other reasoning model here: short conversational
// roleplay turns don't benefit from the added latency, and thinking
// tokens would eat into the visible-reply token budget.
//
// If this doesn't hold up, llama-3.1-nemotron-nano-4b-v1.1 (Free
// Endpoint, same family, smaller/faster/lower ceiling) is the next thing
// to try before falling back to the verified-safe meta/llama-3.1-8b-
// instruct below.
//
// Everything tried and failed before landing here, so don't re-attempt
// any of these blind:
//   - meta/llama-4-scout-17b-16e-instruct: 404 "Not Found for account" —
//     NVIDIA's own forums confirm this is a known issue, other users hit
//     the identical error with the identical (correct) model string. This
//     is NVIDIA gating the model at the account level, not a naming bug —
//     nothing to fix on our side.
//   - meta/llama-4-maverick-17b-128e-instruct: 410 Gone — NVIDIA EOL'd it
//     2026-07-27. Both Llama 4 MoE options (Scout and Maverick) are dead
//     now: one gated, one retired.
//   - meta/llama-3.3-70b-instruct: technically works, but consistently
//     missed the 6s NVIDIA_TIMEOUT_MS window under free-tier load (18-45s
//     per-message delays, every request paying 1-3 full timeouts before
//     falling over to Groq). Also NVIDIA-scheduled for deprecation
//     2026-08-25 regardless.
//   - deepseek-ai/deepseek-v4-flash: worked briefly, then NVIDIA EOL'd it
//     2026-08-07 (410 Gone) — ~3.5 months after release.
//   - deepseek-ai/deepseek-v3_2: failed in production for this
//     account/region despite being NVIDIA's then-current listed flagship
//     on the Free Endpoint — root cause not fully isolated.
//   - deepseek-ai/deepseek-v3_1 / deepseek-v3.1-terminus: same story.
//   - meta/llama-3.1-8b-instruct: the one model that's actually held up —
//     kept as the documented fallback, not because it's the best, but
//     because it's the most verified.
//   - nvidia/llama-3.1-nemotron-nano-8b-v1: NVIDIA's RLHF alignment pass
//     reintroduces refusal behavior (a published "abliterated" fork of it
//     exists specifically to strip that back out) — only ruled out for
//     uncensored use cases, not for general capability.
//   - Net effect: this free tier's catalog listings don't reliably
//     reflect what's actually callable for a given account. Prefer
//     verified-working models over "current flagship" ones going
//     forward, and expect to re-verify after any swap.
//
// MODEL swaps happen via Render's env vars, not by re-deploying this
// file: set NVIDIA_MODEL in the Render dashboard (Environment tab) and
// redeploy — no zip re-upload needed. The string below is only the
// fallback used when NVIDIA_MODEL isn't set at all.
const MODEL = process.env.NVIDIA_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b";

// See MODEL comment above — Nemotron Nano's reasoning toggle is a literal
// token inside a system message, not a request-body field, and only
// applies to that model family. Gated on the MODEL string so switching
// NVIDIA_MODEL to something else (DeepSeek, Llama, ...) via Render env
// doesn't inject a meaningless "/no_think" into an unrelated model's
// system prompt.
function withReasoningToggle(
  messages: { role: "system" | "user" | "assistant"; content: string }[]
): { role: "system" | "user" | "assistant"; content: string }[] {
  if (!MODEL.startsWith("nvidia/nemotron-nano")) return messages;
  const marker = "/no_think";
  const [first, ...rest] = messages;
  if (first?.role === "system") {
    return [{ ...first, content: `${marker}\n${first.content}` }, ...rest];
  }
  return [{ role: "system", content: marker }, ...messages];
}

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

// The old nemotron-nano-12b-v2-vl used a literal "/no_think" system-message
// token (see withReasoningToggle above). The current Nemotron 3 generation
// (nano-30b-a3b, super-120b-a12b, ultra-550b-a55b, nemotron-3.5-lightning,
// nemotron-3-nano-omni, etc.) uses a different, request-body-level switch
// instead: chat_template_kwargs.enable_thinking. Without this explicitly
// set to false, these models run full hidden chain-of-thought on every
// request — normally invisible (stripped by the <think> filter in
// openaiCompatible.ts), but NOT free: on borderline/ambiguous input the
// model can spend several extra seconds deliberating before the visible
// reply even starts, which is enough to blow through NVIDIA_TIMEOUT_MS and
// look like a random/content-dependent failure even though the model
// would have answered fine given more time. force_nonempty_content is a
// second belt-and-braces flag some Nemotron 3 endpoints respect, to stop
// a request that's ALL thinking budget from coming back with a
// technically-200-but-empty completion.
//
// Matches any nvidia/nemotron-3* or nvidia/nemotron-nano-3* model string,
// which covers every current Nemotron 3-generation chat model without
// having to hardcode each one by name as NVIDIA adds/retires them.
const IS_NEMOTRON_3_FAMILY = /^nvidia\/nemotron-(3|nano-3|3\.5)/.test(MODEL);

function genParamsExtraBody(params?: GenParams): Record<string, unknown> | undefined {
  const body: Record<string, unknown> = {};
  if (params?.temperature !== undefined) body.temperature = params.temperature;
  if (params?.topP !== undefined) body.top_p = params.topP;
  if (IS_NEMOTRON_3_FAMILY) {
    body.chat_template_kwargs = { enable_thinking: false, force_nonempty_content: true };
  }
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
  return streamOpenAICompatibleChat(BASE_URL, apiKey, MODEL, withReasoningToggle(messages), onToken, timeoutMs, clientSignal, genParamsExtraBody(params));
}

export async function completeNvidiaChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  apiKey: string,
  timeoutMs: number,
  params?: GenParams
): Promise<string> {
  return completeOpenAICompatibleChat(BASE_URL, apiKey, MODEL, withReasoningToggle(messages), timeoutMs, genParamsExtraBody(params));
}
