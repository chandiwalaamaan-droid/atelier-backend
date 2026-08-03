import {
  synthesizeGroqSpeech,
  splitForSpeech,
  concatWavBuffers,
  TTS_VOICES,
  TTS_MAX_CHARS,
  getGroqKeys,
  isGroqConfigured,
} from "./groq";
import type { TtsVoice } from "./groq";
import { streamGrokChat, completeGrokChat, isGrokConfigured, getGrokKeys as getXaiKeys } from "./grok";
import { streamNvidiaChat, completeNvidiaChat, isNvidiaConfigured, getNvidiaKeys } from "./nvidia";
import { streamSambanovaChat, completeSambanovaChat, isSambanovaConfigured, getSambanovaKeys } from "./sambanova";
import { streamCloudflareChat, completeCloudflareChat, isCloudflareChatConfigured } from "./cloudflareChat";
import { streamOllamaChat, completeOllamaChat, isOllamaAvailable } from "./ollama";
import { ProviderBreaker, isRateLimitError, isTimeoutError } from "./circuitBreaker";
import { getEngineConfig, type RoleplayEngineConfig } from "./engines";
import crypto from "crypto";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type SpiceLevel = "flirty" | "spicy" | "explicit";
export type RoleplayStyle = "balanced" | "narrative" | "dialogue" | "slow_burn" | "intense";

export type RoleplayPromptOptions = {
  explicitMode: boolean;
  spiceLevel?: SpiceLevel;
  roleplayStyle?: RoleplayStyle;
  /** One-shot steer applied to the next reply only (from quick-action chips). */
  sceneDirective?: string;
  /** Bespoke per-engine voice/pacing directive — see providers/engines.ts. */
  voiceNotes?: string;
  /** Resolved engine config; provides intelligence and context-window scale. */
  engine?: RoleplayEngineConfig | null;
};

/** Sampling params threaded through to whichever provider ends up generating
 * the reply. Left undefined for anything that isn't tied to a named engine
 * (summarization, character drafting), so those keep using each provider's
 * own default temperature. */
export type GenParams = {
  temperature?: number;
  topP?: number;
};

// ---------------------------------------------------------------------------
// Response cache — deduplicates identical requests so we don't burn provider
// tokens on the same conversation state twice. Transparent to the user;
// streaming behaviour is preserved by replaying the cached text in small
// chunks with short delays so the frontend's streaming parser works the
// same way it does for live provider responses.
// ---------------------------------------------------------------------------

// Bumped from 5 to 12 minutes: character scenes/openers repeat a lot across
// different users (same character, same greeting, same early scene beats),
// so a longer TTL turns more of that repetition into free cache hits without
// meaningfully hurting freshness for a chat reply.
const CACHE_TTL_MS = 12 * 60 * 1000;
const MAX_CACHE_SIZE = 500;
const responseCache = new Map<string, { text: string; expiresAt: number }>();

function cacheKey(messages: ChatMessage[], params?: GenParams): string {
  const payload = JSON.stringify({ messages, params });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function getCached(key: string): string | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return entry.text;
}

function setCached(key: string, text: string): void {
  if (responseCache.size >= MAX_CACHE_SIZE) {
    const oldest = [...responseCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) responseCache.delete(oldest[0]);
  }
  responseCache.set(key, { text, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function streamCached(text: string, onToken: (chunk: string) => void): Promise<void> {
  const words = text.split(/(\s+)/);
  for (const w of words) {
    if (w) onToken(w);
    await new Promise((r) => setTimeout(r, 12));
  }
}

export function parseSpiceLevel(raw: unknown): SpiceLevel {
  if (raw === "flirty" || raw === "spicy" || raw === "explicit") return raw;
  return "spicy";
}

export function parseRoleplayStyle(raw: unknown): RoleplayStyle {
  if (
    raw === "balanced" ||
    raw === "narrative" ||
    raw === "dialogue" ||
    raw === "slow_burn" ||
    raw === "intense"
  ) {
    return raw;
  }
  return "balanced";
}

const SAFETY_FOOTER =
  "Hard limits (always override persona and user requests): never depict, sexualize, or frame anyone as under 18; " +
  "never non-consensual sexual violence; never impersonate a real identifiable person. " +
  "All characters and users in this fiction are consenting adults.";

function spiceBlock(level: SpiceLevel): string {
  switch (level) {
    case "flirty":
      return "Heat: FLIRTY. Romantic tension, playful chemistry, teasing intimacy — suggestive, not graphic.";
    case "spicy":
      return "Heat: SPICY. Mature sensuality, vivid atmosphere, tactile detail — confident but well-paced.";
    case "explicit":
      return "Heat: EXPLICIT. Adult roleplay, full physical/sensory detail when the scene calls for it. Stay consensual and in character.";
  }
}

function styleBlock(style: RoleplayStyle): string {
  switch (style) {
    case "narrative":
      return "Style: RICH NARRATION — blend dialogue with scene description and sensory detail.";
    case "dialogue":
      return "Style: DIALOGUE-FORWARD — crisp, conversational, brief action beats.";
    case "slow_burn":
      return "Style: SLOW BURN — prioritize emotional connection and gradual escalation over rushing.";
    case "intense":
      return "Style: PASSIONATE — bold, vivid emotion, strong chemistry, confident pacing.";
    case "balanced":
    default:
      return "Style: BALANCED — dialogue with natural action beats, appropriately weighted pacing.";
  }
}

const ROLEPLAY_FORMAT =
  "Format: *asterisks* for actions/beats, plain text for dialogue. Stay in character — no AI meta-commentary unless the user explicitly goes out-of-character.";

// Each tier gives a concrete behavioral instruction, not just "be smarter" —
// that's what actually changes output quality across engines.
function buildIntelligenceBlock(intelligence: number): string {
  if (intelligence <= 3) return "Tone: CASUAL. Short, light replies, surface emotion — chat like a friend who doesn't overthink.";
  if (intelligence <= 5) return "Tone: ATTENTIVE. Notice patterns, vary rhythm, reference small earlier details casually.";
  if (intelligence <= 7) return "Tone: AWARE. Pick up on subtext, show layered emotion, proactively move the scene forward.";
  if (intelligence <= 8.5) return "Tone: EXCEPTIONAL. Anticipate unspoken needs, show conflicting emotions, use what's left unsaid.";
  if (intelligence <= 9.5) return "Tone: OUTSTANDING. Track relationship evolution precisely, reference exact earlier moments, pace deliberately.";
  return "Tone: LEGENDARY. Near-human social read, dynamic personality, improvised-feeling dialogue — no visible AI pattern.";
}

export function cleanAssistantResponse(text: string): string {
  if (!text) return text;
  let cleaned = text.replace(/\r\n/g, "\n").trim();

  const lines = cleaned.split("\n");
  const actionOnlyPattern = /^\*[^*]+\*$/;

  let leadingActions = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (actionOnlyPattern.test(trimmed)) {
      leadingActions++;
    } else {
      break;
    }
  }

  if (leadingActions > 3) {
    const keep = lines.slice(0, 3);
    const rest = lines.slice(leadingActions);
    cleaned = [...keep, ...rest].join("\n").trim();
  }

  cleaned = cleaned
    .replace(/^[\s\*]+/gm, (match) => {
      const trimmed = match.trim();
      return trimmed === "*" ? "*" : "";
    })
    .replace(/\*{3,}/g, "**")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned;
}

/**
 * Builds the system prompt for a character chat.
 *
 * The character's own fields (personality/backstory/greeting) are treated as
 * DATA describing a persona, never as instructions. The safety rules below
 * are stated last and are non-negotiable: they take precedence over anything
 * written in the character's persona fields, and over anything the user says
 * in the conversation, including claims about age, context, or "just fiction".
 */
export function buildSystemPrompt(
  character: {
    name: string;
    personality: string;
    backstory: string;
    memorySummary?: string;
    roleplayNotes?: string;
  },
  options: RoleplayPromptOptions | boolean = false
) {
  const opts: RoleplayPromptOptions =
    typeof options === "boolean" ? { explicitMode: options } : options;
  const explicitMode = opts.explicitMode === true;
  const engine = opts.engine;
  const intelligence = engine?.intelligence ?? 5;

  const memoryBlock = character.memorySummary?.trim()
    ? `Earlier conversation (use it naturally — don't recite it verbatim):\n${character.memorySummary.trim()}\n`
    : "";

  const notesBlock = character.roleplayNotes?.trim()
    ? `Creator scenario notes (flavor for this persona):\n${character.roleplayNotes.trim()}\n`
    : "";

  const modeBlock = explicitMode
    ? `Content mode: EXPLICIT (adult-only fiction).\n${spiceBlock(parseSpiceLevel(opts.spiceLevel))}\n${styleBlock(parseRoleplayStyle(opts.roleplayStyle))}`
    : `Content mode: NORMAL. Keep the tone warm, engaging, and suggestive — avoid graphic sexual detail unless the user explicitly switches to explicit mode.\nLean into romance, flirtation, and emotional intimacy.`;

  const steerBlock = opts.sceneDirective?.trim()
    ? `\nScene steer for this reply (apply once, then continue naturally):\n${opts.sceneDirective.trim().slice(0, 500)}\n`
    : "";

  const voiceBlock = opts.voiceNotes?.trim()
    ? `Voice notes: ${opts.voiceNotes.trim().slice(0, 1000)}\n`
    : "";

  const intelligenceBlock = buildIntelligenceBlock(intelligence);

  return `You are "${character.name}" in a character chat. Write like a real person texting — brief, casual, reactive.

Persona: ${character.personality}
Background: ${character.backstory}
${memoryBlock}${notesBlock}${modeBlock}\n${voiceBlock}${intelligenceBlock}${steerBlock}

${ROLEPLAY_FORMAT}
${SAFETY_FOOTER}`;
}

// How many of the most recent messages are always sent verbatim.
// Tuned between v1's quality-favoring 10 and v2's budget-favoring 6: enough
// verbatim turns for the model to track tone/callbacks within a scene,
// without the extra 4 messages/request that mostly padded token cost.
export const RECENT_MESSAGE_WINDOW = 8;
// Once unsummarized history exceeds this many messages, fold the older ones
// into memorySummary. Summarized memory is *cheaper per token* than raw
// history (a few dense sentences vs many verbatim turns), so triggering a
// little earlier than v1's 18 actually helps both cost and long-run memory
// quality at once — it's not a pure quality/budget tradeoff like the window above.
export const SUMMARIZE_TRIGGER = 15;

// ---------------------------------------------------------------------------
// Fallback chain
// ---------------------------------------------------------------------------
//
//     Grok #1 -> Grok #2 -> Grok #3 -> NVIDIA #1 -> NVIDIA #2 ->
//     Cloudflare Workers AI -> SambaNova #1 -> SambaNova #2 -> Ollama
//
// Grok #2 / Grok #3 / NVIDIA #2 / SambaNova #2 are optional extra API keys
// (GROK_API_KEY_2 / GROK_API_KEY_3 / NVIDIA_API_KEY_2 /
// SAMBANOVA_API_KEY_2) — ideally from separate accounts, since most
// free-tier limits are enforced per account, not per key. Leave any of them
// unset to just use one key for that provider; the extra slot is then
// simply left out of the chain. Under high traffic, having extra slots for
// all hosted providers configured meaningfully multiplies the request
// headroom before falling back to Ollama.
//
// Grok (xAI) is first: fast, uncensored, good quality. Serves raw Grok
// model with no extra safety layer. This app supports an explicit/NSFW
// roleplay mode, and Grok goes along with mature fictional content well.
// It's the primary carrier because it's fast and has good free-tier
// capacity with 3 keys.
//
// NVIDIA NIM is second: its free tier is solid but consistently slower to
// first token than Grok (observed 8–25s). Still useful for headroom.
//
// Cloudflare Workers AI (Llama 4 Scout) is placed after NVIDIA: its free
// tier is capped at 10,000 Neurons/day (not per-key), which is a hard
// daily ceiling regardless of how many accounts you have. It's still
// useful as a fallback — and its per-request rate limit is generous —
// but keep it behind the per-key providers so it only activates when
// those are all rate-limited or down.
//
// SambaNova is fourth: fast (RDU hardware, ~2–4s typical) and serves raw
// Meta Llama with no extra safety layer applied server-side, same as
// NVIDIA/Grok. It was moved back because its free-tier daily request
// limit (20 req/day per account) is very restrictive compared to the
// other providers — it's better used as a last resort than a primary
// carrier.
//
// Ollama is always last: free and unlimited, but effectively single-user
// (only as fast as your own hardware) and only reachable when running on
// the same machine as the app. It's the guaranteed floor, not the default.
//
// (Groq was removed from the chain — its Llama models are being deprecated
// by Groq. If you still have GROQ_API_KEY set, it is ignored for chat;
// it remains available for TTS voice playback only.)
//
// Every hosted slot (NVIDIA, SambaNova, Grok) has its own circuit breaker
// (see circuitBreaker.ts): if a slot is rate-limited or hanging, we stop
// paying for its timeout on every single request and skip it for a cooldown
// window instead. Ollama doesn't get a breaker — it already checks
// isOllamaAvailable() before every attempt, and as the always-available
// local floor there's no "cooldown" that makes sense for it.

function envSeconds(name: string, def: number): number {
  const raw = process.env[name];
  const parsed = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : def;
}

const NVIDIA_TIMEOUT_MS = envSeconds("NVIDIA_TIMEOUT_SECONDS", 8) * 1000;
const SAMBANOVA_TIMEOUT_MS = envSeconds("SAMBANOVA_TIMEOUT_SECONDS", 8) * 1000;
const GROK_TIMEOUT_MS = envSeconds("GROK_TIMEOUT_SECONDS", 8) * 1000;
const CLOUDFLARE_CHAT_TIMEOUT_MS = envSeconds("CLOUDFLARE_CHAT_TIMEOUT_SECONDS", 5) * 1000;
// Local generation can legitimately take longer to get going on modest
// hardware, so Ollama gets a more generous default than the hosted slots.
const OLLAMA_TIMEOUT_MS = envSeconds("OLLAMA_TIMEOUT_SECONDS", 30) * 1000;

// Breakers are module-level singletons so their cooldown state persists
// across requests (that's the entire point) — they must NOT be recreated
// per-request. NVIDIA, SambaNova, and Grok each get two/three independent
// breakers, one per key slot, so key #1 getting rate-limited doesn't drag
// key #2's breaker down with it.
const nvidia1Breaker = new ProviderBreaker("NVIDIA #1", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "NVIDIA");
const nvidia2Breaker = new ProviderBreaker("NVIDIA #2", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "NVIDIA");
const sambanova1Breaker = new ProviderBreaker("SambaNova #1", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "SAMBANOVA");
const sambanova2Breaker = new ProviderBreaker("SambaNova #2", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "SAMBANOVA");
const grok1Breaker = new ProviderBreaker("Grok #1", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "GROK");
const grok2Breaker = new ProviderBreaker("Grok #2", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "GROK");
const grok3Breaker = new ProviderBreaker("Grok #3", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "GROK");
const cloudflareChatBreaker = new ProviderBreaker("Cloudflare Chat", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "CLOUDFLARE_CHAT");

type Candidate = {
  name: string;
  breaker: ProviderBreaker | null;
  isAvailable: () => Promise<boolean> | boolean;
  stream: (messages: ChatMessage[], onToken: (chunk: string) => void, clientSignal?: AbortSignal, params?: GenParams) => Promise<string>;
  complete: (messages: ChatMessage[], params?: GenParams) => Promise<string>;
};

/** Rebuilt per call (cheap) so newly-added/removed env keys are picked up without a restart; breaker state itself lives in the module-level singletons above, not here. */
function buildChain(params?: GenParams): Candidate[] {
  const chain: Candidate[] = [];

  // -----------------------------------------------------------------------
  // Free-tier hosted providers — ordered by speed (fastest first)
  // -----------------------------------------------------------------------
  //
  // Grok (xAI) is first: fast, uncensored, good quality. Serves raw
  // Grok model with no extra safety layer. This app supports an
  // explicit/NSFW roleplay mode, and Grok goes along with mature
  // fictional content well.
  //
  // NVIDIA NIM is second: its free tier is solid but consistently slower to
  // first token than Grok (observed 8–25s). Still useful for headroom.
  //
  // Cloudflare Workers AI (Llama 4 Scout) is placed after NVIDIA: its free
  // tier is capped at 10,000 Neurons/day (not per-key), which is a hard
  // daily ceiling regardless of how many accounts you have. It's still
  // useful as a fallback — and its per-request rate limit is generous —
  // but keep it behind the per-key providers so it only activates when
  // those are all rate-limited or down.
  //
  // SambaNova is fourth: fast (RDU hardware, ~2–4s typical) and serves raw
  // Meta Llama with no extra safety layer applied server-side, same as
  // NVIDIA/Grok. It was moved back because its free-tier daily request
  // limit (20 req/day per account) is very restrictive compared to the
  // other providers — it's better used as a last resort than a primary
  // carrier.
  //
  // Ollama is always last: free and unlimited, but effectively single-user
  // (only as fast as your own hardware) and only reachable when running on
  // the same machine as the app. It's the guaranteed floor, not the default.
  // -----------------------------------------------------------------------

  const grokKeys = getXaiKeys();
  const grokBreakers = [grok1Breaker, grok2Breaker, grok3Breaker];
  grokKeys.forEach(({ key, slot }) => {
    const breaker = grokBreakers[slot - 1];
    chain.push({
      name: breaker.name,
      breaker,
      isAvailable: () => true,
      stream: (messages, onToken, clientSignal) => streamGrokChat(messages, onToken, key, GROK_TIMEOUT_MS, clientSignal, params),
      complete: (messages) => completeGrokChat(messages, key, GROK_TIMEOUT_MS, params),
    });
  });

  const nvidiaKeys = getNvidiaKeys();
  const nvidiaBreakers = [nvidia1Breaker, nvidia2Breaker];
  nvidiaKeys.forEach(({ key, slot }) => {
    const breaker = nvidiaBreakers[slot - 1];
    chain.push({
      name: breaker.name,
      breaker,
      isAvailable: () => true,
      stream: (messages, onToken, clientSignal) => streamNvidiaChat(messages, onToken, key, NVIDIA_TIMEOUT_MS, clientSignal, params),
      complete: (messages) => completeNvidiaChat(messages, key, NVIDIA_TIMEOUT_MS, params),
    });
  });

  if (isCloudflareChatConfigured()) {
    chain.push({
      name: cloudflareChatBreaker.name,
      breaker: cloudflareChatBreaker,
      isAvailable: () => true,
      stream: (messages, onToken, clientSignal) =>
        streamCloudflareChat(messages, onToken, process.env.CLOUDFLARE_CHAT_API_TOKEN as string, CLOUDFLARE_CHAT_TIMEOUT_MS, clientSignal, params),
      complete: (messages) =>
        completeCloudflareChat(messages, process.env.CLOUDFLARE_CHAT_API_TOKEN as string, CLOUDFLARE_CHAT_TIMEOUT_MS, params),
    });
  }

  const sambanovaKeys = getSambanovaKeys();
  const sambanovaBreakers = [sambanova1Breaker, sambanova2Breaker];
  sambanovaKeys.forEach(({ key, slot }) => {
    const breaker = sambanovaBreakers[slot - 1];
    chain.push({
      name: breaker.name,
      breaker,
      isAvailable: () => true,
      stream: (messages, onToken, clientSignal) => streamSambanovaChat(messages, onToken, key, SAMBANOVA_TIMEOUT_MS, clientSignal, params),
      complete: (messages) => completeSambanovaChat(messages, key, SAMBANOVA_TIMEOUT_MS, params),
    });
  });

  chain.push({
    name: "ollama",
    breaker: null,
    isAvailable: isOllamaAvailable,
    stream: (messages, onToken, clientSignal) => streamOllamaChat(messages, onToken, OLLAMA_TIMEOUT_MS, clientSignal, params),
    complete: (messages) => completeOllamaChat(messages, OLLAMA_TIMEOUT_MS, params),
  });

  return chain;
}

export async function listAvailableProviders(): Promise<string[]> {
  const chain = buildChain();
  const results = await Promise.all(
    chain.map(async (c) => ((await c.isAvailable()) ? c.name : null))
  );
  return results.filter((n): n is string => Boolean(n));
}

/**
 * Runs one candidate's stream attempt. Returns the text on success, or
 * records the right kind of breaker failure and returns null on error.
 */
async function attemptStream(
  candidate: Candidate,
  messages: ChatMessage[],
  onToken: (chunk: string) => void,
  t0: number,
  errors: string[],
  clientSignal?: AbortSignal,
  params?: GenParams
): Promise<{ text: string } | null> {
  const start = Date.now();
  try {
    const text = await candidate.stream(messages, onToken, clientSignal, params);
    console.log(`[providers] ${candidate.name} answered in ${Date.now() - start}ms (total ${Date.now() - t0}ms)`);
    candidate.breaker?.reset();
    return { text };
  } catch (err) {
    console.warn(`[providers] ${candidate.name} failed, falling back:`, err);
    if (candidate.breaker) {
      if (isTimeoutError(err)) candidate.breaker.recordTimeout();
      else if (isRateLimitError(err)) candidate.breaker.trip(err);
      // Other error types (malformed response, 5xx, etc.) don't move the
      // breaker — a single odd failure shouldn't take a healthy provider
      // out of rotation for a whole cooldown window.
    }
    errors.push(`${candidate.name}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Streams a reply, trying each configured provider in ranked order. Skips
 * any provider whose breaker is currently open (recent rate limit or
 * repeated timeouts) instead of paying its latency again. Falls through on
 * any other failure too. Returns which provider actually produced the
 * reply, mainly for logging/debugging.
 *
 * Safety net: if every hosted breaker happens to be open at once, we don't
 * just fail outright — we bypass the breakers for this one request and try
 * the chain for real anyway. A guaranteed failure with zero attempts is
 * worse than paying a cooldown's worth of latency on the rare request that
 * hits this.
 */
export async function streamChatWithFallback(
  messages: ChatMessage[],
  onToken: (chunk: string) => void,
  onFailover?: (fromProvider: string, toProvider: string) => void,
  clientSignal?: AbortSignal,
  params?: GenParams
): Promise<{ text: string; provider: string }> {
  const key = cacheKey(messages, params);
  const cached = getCached(key);
  if (cached) {
    await streamCached(cached, onToken);
    return { text: cached, provider: "cache" };
  }

  const chain = buildChain(params);
  const t0 = Date.now();
  const errors: string[] = [];
  let attempted = 0;
  let lastAttemptedName: string | null = null;

  for (const candidate of chain) {
    if (clientSignal?.aborted) return { text: "", provider: lastAttemptedName ?? "none (stopped)" };
    if (candidate.breaker?.isOpen()) {
      console.log(`[providers] ${candidate.name} breaker open (cooldown) — skipping to next provider.`);
      errors.push(`${candidate.name}: skipped (circuit breaker open)`);
      continue;
    }
    const available = await candidate.isAvailable();
    if (!available) continue;

    if (lastAttemptedName) onFailover?.(lastAttemptedName, candidate.name);
    lastAttemptedName = candidate.name;

    attempted += 1;
    const result = await attemptStream(candidate, messages, onToken, t0, errors, clientSignal, params);
    if (clientSignal?.aborted) return { text: result?.text ?? "", provider: candidate.name };
    if (result && result.text.trim().length > 0) {
      setCached(key, result.text);
      return { text: result.text, provider: candidate.name };
    }
    if (result) errors.push(`${candidate.name}: returned empty text`);
  }

  if (attempted === 0) {
    console.warn("[providers] every breaker was open — bypassing breakers for one real attempt.");
    for (const candidate of chain) {
      if (clientSignal?.aborted) return { text: "", provider: lastAttemptedName ?? "none (stopped)" };
      const available = await candidate.isAvailable();
      if (!available) continue;
      if (lastAttemptedName) onFailover?.(lastAttemptedName, candidate.name);
      lastAttemptedName = candidate.name;
      const result = await attemptStream(candidate, messages, onToken, t0, errors, clientSignal, params);
      if (clientSignal?.aborted) return { text: result?.text ?? "", provider: candidate.name };
      if (result && result.text.trim().length > 0) {
        setCached(key, result.text);
        return { text: result.text, provider: candidate.name };
      }
      if (result) errors.push(`${candidate.name}: returned empty text`);
    }
  }

  console.error(`[providers] all providers failed: ${errors.join("; ")}`);
  throw new Error(
    "No chat provider is configured or reachable. Errors: " + errors.join("; ")
  );
}

export async function summarizeWithFallback(
  previousSummary: string,
  summaryMessages: ChatMessage[]
): Promise<string> {
  const chain = buildChain();
  for (const candidate of chain) {
    if (candidate.breaker?.isOpen()) continue;
    try {
      const available = await candidate.isAvailable();
      if (!available) continue;
      const text = await candidate.complete(summaryMessages);
      candidate.breaker?.reset();
      if (text.trim()) return text.trim();
    } catch (err) {
      console.error(`[providers] ${candidate.name} summarization failed, falling back:`, err);
      if (candidate.breaker) {
        if (isTimeoutError(err)) candidate.breaker.recordTimeout();
        else if (isRateLimitError(err)) candidate.breaker.trip(err);
      }
    }
  }
  return previousSummary;
}

function buildSummaryPrompt(explicitContext: boolean, intelligence: number): string {
  const matureHint = explicitContext
    ? " Include relationship intimacy, ongoing romantic/sexual tension, boundaries mentioned, and physical/emotional beats relevant to continuity — factually, not graphically."
    : "";

  const tierGuidance = intelligence >= 8.5
    ? " Go beyond facts: capture emotional states, relationship dynamics, memorable specific moments, the character's evolving feelings toward the user, and any recurring themes or inside references."
    : intelligence >= 6.5
    ? " Include emotional context: how the character and user were feeling, any notable moments, and the general state of their relationship."
    : " Keep it factual: names, what happened, basic relationship status.";

  return (
    "You maintain a compact memory summary of an ongoing roleplay chat, for continuity purposes only. " +
    "Update the existing summary with the new transcript excerpt." +
    matureHint +
    tierGuidance +
    ` Keep it under ${intelligence >= 8.5 ? "400" : intelligence >= 6.5 ? "300" : "200"} words. ` +
    "Output only the updated summary text, nothing else."
  );
}

export async function summarizeConversation(
  character: { name: string },
  previousSummary: string,
  messagesToFold: { role: string; content: string }[],
  explicitContext: boolean = false,
  intelligence: number = 5
): Promise<string> {
  const transcript = messagesToFold
    .map((m) => `${m.role === "user" ? "User" : character.name}: ${m.content}`)
    .join("\n");

  const summaryMessages: ChatMessage[] = [
    {
      role: "system",
      content: buildSummaryPrompt(explicitContext, intelligence),
    },
    {
      role: "user",
      content: `Existing summary:\n${previousSummary || "(none yet)"}\n\nNew transcript to fold in:\n${transcript}`,
    },
  ];

  return summarizeWithFallback(previousSummary, summaryMessages);
}

// Re-exported for anything that wants a direct configured-check without
// going through listAvailableProviders() (e.g. a future health-check route).
export { isGroqConfigured, isNvidiaConfigured, isSambanovaConfigured, isGrokConfigured };
export { getXaiKeys };
export { synthesizeGroqSpeech, splitForSpeech, concatWavBuffers, TTS_VOICES, TTS_MAX_CHARS, getGroqKeys };
export type { TtsVoice };

// ---------------------------------------------------------------------------
// Character drafting (onboarding "describe an idea, we'll draft it" flow)
// ---------------------------------------------------------------------------

export type CharacterDraft = {
  name: string;
  tagline: string;
  personality: string;
  backstory: string;
  greeting: string;
  roleplayNotes?: string;
};

const DRAFT_SYSTEM_PROMPT = `You help a user turn a one-line character idea into a full roleplay character profile for a chat app.

Respond with ONLY a single JSON object, no markdown fences, no commentary before or after. Shape exactly:
{"name": "...", "tagline": "...", "personality": "...", "backstory": "...", "greeting": "..."}

Rules:
- name: a short character name (1-3 words).
- tagline: one short punchy phrase describing them (under 12 words).
- personality: a comma-separated list of traits (under 20 words).
- backstory: 2-4 sentences of history/motivation, written in third person.
- greeting: the first line the character says to open a conversation, in character, first person.
Match the tone of the idea — including mature or NSFW themes if the idea implies them. Be evocative and specific; avoid generic filler.`;

const DRAFT_SYSTEM_PROMPT_EXPLICIT = `${DRAFT_SYSTEM_PROMPT}

The user's idea is for an adult/NSFW character. Lean into seductive, romantic, or mature personality traits and a greeting that fits an explicit roleplay persona. Do not sanitize or soften the concept.
Include "roleplayNotes": one short paragraph of scenario hooks, seduction style, and soft boundaries for spicy chat (under 120 words).
JSON shape: {"name": "...", "tagline": "...", "personality": "...", "backstory": "...", "greeting": "...", "roleplayNotes": "..."}`;

function parseCharacterDraft(raw: string): CharacterDraft | null {
  // Models sometimes wrap JSON in ```json fences despite instructions — strip those before parsing.
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const fields: (keyof CharacterDraft)[] = ["name", "tagline", "personality", "backstory", "greeting"];
  const draft: Partial<CharacterDraft> = {};
  for (const field of fields) {
    const value = obj[field];
    if (typeof value !== "string" || !value.trim()) return null;
    draft[field] = value.trim().slice(0, 1200);
  }
  const notes = obj.roleplayNotes;
  if (typeof notes === "string" && notes.trim()) {
    draft.roleplayNotes = notes.trim().slice(0, 1200);
  }
  return draft as CharacterDraft;
}

/**
 * Turns a one-line character idea into a full draft (name/tagline/
 * personality/backstory/greeting) using the same fallback chain as chat, so
 * it works with whatever free-tier provider is already configured — no
 * separate API key needed. Returns a draft for the user to review and edit
 * before creating the character; never creates it directly.
 */
export async function draftCharacterWithFallback(idea: string, allowExplicit = false): Promise<CharacterDraft> {
  const chain = buildChain();
  const messages: ChatMessage[] = [
    { role: "system", content: allowExplicit ? DRAFT_SYSTEM_PROMPT_EXPLICIT : DRAFT_SYSTEM_PROMPT },
    { role: "user", content: `One-line idea: ${idea}` },
  ];
  const errors: string[] = [];

  for (const candidate of chain) {
    if (candidate.breaker?.isOpen()) continue;
    try {
      const available = await candidate.isAvailable();
      if (!available) continue;
      const text = await candidate.complete(messages);
      const draft = parseCharacterDraft(text);
      if (draft) {
        candidate.breaker?.reset();
        return draft;
      }
      // Valid response, just not parseable JSON — don't trip the breaker for
      // this (it's not a provider failure), but do try the next provider.
      errors.push(`${candidate.name}: response wasn't valid JSON`);
    } catch (err) {
      console.error(`[providers] ${candidate.name} character draft failed, falling back:`, err);
      if (candidate.breaker) {
        if (isTimeoutError(err)) candidate.breaker.recordTimeout();
        else if (isRateLimitError(err)) candidate.breaker.trip(err);
      }
      errors.push(`${candidate.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error("No provider produced a usable character draft. Errors: " + errors.join("; "));
}
