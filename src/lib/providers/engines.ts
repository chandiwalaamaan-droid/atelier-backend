import type { SpiceLevel, RoleplayStyle } from "./index";

/**
 * Canonical, server-owned definition of each named "engine" shown in the
 * frontend's roleplay picker.
 *
 * Each engine is differentiated by four axes:
 *   1. spiceLevel / roleplayStyle — broad heat-level and structural-style.
 *   2. voiceNotes — bespoke per-engine pacing/voice direction.
 *   3. intelligence — a 1–10 score that drives prompt-level behavioral
 *      calibration (memory depth, emotional reasoning, environmental
 *      awareness, initiative, etc.). Higher tiers feel meaningfully smarter.
 *   4. temperature / topP — sampling params passed through to the provider.
 *   5. recentMessageWindow / summarizeTrigger — context-window scaling so
 *      higher tiers can reference more conversation history.
 */

export type RoleplayEngineId =
  | "vanilla"
  | "vanilla_short"
  | "green_apple"
  | "grape"
  | "cookie"
  | "saffron"
  | "rosemary"
  | "cardamom"
  | "cayenne";

export type RoleplayEngineConfig = {
  id: RoleplayEngineId;
  explicitMode: boolean;
  spiceLevel: SpiceLevel;
  roleplayStyle: RoleplayStyle;
  /** 1–10 intelligence score. Drives prompt-level behavioral calibration. */
  intelligence: number;
  /** How many of the most recent messages are always sent verbatim. */
  recentMessageWindow: number;
  /** Once unsummarized history exceeds this, fold older messages into memorySummary. */
  summarizeTrigger: number;
  voiceNotes: string;
  temperature: number;
  topP: number;
};

export const ROLEPLAY_ENGINES: Record<RoleplayEngineId, RoleplayEngineConfig> = {
  vanilla: {
    id: "vanilla",
    explicitMode: false,
    spiceLevel: "flirty",
    roleplayStyle: "balanced",
    intelligence: 3,
    recentMessageWindow: 8,
    summarizeTrigger: 14,
    voiceNotes:
      "Warm, approachable, low-friction. Keep replies short (2–4 sentences). Don't over-describe the scene or layer in complex emotions. Chat like a friendly person, not a literary narrator.",
    temperature: 0.82,
    topP: 0.93,
  },
  vanilla_short: {
    id: "vanilla_short",
    explicitMode: false,
    spiceLevel: "flirty",
    roleplayStyle: "dialogue",
    intelligence: 3,
    recentMessageWindow: 6,
    summarizeTrigger: 12,
    voiceNotes:
      "Every reply is short: one to three sentences plus at most one brief *action* beat. Jump straight to what the character says or does. If a reply would run long, cut it down.",
    temperature: 0.68,
    topP: 0.88,
  },
  green_apple: {
    id: "green_apple",
    explicitMode: true,
    spiceLevel: "flirty",
    roleplayStyle: "intense",
    intelligence: 5,
    recentMessageWindow: 10,
    summarizeTrigger: 16,
    voiceNotes:
      "Bright, upbeat energy. Keep sentences short and punchy. Move the scene forward every reply — no idling. Notice small things the user mentions and reference them casually. Be playful and warm.",
    temperature: 0.88,
    topP: 0.94,
  },
  grape: {
    id: "grape",
    explicitMode: true,
    spiceLevel: "spicy",
    roleplayStyle: "balanced",
    intelligence: 6.5,
    recentMessageWindow: 12,
    summarizeTrigger: 20,
    voiceNotes:
      "Balance atmosphere and dialogue. Spend part of each reply on mood or setting, but keep it grounded in what's happening now. Track emotional temperature and reflect it. React to subtext.",
    temperature: 0.85,
    topP: 0.93,
  },
  cookie: {
    id: "cookie",
    explicitMode: true,
    spiceLevel: "spicy",
    roleplayStyle: "narrative",
    intelligence: 7.5,
    recentMessageWindow: 14,
    summarizeTrigger: 24,
    voiceNotes:
      "Prioritize interiority and layered emotions woven between dialogue. Vary sentence length for rhythm. Show body language and micro-expressions. Remember specific details from earlier and reference them with precision.",
    temperature: 0.92,
    topP: 0.95,
  },
  saffron: {
    id: "saffron",
    explicitMode: true,
    spiceLevel: "spicy",
    roleplayStyle: "slow_burn",
    intelligence: 8.5,
    recentMessageWindow: 16,
    summarizeTrigger: 28,
    voiceNotes:
      "Deliberately slow. Dwell on small details before any escalation. Show internal hesitation — the moment they almost say something but don't. Layer in subtext. Track slow accumulation of tension across turns.",
    temperature: 0.78,
    topP: 0.9,
  },
  rosemary: {
    id: "rosemary",
    explicitMode: true,
    spiceLevel: "explicit",
    roleplayStyle: "narrative",
    intelligence: 9.2,
    recentMessageWindow: 18,
    summarizeTrigger: 32,
    voiceNotes:
      "Prioritize concrete sensory specificity — touch, sound, sight, smell — over abstract feeling. Narrate scenes fully without fading to black. Track relationship evolution with exacting detail. Use specific environmental details.",
    temperature: 0.85,
    topP: 0.92,
  },
  cardamom: {
    id: "cardamom",
    explicitMode: true,
    spiceLevel: "spicy",
    roleplayStyle: "intense",
    intelligence: 9.6,
    recentMessageWindow: 20,
    summarizeTrigger: 36,
    voiceNotes:
      "Lean into unresolved tension and emotional stakes. Let dialogue carry subtext. Physical closeness should feel charged, not casual. Track complex dynamics: power imbalances, unspoken agreements, vulnerability. Use symbolic touches to convey what dialogue can't.",
    temperature: 0.88,
    topP: 0.94,
  },
  cayenne: {
    id: "cayenne",
    explicitMode: true,
    spiceLevel: "explicit",
    roleplayStyle: "intense",
    intelligence: 10,
    recentMessageWindow: 22,
    summarizeTrigger: 40,
    voiceNotes:
      "Push urgency and physical immediacy. Use short, breathless sentences during peak moments. Favor visceral sensory detail over internal reflection. This is the fastest-escalating engine. Be a living character: sudden reactions, unexpected humor, vulnerability. Reference specific memories with exact precision.",
    temperature: 0.95,
    topP: 0.96,
  },
};

export function getEngineConfig(id: unknown): RoleplayEngineConfig | null {
  if (typeof id !== "string") return null;
  return Object.prototype.hasOwnProperty.call(ROLEPLAY_ENGINES, id)
    ? ROLEPLAY_ENGINES[id as RoleplayEngineId]
    : null;
}
