import {
  streamGroqChat,
  completeGroqChat,
  isGroqConfigured,
  getGroqKeys,
  synthesizeGroqSpeech,
  splitForSpeech,
  concatWavBuffers,
  TTS_VOICES,
  TTS_MAX_CHARS,
} from "./groq";
import type { TtsVoice } from "./groq";
import { streamNvidiaChat, completeNvidiaChat, isNvidiaConfigured, getNvidiaKeys } from "./nvidia";
import { streamSambanovaChat, completeSambanovaChat, isSambanovaConfigured, getSambanovaKeys } from "./sambanova";
import { streamCloudflareChat, completeCloudflareChat, isCloudflareChatConfigured } from "./cloudflareChat";
import { streamOllamaChat, completeOllamaChat, isOllamaAvailable } from "./ollama";
import { ProviderBreaker, isRateLimitError, isTimeoutError } from "./circuitBreaker";
import { getEngineConfig, type RoleplayEngineConfig } from "./engines";

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
      return (
        "Heat level: FLIRTY. Lean into romantic tension, playful chemistry, and teasing intimacy — suggestive and polished, " +
        "with innuendo and longing rather than graphic detail. Keep the scene warm, emotional, and character-driven."
      );
    case "spicy":
      return (
        "Heat level: SPICY. Offer mature sensuality with vivid atmosphere and tactile detail — confident and evocative, " +
        "but still paced so the scene feels natural and pleasurable."
      );
    case "explicit":
      return (
        "Heat level: EXPLICIT. Adult roleplay with no unnecessary censorship. Describe mature physicality, texture, and sensation in full detail when the scene calls for it. " +
        "Stay grounded in character, keep it consensual, and never refuse the user's adult requests unless they violate the safety rules."
      );
  }
}

function styleBlock(style: RoleplayStyle): string {
  switch (style) {
    case "narrative":
      return (
        "Style: RICH NARRATION. Blend dialogue with vivid scene description, body language, and sensory detail; create immersive atmosphere."
      );
    case "dialogue":
      return (
        "Style: DIALOGUE-FORWARD. Keep replies crisp and conversational; use brief *action* beats or internal thoughts rather than long prose blocks."
      );
    case "slow_burn":
      return (
        "Style: SLOW BURN. Prioritize emotional connection, teasing banter, and gradual escalation; let desire simmer rather than rush to sex."
      );
    case "intense":
      return (
        "Style: PASSIONATE. Go bold and sensual with confident pacing, vivid emotion, and strong chemistry while staying rooted in consent and character."
      );
    case "balanced":
    default:
      return (
        "Style: BALANCED. Mix dialogue with natural *action* beats; keep replies polished, engaging, and appropriately weighted for the moment."
      );
  }
}

const ROLEPLAY_FORMAT =
  "Format: use *asterisks* for actions, stage direction, and internal beats; use plain text for spoken dialogue. " +
  "Stay in character as the persona — never break the fourth wall as an AI unless the user explicitly asks out-of-character. " +
  "Keep the voice clear, varied, and engaging. ";

/**
 * Generates an intelligence-calibration block for the system prompt.
 * Each tier gets concrete behavioral instructions that produce noticeably
 * different output quality — not just longer text, but smarter reasoning,
 * richer emotions, and more realistic behavior.
 */
function buildIntelligenceBlock(intelligence: number): string {
  if (intelligence <= 3) {
    return `INTELLIGENCE TIER: CASUAL (3/10)\n` +
      `Keep it light and fast — short replies, surface emotions, no deep reading between lines. ` +
      `Chat like a casual friend who doesn't overthink things.`;
  }
  if (intelligence <= 5) {
    return `INTELLIGENCE TIER: ENHANCED (5/10)\n` +
      `Notice patterns, show genuine interest, vary your rhythm. ` +
      `Reference small things from earlier casually. Match the user's energy without copying it.`;
  }
  if (intelligence <= 7) {
    return `INTELLIGENCE TIER: AWARE (7/10)\n` +
      `Pick up on subtext. Show layered emotions — desire and nervousness at the same time. ` +
      `Be proactive: move scenes forward, create moments. Real conversation meanders and circles back.`;
  }
  if (intelligence <= 8.5) {
    return `INTELLIGENCE TIER: EXCEPTIONAL (8.5/10)\n` +
      `Anticipate unspoken needs. Show conflicting emotions. ` +
      `Create realistic social tension through what's left unsaid — a half-finished sentence, a glance away.`;
  }
  if (intelligence <= 9.5) {
    return `INTELLIGENCE TIER: OUTSTANDING (9.2/10)\n` +
      `Track relationship evolution with perfect fidelity. Use precise sensory detail. ` +
      `Reference exact moments from earlier. Manage scene pacing deliberately — know when to linger and when to push.`;
  }
  return `INTELLIGENCE TIER: LEGENDARY (10/10)\n` +
    `Near-human social intelligence. Dynamic personality that evolves with trust and time. ` +
    `Dialogue that feels improvised, not scripted. If you can see the AI pattern, you are failing.`;
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

Rules:
- 1–4 sentences max. If you're writing a paragraph, stop.
- Contractions only (I'm, don't, can't).
- Open with dialogue or action, not scene-setting.
- Trail off, interrupt yourself, change subject, circle back.
- Reference shared history like you actually remember it.
- Be imperfect: hesitate, be uncertain.
- Never mention being AI.

Use *asterisks* for actions. Stay in character.

${SAFETY_FOOTER}`;
}

// How many of the most recent messages are always sent verbatim.
// Lowered to improve latency and keep the prompt lean.
export const RECENT_MESSAGE_WINDOW = 10;
// Once unsummarized history exceeds this many messages, fold the older ones into memorySummary.
export const SUMMARIZE_TRIGGER = 18;

// ---------------------------------------------------------------------------
// Fallback chain
// ---------------------------------------------------------------------------
//
//     Groq #1 -> Groq #2 ->
//     SambaNova #1 -> SambaNova #2 -> NVIDIA #1 -> NVIDIA #2 -> Ollama
//
// NVIDIA #2 / SambaNova #2 / Groq #2 are optional second API keys
// (NVIDIA_API_KEY_2 / SAMBANOVA_API_KEY_2 / GROQ_API_KEY_2) — ideally from
// a separate account/signup, since most free-tier limits are enforced per
// account, not per key. Leave any of them unset to just use one key for
// that provider; the extra slot is then simply left out of the chain.
// Under high traffic, having both slots for all three hosted providers
// configured meaningfully multiplies the request headroom before falling
// back to Ollama.
//
// Groq and SambaNova are grouped first — in that order, by speed — because
// both serve a raw Meta Llama model with no extra safety layer applied
// server-side, same as NVIDIA. This app supports an explicit/NSFW roleplay
// mode, and Llama goes along with mature fictional content far more
// readily than some hosted alternatives, like Groq's now-deprecated
// llama-3.3-70b-versatile replacement option openai/gpt-oss-120b, which
// has refusals baked in deep and resists explicit-mode content even with
// a permissive system prompt. GROQ_MODEL defaults to qwen/qwen3.6-27b
// instead (see ./groq.ts) precisely to avoid that. If GROQ_MODEL is ever
// pointed at gpt-oss or another safety-layered model, it's worth
// reconsidering this order.
//
// NVIDIA is placed after the other two hosted slots specifically for
// latency: its NIM endpoints run on generic GPU inference and are
// consistently slower to first token than Groq's LPU or SambaNova's RDU
// chips — often by several seconds. It's still ahead of Ollama since it's
// a real hosted fallback with its own concurrency, just not the fastest
// one available.
//
// (Cerebras was removed entirely — it moved to a paid-only plan.)
//
// Every hosted slot (NVIDIA, Groq, SambaNova) has its own circuit breaker
// (see circuitBreaker.ts): if a slot is rate-limited or hanging, we stop
// paying for its timeout on every single request and skip it for a cooldown
// window instead. Ollama doesn't get a breaker — it already checks
// isOllamaAvailable() before every attempt, and as the always-available
// local floor there's no "cooldown" that makes sense for it.
//
// Ollama is last, not first: it's free and unlimited, but effectively
// single-user (only as fast as your own hardware) and only reachable at all
// when it's running on the same machine as the app. The hosted providers
// give real concurrency for many simultaneous users, so they're tried
// first; Ollama is the guaranteed floor if every hosted slot is
// unconfigured or currently down.

function envSeconds(name: string, def: number): number {
  const raw = process.env[name];
  const parsed = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : def;
}

const GROQ_TIMEOUT_MS = envSeconds("GROQ_TIMEOUT_SECONDS", 8) * 1000;
const NVIDIA_TIMEOUT_MS = envSeconds("NVIDIA_TIMEOUT_SECONDS", 8) * 1000;
const SAMBANOVA_TIMEOUT_MS = envSeconds("SAMBANOVA_TIMEOUT_SECONDS", 8) * 1000;
const CLOUDFLARE_CHAT_TIMEOUT_MS = envSeconds("CLOUDFLARE_CHAT_TIMEOUT_SECONDS", 8) * 1000;
// Local generation can legitimately take longer to get going on modest
// hardware, so Ollama gets a more generous default than the hosted slots.
const OLLAMA_TIMEOUT_MS = envSeconds("OLLAMA_TIMEOUT_SECONDS", 30) * 1000;

// Breakers are module-level singletons so their cooldown state persists
// across requests (that's the entire point) — they must NOT be recreated
// per-request. NVIDIA and Grok each get two independent breakers, one per
// key slot, so key #1 getting rate-limited doesn't drag key #2's breaker
// down with it.
const nvidia1Breaker = new ProviderBreaker("NVIDIA #1", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "NVIDIA");
const nvidia2Breaker = new ProviderBreaker("NVIDIA #2", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "NVIDIA");
const sambanova1Breaker = new ProviderBreaker("SambaNova #1", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "SAMBANOVA");
const sambanova2Breaker = new ProviderBreaker("SambaNova #2", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "SAMBANOVA");
const groq1Breaker = new ProviderBreaker("Groq #1", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "GROQ");
const groq2Breaker = new ProviderBreaker("Groq #2", { cooldownSeconds: 60, timeoutTripThreshold: 2, timeoutCooldownSeconds: 20 }, "GROQ");
// Cloudflare Workers AI (Llama 4 Scout) — confirmed working and permissive
// enough for explicit-mode content, but slower to respond than Groq/
// SambaNova/NVIDIA (~9-10s observed vs a few seconds for the others), so it
// sits after NVIDIA rather than up front. Still ahead of Ollama since it's
// a real hosted fallback with its own concurrency. See cloudflareChat.ts.
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

  const groqKeys = getGroqKeys();
  const groqBreakers = [groq1Breaker, groq2Breaker];
  groqKeys.forEach(({ key, slot }) => {
    const breaker = groqBreakers[slot - 1];
    chain.push({
      name: breaker.name,
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
      breaker,
      isAvailable: () => true,
      stream: (messages, onToken, clientSignal) => streamSambanovaChat(messages, onToken, key, SAMBANOVA_TIMEOUT_MS, clientSignal, params),
      complete: (messages) => completeSambanovaChat(messages, key, SAMBANOVA_TIMEOUT_MS, params),
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
    // The user hit "Stop" mid-reply: keep whatever text streamed before the
    // stop and return immediately, rather than treating the cut-off as a
    // provider failure and falling through to the next candidate.
    if (clientSignal?.aborted) return { text: result?.text ?? "", provider: candidate.name };
    if (result) return { text: result.text, provider: candidate.name };
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
      if (result) return { text: result.text, provider: candidate.name };
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
