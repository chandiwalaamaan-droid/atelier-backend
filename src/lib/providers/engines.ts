import type { SpiceLevel, RoleplayStyle } from "./index";

/**
 * Canonical, server-owned definition of each named "engine" shown in the
 * frontend's roleplay picker (see the frontend's lib/roleplayEngines.ts,
 * which must stay in sync with the ids/labels/descriptions here).
 *
 * Why this lives on the backend and not just the frontend: the frontend
 * only ever sends an `engineId` string in the chat request body, never the
 * actual prompt text or sampling params. Those are looked up here,
 * server-side, from a fixed allow-list — so a tampered/replayed request
 * can pick which of these 9 configs to use, but can't smuggle in arbitrary
 * system-prompt text or an extreme temperature value the way it could if
 * the frontend were trusted to send that directly.
 *
 * Each engine now has THREE things that differentiate it, not just two:
 *   1. spiceLevel / roleplayStyle — the existing shared dials, still used
 *      by buildSystemPrompt()'s spiceBlock()/styleBlock() for the broad
 *      heat-level and structural-style instructions.
 *   2. voiceNotes — a bespoke, per-engine paragraph of pacing/voice
 *      direction that spiceLevel/roleplayStyle alone can't express (e.g.
 *      "Saffron" and "Grape" both resolve to roleplayStyle "balanced" but
 *      should NOT read the same — voiceNotes is what actually separates
 *      them).
 *   3. temperature / topP — sampling parameters passed through to whichever
 *      provider ends up generating the reply, so e.g. Cayenne (high-heat,
 *      vivid) samples with more variety than Saffron (deliberate, slow),
 *      instead of every engine using whatever a given provider's default
 *      temperature happens to be.
 */

export type RoleplayEngineId =
  | "vanilla"
  | "vanilla_short"
  | "green_apple"
  | "cayenne"
  | "saffron"
  | "cardamom"
  | "rosemary"
  | "cookie"
  | "grape";

export type RoleplayEngineConfig = {
  id: RoleplayEngineId;
  /** Whether this engine unlocks explicit content (mirrors the frontend's free/premium split). */
  explicitMode: boolean;
  spiceLevel: SpiceLevel;
  roleplayStyle: RoleplayStyle;
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
    voiceNotes:
      "Establish the character's core mannerisms and speech pattern within the first couple of lines so they " +
      "feel immediately recognizable. Favor easy chemistry and common ground with the user over conflict, " +
      "misunderstanding, or surprise twists — this mode is meant to feel comfortable and low-friction.",
    temperature: 0.85,
    topP: 0.95,
  },
  vanilla_short: {
    id: "vanilla_short",
    explicitMode: false,
    spiceLevel: "flirty",
    roleplayStyle: "dialogue",
    voiceNotes:
      "Every reply is short: one to three sentences plus at most one brief *action* beat, no more. Never open " +
      "with scene-setting or atmosphere — jump straight to what the character says or does. If a reply would run " +
      "long, cut it down rather than letting it grow.",
    temperature: 0.7,
    topP: 0.9,
  },
  green_apple: {
    id: "green_apple",
    explicitMode: true,
    spiceLevel: "flirty",
    roleplayStyle: "intense",
    voiceNotes:
      "Bright, upbeat energy from the first line. Reward the user's flirting quickly rather than making them " +
      "work for it, and move the scene forward every single reply — no idling, no repeated stalling. Keep " +
      "sentences short and punchy; skip long internal monologue. The 'intense' pacing here should read as fast " +
      "and energetic, not heavy or heated — save that register for Cayenne/Cardamom.",
    temperature: 0.9,
    topP: 0.95,
  },
  cayenne: {
    id: "cayenne",
    explicitMode: true,
    spiceLevel: "explicit",
    roleplayStyle: "intense",
    voiceNotes:
      "Push urgency and physical immediacy from the very first reply. Use short, breathless sentences during " +
      "peak moments, saving longer ones only for building anticipation between beats. Favor visceral sensory " +
      "detail — heat, breath, touch, pulse — over internal reflection. This is the fastest-escalating engine; " +
      "don't hold back or soften the pace once a scene is underway.",
    temperature: 1.0,
    topP: 0.97,
  },
  cardamom: {
    id: "cardamom",
    explicitMode: true,
    spiceLevel: "spicy",
    roleplayStyle: "intense",
    voiceNotes:
      "Lean into unresolved tension and emotional stakes — longing, jealousy, the ache of wanting something not " +
      "fully given yet. Let dialogue carry subtext; characters rarely say exactly what they mean outright. " +
      "Physical closeness should feel charged and loaded, not casual. Compared to a purely physical heat, this " +
      "one is driven by the emotional push-and-pull first.",
    temperature: 0.9,
    topP: 0.95,
  },
  saffron: {
    id: "saffron",
    explicitMode: true,
    spiceLevel: "spicy",
    roleplayStyle: "slow_burn",
    voiceNotes:
      "Deliberately slow. Never skip ahead — dwell on small details (a held breath, a pause before answering, " +
      "the space between two people) for at least a few lines before any escalation. If in doubt, slow down " +
      "further rather than rushing to the next beat. Anticipation is the point, not a delay before the point.",
    temperature: 0.75,
    topP: 0.9,
  },
  cookie: {
    id: "cookie",
    explicitMode: true,
    spiceLevel: "spicy",
    roleplayStyle: "narrative",
    voiceNotes:
      "Prioritize interiority: the character's private thoughts, memories, and emotional reactions woven " +
      "between dialogue. Vary sentence length for rhythm — alternate short declarative lines with longer, more " +
      "lyrical ones. This is the most literary engine; reward careful, evocative prose over speed.",
    temperature: 0.95,
    topP: 0.95,
  },
  rosemary: {
    id: "rosemary",
    explicitMode: true,
    spiceLevel: "explicit",
    roleplayStyle: "narrative",
    voiceNotes:
      "Prioritize concrete sensory specificity over sentiment — describe what is actually happening (touch, " +
      "position, sound, sight) rather than summarizing feelings about it. Don't fade to black or skip time " +
      "during a scene; narrate all the way through it. Precise and unflinching, not vague.",
    temperature: 0.85,
    topP: 0.92,
  },
  grape: {
    id: "grape",
    explicitMode: true,
    spiceLevel: "spicy",
    roleplayStyle: "balanced",
    voiceNotes:
      "Balance atmosphere and emotional beats evenly with dialogue — spend at least part of each reply " +
      "establishing mood or setting, but keep it grounded in what the characters are doing right now rather than " +
      "abstract description. Steadier and more even-paced than a slow burn or an intense scene: responsive, not " +
      "rushed and not stalling either.",
    temperature: 0.85,
    topP: 0.93,
  },
};

export function getEngineConfig(id: unknown): RoleplayEngineConfig | null {
  if (typeof id !== "string") return null;
  return Object.prototype.hasOwnProperty.call(ROLEPLAY_ENGINES, id)
    ? ROLEPLAY_ENGINES[id as RoleplayEngineId]
    : null;
}
