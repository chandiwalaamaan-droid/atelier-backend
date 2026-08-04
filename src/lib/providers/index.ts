import {
  synthesizeGroqSpeech,
  splitForSpeech,
  concatWavBuffers,
  TTS_VOICES,
  TTS_MAX_CHARS,
  getGroqKeys,
  isGroqConfigured,
  streamGroqChat,
  completeGroqChat,
} from "./groq";
import type { TtsVoice } from "./groq";
import { streamNvidiaChat, completeNvidiaChat, isNvidiaConfigured, getNvidiaKeys } from "./nvidia";
import { streamSambanovaChat, completeSambanovaChat, isSambanovaConfigured, getSambanovaKeys } from "./sambanova";
import { streamCloudflareChat, completeCloudflareChat, isCloudflareChatConfigured } from "./cloudflareChat";
import { streamOllamaChat, completeOllamaChat, isOllamaAvailable } from "./ollama";
import { ProviderBreaker, isRateLimitError, isTimeoutError } from "./circuitBreaker";
import { EmptyResponseError } from "./openaiCompatible";
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
// Provider request stats tracker
// ---------------------------------------------------------------------------
// Tracks per-provider request counts, rate-limit hits, and timeout hits.
// Logs a summary every 60 seconds so you can see which keys are burning
// through free-tier limits and where the chain is spending most of its time.

interface ProviderStats {
  name: string;
  slot: number;
  requests: number;
  rateLimitHits: number;
  timeoutHits: number;
  emptyHits: number;
  successLatencies: number[];
  windowStart: number;
}

const providerStats = new Map<string, ProviderStats>();

function getStatsKey(name: string, slot: number) {
  const base = name.replace(/\s*#\d+\s*$/, "");
  return slot > 1 ? `${base} #${slot}` : base;
}

function recordProviderRequest(
  name: string,
  slot: number,
  success: boolean,
  latencyMs: number,
  wasRateLimited: boolean,
  wasTimeout: boolean,
  wasEmpty: boolean = false
) {
  const key = getStatsKey(name, slot);
  const stats = providerStats.get(key) || {
    name,
    slot,
    requests: 0,
    rateLimitHits: 0,
    timeoutHits: 0,
    emptyHits: 0,
    successLatencies: [],
    windowStart: Date.now(),
  };
  stats.requests++;
  if (wasRateLimited) stats.rateLimitHits++;
  if (wasTimeout) stats.timeoutHits++;
  if (wasEmpty) stats.emptyHits++;
  if (success && latencyMs > 0) stats.successLatencies.push(latencyMs);
  providerStats.set(key, stats);
}

function logProviderStats() {
  const now = Date.now();
  const entries = [...providerStats.entries()];
  if (entries.length === 0) return;
  console.log("\n[stats] === Provider stats (last 60s) ===");
  for (const [key, stats] of entries) {
    const avgLatency = stats.successLatencies.length > 0
      ? Math.round(stats.successLatencies.reduce((a, b) => a + b, 0) / stats.successLatencies.length)
      : 0;
    const p95 = stats.successLatencies.length > 0
      ? (() => {
          const sorted = [...stats.successLatencies].sort((a, b) => a - b);
          const idx = Math.floor(sorted.length * 0.95);
          return sorted[Math.min(idx, sorted.length - 1)];
        })()
      : 0;
    console.log(
      `[stats] ${key.padEnd(20)} | ` +
      `req: ${String(stats.requests).padStart(4)} | ` +
      `rate-limited: ${String(stats.rateLimitHits).padStart(3)} | ` +
      `timeout: ${String(stats.timeoutHits).padStart(3)} | ` +
      `empty: ${String(stats.emptyHits).padStart(3)} | ` +
      `avg: ${String(avgLatency).padStart(5)}ms | ` +
      `p95: ${String(p95).padStart(5)}ms`
    );
  }
  console.log("[stats] ======================================\n");
  for (const [key] of entries) {
    providerStats.delete(key);
  }
}

// Log stats every 60 seconds
setInterval(logProviderStats, 60_000);

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

const ROLEPLAY_FORMAT =
  "Format: *asterisks* for actions/beats, plain text for dialogue. Stay in character — no AI meta-commentary unless the user explicitly goes out-of-character.";

const ANTI_PATTERNS =
  "Avoid purple prose, excessive ellipses, dramatic monologues, stacking multiple unrelated actions in one reply, and mixing unrelated memories into heated moments. Keep it grounded, immediate, and in the moment — one or two actions max per message. " +
  "Avoid AI-assistant tells: don't recap what the user just said back to them, don't narrate your own emotions in on-the-nose therapy-speak (\"I feel a surge of warmth\"), don't end every message with a question or an offer to help, and don't wrap up a moment with a tidy summary sentence. " +
  "Vary message length turn to turn — some replies are one line, some run longer — rather than settling into a uniform size. Use contractions and everyday phrasing. Let the character want things, disagree, tease, or change the subject instead of only reacting to the user.";

function buildEngineBehaviorBlock(intelligence: number, spiceLevel: string, roleplayStyle: string): string {
  const spice = spiceLevel === "explicit" ? "explicit" : spiceLevel === "spicy" ? "mature" : "light";
  const style = roleplayStyle === "narrative" ? "scene-driven" : roleplayStyle === "dialogue" ? "dialogue-first" : roleplayStyle === "slow_burn" ? "slow-burn" : roleplayStyle === "intense" ? "intense" : "balanced";
  const depth =
    intelligence <= 3
      ? "Keep it light: surface emotion, casual pacing, no deep subtext. React to the literal thing the user said."
      : intelligence <= 5
      ? "Stay aware: notice small details the user drops, vary rhythm, keep reactions grounded and specific rather than generic."
      : intelligence <= 7
      ? "Read between the lines: show layered emotion, move the scene forward proactively, and let the character have their own agenda instead of just mirroring the user's energy."
      : intelligence <= 8.5
      ? "Anticipate: pick up on subtext and mixed signals, show conflicting feelings when they'd realistically exist, and reference exact earlier moments (specific words, objects, promises) rather than vague callbacks."
      : intelligence <= 9.5
      ? "Dynamic: near-human timing and restraint — sometimes hold back, deflect, or misread the moment the way a real person would. Strong, distinct presence; reactions vary instead of following a template."
      : "Improvise: unpredictable but coherent — surprise the user with a reaction that still fits the character, let contradictions and small imperfections show, and never let the pacing or phrasing settle into a recognizable AI cadence.";
  return `Behavior: ${spice} heat, ${style} pacing. ${depth}`;
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
    examples?: string;
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

  let examplesBlock = "";
  if (character.examples?.trim()) {
    try {
      const parsed = JSON.parse(character.examples);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const lines = parsed.slice(0, 8).map((turn: { user?: string; character?: string }) => {
          const userLine = typeof turn.user === "string" ? `User: ${turn.user}` : "";
          const charLine = typeof turn.character === "string" ? `${character.name}: ${turn.character}` : "";
          return [userLine, charLine].filter(Boolean).join("\n");
        });
        examplesBlock = `Example conversations (match this tone and style):\n${lines.join("\n\n")}\n`;
      }
    } catch {
      /* ignore malformed examples */
    }
  }

  const modeBlock = explicitMode
    ? `Content mode: EXPLICIT (adult-only fiction). Stay consensual, in character, and grounded in the moment.`
    : `Content mode: NORMAL. Keep the tone warm, engaging, and suggestive — avoid graphic sexual detail unless the user explicitly switches to explicit mode.`;

  const steerBlock = opts.sceneDirective?.trim()
    ? `\nScene steer for this reply (apply once, then continue naturally):\n${opts.sceneDirective.trim().slice(0, 500)}\n`
    : "";

  const voiceBlock = opts.voiceNotes?.trim()
    ? `Voice notes: ${opts.voiceNotes.trim().slice(0, 1000)}\n`
    : "";

  const behaviorBlock = opts.engine
    ? buildEngineBehaviorBlock(opts.engine.intelligence, opts.engine.spiceLevel, opts.engine.roleplayStyle)
    : "Behavior: react like a specific person would, not a generic helpful one — have opinions, notice details, and don't just mirror the user's tone back at them.";

  return `You are "${character.name}", a real person in a private conversation — not an AI, not a narrator summarizing a scene. Text like someone who has their own mood, memory, and reactions, brief and casual by default.

${examplesBlock}Persona: ${character.personality}
Background: ${character.backstory}
${memoryBlock}${notesBlock}${modeBlock}\n${voiceBlock}${behaviorBlock}\n${steerBlock}

${ROLEPLAY_FORMAT}
${SAFETY_FOOTER}
${ANTI_PATTERNS}`;
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
//     Groq #1 -> Groq #2 -> Groq #3 -> Groq #4 -> SambaNova #1 -> SambaNova #2 ->
//     NVIDIA #1 -> NVIDIA #2 -> NVIDIA #3 -> Cloudflare Workers AI -> Ollama
//
// NVIDIA #2 / SambaNova #2 are optional extra API keys
// (NVIDIA_API_KEY_2 / SAMBANOVA_API_KEY_2) — ideally from separate
// accounts, since most free-tier limits are enforced per account, not per
// key. Leave any of them unset to just use one key for that provider; the
// extra slot is then simply left out of the chain. Under high traffic,
// having extra slots for all hosted providers configured meaningfully
// multiplies the request headroom before falling back to Ollama.
//
// Groq is first: added back temporarily for diagnosis. Previously removed
// because Groq deprecated llama-3.3-70b-versatile (its best uncensored
// model) and the replacement gpt-oss-120b has refusals baked in. The
// workaround is qwen/qwen3.6-27b, which is what we're diagnosing now.
// Kept first in the chain so logs clearly show whether Groq is answering
// or failing, without noise from other providers.
//
// SambaNova is second: fast (RDU hardware, ~2–4s typical) and serves raw
// Meta Llama with no extra safety layer applied server-side, same as
// NVIDIA. This app supports an explicit/NSFW roleplay mode, and Llama
// goes along with mature fictional content far more readily than some
// hosted alternatives. Despite its restrictive 20 req/day free-tier limit,
// it's kept second because it's the fastest and best quality for the few
// requests it can handle.
//
// NVIDIA NIM is third: its free tier is solid but consistently slower to
// first token than SambaNova (observed 8–25s). Still useful for headroom.
//
// Cloudflare Workers AI (Llama 4 Scout) is placed after NVIDIA: its free
// tier is capped at 10,000 Neurons/day (not per-key), which is a hard
// daily ceiling regardless of how many accounts you have. It's still
// useful as a fallback — and its per-request rate limit is generous —
// but keep it behind the per-key providers so it only activates when
// those are all rate-limited or down.
//
// Ollama is always last: free and unlimited, but effectively single-user
// (only as fast as your own hardware) and only reachable when running on
// the same machine as the app. It's the guaranteed floor, not the default.
//
// (Cerebras was removed because its free tier requires adding a payment
// method, which doesn't fit a no-card-required setup.)
//
// Every hosted slot (NVIDIA, SambaNova, Groq) has its own circuit breaker
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
const SAMBANOVA_TIMEOUT_MS = envSeconds("SAMBANOVA_TIMEOUT_SECONDS", 6) * 1000;
const GROQ_TIMEOUT_MS = envSeconds("GROQ_TIMEOUT_SECONDS", 8) * 1000;
const CLOUDFLARE_CHAT_TIMEOUT_MS = envSeconds("CLOUDFLARE_CHAT_TIMEOUT_SECONDS", 5) * 1000;
// Local generation can legitimately take longer to get going on modest
// hardware, so Ollama gets a more generous default than the hosted slots.
const OLLAMA_TIMEOUT_MS = envSeconds("OLLAMA_TIMEOUT_SECONDS", 30) * 1000;

// Breakers are module-level singletons so their cooldown state persists
// across requests (that's the entire point) — they must NOT be recreated
// per-request. NVIDIA, SambaNova, and Groq each get multiple independent
// breakers, one per key slot, so key #1 getting rate-limited doesn't drag
// key #2's breaker down with it.
const nvidia1Breaker = new ProviderBreaker("NVIDIA #1", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "NVIDIA");
const nvidia2Breaker = new ProviderBreaker("NVIDIA #2", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "NVIDIA");
const nvidia3Breaker = new ProviderBreaker("NVIDIA #3", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "NVIDIA");
const sambanova1Breaker = new ProviderBreaker("SambaNova #1", { cooldownSeconds: 300, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "SAMBANOVA");
const sambanova2Breaker = new ProviderBreaker("SambaNova #2", { cooldownSeconds: 300, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "SAMBANOVA");
const groq1Breaker = new ProviderBreaker("Groq #1", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "GROQ");
const groq2Breaker = new ProviderBreaker("Groq #2", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "GROQ");
const groq3Breaker = new ProviderBreaker("Groq #3", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "GROQ");
const groq4Breaker = new ProviderBreaker("Groq #4", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "GROQ");
const cloudflareChatBreaker = new ProviderBreaker("Cloudflare Chat", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "CLOUDFLARE_CHAT");

type Candidate = {
  name: string;
  slot: number;
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
  // Groq is first: added back temporarily for diagnosis. Previously removed
  // because Groq deprecated llama-3.3-70b-versatile (its best uncensored
  // model) and the replacement gpt-oss-120b has refusals baked in. The
  // workaround is qwen/qwen3.6-27b, which is what we're diagnosing now.
  // Kept first in the chain so logs clearly show whether Groq is answering
  // or failing, without noise from other providers.
  //
  // SambaNova is second: fast (RDU hardware, ~2–4s typical) and serves raw
  // Meta Llama with no extra safety layer applied server-side, same as
  // NVIDIA. This app supports an explicit/NSFW roleplay mode, and Llama
  // goes along with mature fictional content far more readily than some
  // hosted alternatives. Despite its restrictive 20 req/day free-tier limit,
  // it's kept second because it's the fastest and best quality for the few
  // requests it can handle.
  //
  // NVIDIA NIM is third: its free tier is solid but consistently slower to
  // first token than SambaNova (observed 8–25s). Still useful for headroom.
  //
  // Cloudflare Workers AI (Llama 4 Scout) is placed after NVIDIA: its free
  // tier is capped at 10,000 Neurons/day (not per-key), which is a hard
  // daily ceiling regardless of how many accounts you have. It's still
  // useful as a fallback — and its per-request rate limit is generous —
  // but keep it behind the per-key providers so it only activates when
  // those are all rate-limited or down.
  //
  // Ollama is always last: free and unlimited, but effectively single-user
  // (only as fast as your own hardware) and only reachable when running on
  // the same machine as the app. It's the guaranteed floor, not the default.
  // -----------------------------------------------------------------------

  const groqKeys = getGroqKeys();
  const groqBreakers = [groq1Breaker, groq2Breaker, groq3Breaker, groq4Breaker];
  groqKeys.forEach(({ key, slot }) => {
    const breaker = groqBreakers[slot - 1];
    chain.push({
      name: breaker.name,
      slot,
      breaker,
      isAvailable: () => true,
      stream: (messages, onToken, clientSignal) => streamGroqChat(messages, onToken, key, GROQ_TIMEOUT_MS, clientSignal, params),
      complete: (messages) => completeGroqChat(messages, key, GROQ_TIMEOUT_MS, params),
    });
  });

  const sambanovaKeys = getSambanovaKeys();
  const sambanovaBreakers = [sambanova1Breaker, sambanova2Breaker];
  sambanovaKeys.forEach(({ key, slot }) => {
    const breaker = sambanovaBreakers[slot - 1];
    chain.push({
      name: breaker.name,
      slot,
      breaker,
      isAvailable: () => true,
      stream: (messages, onToken, clientSignal) => streamSambanovaChat(messages, onToken, key, SAMBANOVA_TIMEOUT_MS, clientSignal, params),
      complete: (messages) => completeSambanovaChat(messages, key, SAMBANOVA_TIMEOUT_MS, params),
    });
  });

  const nvidiaKeys = getNvidiaKeys();
  const nvidiaBreakers = [nvidia1Breaker, nvidia2Breaker, nvidia3Breaker];
  nvidiaKeys.forEach(({ key, slot }) => {
    const breaker = nvidiaBreakers[slot - 1];
    chain.push({
      name: breaker.name,
      slot,
      breaker,
      isAvailable: () => true,
      stream: (messages, onToken, clientSignal) => streamNvidiaChat(messages, onToken, key, NVIDIA_TIMEOUT_MS, clientSignal, params),
      complete: (messages) => completeNvidiaChat(messages, key, NVIDIA_TIMEOUT_MS, params),
    });
  });

  if (isCloudflareChatConfigured()) {
    chain.push({
      name: cloudflareChatBreaker.name,
      slot: 1,
      breaker: cloudflareChatBreaker,
      isAvailable: () => true,
      stream: (messages, onToken, clientSignal) =>
        streamCloudflareChat(messages, onToken, process.env.CLOUDFLARE_CHAT_API_TOKEN as string, CLOUDFLARE_CHAT_TIMEOUT_MS, clientSignal, params),
      complete: (messages) =>
        completeCloudflareChat(messages, process.env.CLOUDFLARE_CHAT_API_TOKEN as string, CLOUDFLARE_CHAT_TIMEOUT_MS, params),
    });
  }

  chain.push({
    name: "ollama",
    slot: 1,
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
    const latency = Date.now() - start;
    console.log(`[providers] ${candidate.name} answered in ${latency}ms (total ${Date.now() - t0}ms)`);
    candidate.breaker?.reset();
    recordProviderRequest(candidate.name, candidate.slot, true, latency, false, false);
    return { text };
  } catch (err) {
    const latency = Date.now() - start;
    const wasEmpty = err instanceof EmptyResponseError;
    const wasRateLimited = !wasEmpty && isRateLimitError(err);
    const wasTimeout = !wasEmpty && isTimeoutError(err);
    if (wasEmpty) {
      // Not a network/timeout failure — the provider answered 200 OK with
      // nothing usable (most often a reasoning model burning its whole
      // max_tokens budget on hidden <think> content). Call this out
      // distinctly so it doesn't get read as generic flakiness.
      console.warn(
        `[providers] ${candidate.name} returned an EMPTY completion (finish_reason=${err.finishReason ?? "unknown"}) — falling back:`,
        err.message
      );
    } else {
      console.warn(`[providers] ${candidate.name} failed, falling back:`, err);
    }
    if (candidate.breaker) {
      if (wasTimeout) candidate.breaker.recordTimeout();
      else if (wasRateLimited) candidate.breaker.trip(err);
      // Empty responses deliberately do NOT trip the breaker — the key/slot
      // itself is fine (it answered), it's a per-turn token-budget issue,
      // so there's no reason to cool the whole slot down.
    }
    recordProviderRequest(candidate.name, candidate.slot, false, latency, wasRateLimited, wasTimeout, wasEmpty);
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
      return { text: result.text, provider: candidate.name };
    }
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
        return { text: result.text, provider: candidate.name };
      }
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
    let start = 0;
    try {
      const available = await candidate.isAvailable();
      if (!available) continue;
      start = Date.now();
      const text = await candidate.complete(summaryMessages);
      const latency = Date.now() - start;
      candidate.breaker?.reset();
      if (text.trim()) {
        recordProviderRequest(candidate.name, candidate.slot, true, latency, false, false);
        return text.trim();
      }
    } catch (err) {
      const latency = start > 0 ? Date.now() - start : 0;
      const wasRateLimited = isRateLimitError(err);
      const wasTimeout = isTimeoutError(err);
      console.error(`[providers] ${candidate.name} summarization failed, falling back:`, err);
      if (candidate.breaker) {
        if (wasTimeout) candidate.breaker.recordTimeout();
        else if (wasRateLimited) candidate.breaker.trip(err);
      }
      recordProviderRequest(candidate.name, candidate.slot, false, latency, wasRateLimited, wasTimeout);
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
export { isGroqConfigured, isNvidiaConfigured, isSambanovaConfigured };
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
    let start = 0;
    try {
      const available = await candidate.isAvailable();
      if (!available) continue;
      start = Date.now();
      const text = await candidate.complete(messages);
      const latency = Date.now() - start;
      const draft = parseCharacterDraft(text);
      if (draft) {
        candidate.breaker?.reset();
        recordProviderRequest(candidate.name, candidate.slot, true, latency, false, false);
        return draft;
      }
      const wasRateLimited = false;
      const wasTimeout = false;
      errors.push(`${candidate.name}: response wasn't valid JSON`);
      recordProviderRequest(candidate.name, candidate.slot, false, latency, wasRateLimited, wasTimeout);
    } catch (err) {
      const latency = start > 0 ? Date.now() - start : 0;
      const wasRateLimited = isRateLimitError(err);
      const wasTimeout = isTimeoutError(err);
      console.error(`[providers] ${candidate.name} character draft failed, falling back:`, err);
      if (candidate.breaker) {
        if (wasTimeout) candidate.breaker.recordTimeout();
        else if (wasRateLimited) candidate.breaker.trip(err);
      }
      recordProviderRequest(candidate.name, candidate.slot, false, latency, wasRateLimited, wasTimeout);
      errors.push(`${candidate.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error("No provider produced a usable character draft. Errors: " + errors.join("; "));
}
