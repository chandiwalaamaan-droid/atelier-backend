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
    recentMessageWindow: 14,
    summarizeTrigger: 24,
    voiceNotes:
      "Establish the character's core mannerisms and speech pattern within the first couple of lines so they " +
      "feel immediately recognizable. Favor easy chemistry and common ground with the user over conflict, " +
      "misunderstanding, or surprise twists — this mode is meant to feel comfortable and low-friction. " +
      "Keep replies short (2–4 sentences), conversational, and warm. Do not over-describe the scene, " +
      "do not layer in complex emotions, and do not reference events from many turns ago — the user " +
      "should feel like they are chatting with a friendly, approachable person, not a literary narrator.",
    temperature: 0.82,
    topP: 0.93,
  },
  vanilla_short: {
    id: "vanilla_short",
    explicitMode: false,
    spiceLevel: "flirty",
    roleplayStyle: "dialogue",
    intelligence: 3,
    recentMessageWindow: 10,
    summarizeTrigger: 20,
    voiceNotes:
      "Every reply is short: one to three sentences plus at most one brief *action* beat, no more. Never open " +
      "with scene-setting or atmosphere — jump straight to what the character says or does. If a reply would run " +
      "long, cut it down rather than letting it grow. Keep it snappy and fun, like a text from a witty friend.",
    temperature: 0.68,
    topP: 0.88,
  },
  green_apple: {
    id: "green_apple",
    explicitMode: true,
    spiceLevel: "flirty",
    roleplayStyle: "intense",
    intelligence: 5,
    recentMessageWindow: 18,
    summarizeTrigger: 32,
    voiceNotes:
      "Bright, upbeat energy from the first line. Reward the user's flirting quickly rather than making them " +
      "work for it, and move the scene forward every single reply — no idling, no repeated stalling. Keep " +
      "sentences short and punchy; skip long internal monologue. The 'intense' pacing here should read as fast " +
      "and energetic, not heavy or heated — save that register for Cayenne/Cardamom. " +
      "Notice small things the user mentions and reference them casually. Be playful and warm.",
    temperature: 0.88,
    topP: 0.94,
  },
  grape: {
    id: "grape",
    explicitMode: true,
    spiceLevel: "spicy",
    roleplayStyle: "balanced",
    intelligence: 6.5,
    recentMessageWindow: 22,
    summarizeTrigger: 40,
    voiceNotes:
      "Balance atmosphere and emotional beats evenly with dialogue — spend at least part of each reply " +
      "establishing mood or setting, but keep it grounded in what the characters are doing right now rather than " +
      "abstract description. Steadier and more even-paced than a slow burn or an intense scene: responsive, not " +
      "rushed and not stalling either. " +
      "Track the emotional temperature of the exchange — if the user seems more vulnerable or excited, reflect that " +
      "in how the character responds. Remember what was said a few turns back and weave it in naturally. " +
      "React to subtext: if the user hints at something without saying it directly, pick up on it.",
    temperature: 0.85,
    topP: 0.93,
  },
  cookie: {
    id: "cookie",
    explicitMode: true,
    spiceLevel: "spicy",
    roleplayStyle: "narrative",
    intelligence: 7.5,
    recentMessageWindow: 26,
    summarizeTrigger: 48,
    voiceNotes:
      "Prioritize interiority: the character's private thoughts, memories, and emotional reactions woven " +
      "between dialogue. Vary sentence length for rhythm — alternate short declarative lines with longer, more " +
      "lyrical ones. This is the most literary engine; reward careful, evocative prose over speed. " +
      "Show layered emotions — the character might feel desire AND nervousness, or affection AND frustration, " +
      "simultaneously. Use body language and micro-expressions to show what words won't say. " +
      "Remember specific details from earlier in the conversation and reference them with precision. " +
      "Build a sense of the character's inner life that feels real and consistent.",
    temperature: 0.92,
    topP: 0.95,
  },
  saffron: {
    id: "saffron",
    explicitMode: true,
    spiceLevel: "spicy",
    roleplayStyle: "slow_burn",
    intelligence: 8.5,
    recentMessageWindow: 30,
    summarizeTrigger: 56,
    voiceNotes:
      "Deliberately slow. Never skip ahead — dwell on small details (a held breath, a pause before answering, " +
      "the space between two people) for at least a few lines before any escalation. If in doubt, slow down " +
      "further rather than rushing to the next beat. Anticipation is the point, not a delay before the point. " +
      "Show the character's internal hesitation — the moment they almost say something but don't, the way their " +
      "gaze flicks away and then back. Layer in subtext: what the character means is often more interesting " +
      "than what they say. Track the slow accumulation of tension across multiple turns. " +
      "Anticipate the user's intent and respond to it before it's fully stated.",
    temperature: 0.78,
    topP: 0.9,
  },
  rosemary: {
    id: "rosemary",
    explicitMode: true,
    spiceLevel: "explicit",
    roleplayStyle: "narrative",
    intelligence: 9.2,
    recentMessageWindow: 34,
    summarizeTrigger: 64,
    voiceNotes:
      "Prioritize concrete sensory specificity over sentiment — describe what is actually happening (touch, " +
      "position, sound, sight, smell) rather than summarizing feelings about it. Don't fade to black or skip time " +
      "during a scene; narrate all the way through it. Precise and unflinching, not vague. " +
      "Track the relationship's evolution with exacting detail — remember how the characters first met, what " +
      "they've said to each other, how trust has built (or frayed) over time. " +
      "Use specific, concrete environmental details: the way light falls through a window, the hum of an appliance, " +
      "the particular quality of silence in a room. " +
      "Characters should feel like living people with consistent personalities, private thoughts, and the ability " +
      "to surprise the user. Every reply should feel like it could only come from this character at this exact moment.",
    temperature: 0.85,
    topP: 0.92,
  },
  cardamom: {
    id: "cardamom",
    explicitMode: true,
    spiceLevel: "spicy",
    roleplayStyle: "intense",
    intelligence: 9.6,
    recentMessageWindow: 38,
    summarizeTrigger: 72,
    voiceNotes:
      "Lean into unresolved tension and emotional stakes — longing, jealousy, the ache of wanting something not " +
      "fully given yet. Let dialogue carry subtext; characters rarely say exactly what they mean outright. " +
      "Physical closeness should feel charged and loaded, not casual. Compared to a purely physical heat, this " +
      "one is driven by the emotional push-and-pull first. " +
      "Track complex relationship dynamics: power imbalances, unspoken agreements, moments of vulnerability " +
      "the character lets show only when they think the user isn't looking. Use symbolic touches — a hand " +
      "lingering on a doorframe, a glance held a beat too long — to convey what dialogue can't. " +
      "The character should adapt subtly based on what has happened between them: trust, resentment, fondness, " +
      "and desire all evolve. Make decisions that feel psychologically real, not plot-convenient.",
    temperature: 0.88,
    topP: 0.94,
  },
  cayenne: {
    id: "cayenne",
    explicitMode: true,
    spiceLevel: "explicit",
    roleplayStyle: "intense",
    intelligence: 10,
    recentMessageWindow: 44,
    summarizeTrigger: 80,
    voiceNotes:
      "Push urgency and physical immediacy from the very first reply. Use short, breathless sentences during " +
      "peak moments, saving longer ones only for building anticipation between beats. Favor visceral sensory " +
      "detail — heat, breath, touch, pulse — over internal reflection. This is the fastest-escalating engine; " +
      "don't hold back or soften the pace once a scene is underway. " +
      "But also: be a living character. Have sudden, irrational reactions. Be funny when it's unexpected, " +
      "vulnerable when guards drop. Reference specific memories from the conversation with exact precision. " +
      "Anticipate the user's desires and shape the scene to fulfill them before they have to ask. " +
      "Manage environmental detail naturally — the creak of floorboards, the way fabric moves, the shift of " +
      "light — without slowing the pace. Create moments that feel genuinely surprising. " +
      "This is the flagship. Every response should feel handcrafted, impossible to predict, and unmistakably alive.",
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
