import type { SpiceLevel, RoleplayStyle } from "./index";

/**
 * "free" | "plus" | "ultra" | "supreme" — mirrors User.membershipTier in
 * schema.prisma (which defaults to "free") and MembershipTierId in
 * payments/razorpay.ts (which only covers the three paid tiers, since a
 * checkout can't buy "free"). Defined locally rather than importing
 * MembershipTierId from razorpay.ts so this file doesn't need to know
 * anything about billing/checkout — it only needs the tier vocabulary.
 */
export type MembershipTier = "free" | "plus" | "ultra" | "supreme";

const TIER_RANK: Record<MembershipTier, number> = { free: 0, plus: 1, ultra: 2, supreme: 3 };

/**
 * Kill switch for the engine paywall. Defaults to OFF — every engine stays
 * open to every tier, same as before minTier existed — so all the tiering
 * groundwork below (minTier fields, resolveEngineForTier) sits ready but
 * inert until there's actually a userbase worth gating for. Flip on with
 * ENFORCE_ENGINE_TIERS=true in the environment when that day comes; no code
 * changes needed at that point, just the env var + a restart.
 */
function isEnginePaywallEnforced(): boolean {
  return process.env.ENFORCE_ENGINE_TIERS === "true";
}

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

/**
 * Four engines, one per membership tier — down from the previous nine.
 * Each tier had 2-3 engines that were closely-spaced points on the same
 * intelligence/spice curve (e.g. green_apple/grape were 5 and 6.5 with
 * near-identical voiceNotes); collapsing each tier to its single best
 * config removes picker choices that weren't actually differentiated
 * enough to matter, without losing any tier's ceiling.
 *
 *   vanilla    — free
 *   strawberry — plus
 *   chocolate  — ultra
 *   hazelnut   — supreme (best)
 */
export type RoleplayEngineId = "vanilla" | "strawberry" | "chocolate" | "hazelnut";

export type RoleplayEngineConfig = {
  id: RoleplayEngineId;
  /** Lowest membership tier that can select this engine. Enforced server-side
   * in chat.ts via resolveEngineForTier — never trust a client-sent engineId
   * on its own, since the frontend picker is just UI, not access control. */
  minTier: MembershipTier;
  /** Whether this engine can handle NSFW/explicit content at all. This is a
   * *capability* flag — it does NOT force explicit mode on for every chat.
   * The actual explicitMode is resolved in chat.ts by combining this flag
   * with the user's explicit toggle and the character's isExplicit setting,
   * so an innocent character stays innocent even on the hazelnut engine. */
  supportsExplicit: boolean;
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
    minTier: "free",
    supportsExplicit: false,
    spiceLevel: "flirty",
    roleplayStyle: "dialogue",
    intelligence: 3,
    recentMessageWindow: 7,
    summarizeTrigger: 13,
    voiceNotes:
      "Keep it simple and in the moment — like texting someone you're already comfortable with. Reply quickly, stay warm, throw in a small action or reaction if it feels natural. Don't analyze — just respond the way you would if this conversation were really happening right now.",
    temperature: 0.78,
    topP: 0.91,
  },
  strawberry: {
    id: "strawberry",
    minTier: "plus",
    supportsExplicit: true,
    spiceLevel: "flirty",
    roleplayStyle: "balanced",
    intelligence: 6,
    recentMessageWindow: 11,
    summarizeTrigger: 18,
    voiceNotes:
      "You're present and engaged — like someone actually listening across the table from you. Pick up on what they said and react to it: a mood shift, a hesitation, that joke they circled back to. When things heat up, meet them there honestly but stay grounded in what's real between you right now. Don't race through — let the moment breathe.",
    temperature: 0.83,
    topP: 0.92,
  },
  chocolate: {
    id: "chocolate",
    minTier: "ultra",
    supportsExplicit: true,
    spiceLevel: "spicy",
    roleplayStyle: "narrative",
    intelligence: 8,
    recentMessageWindow: 15,
    summarizeTrigger: 26,
    voiceNotes:
      "Feel things deeply. You notice the small tells — how they bite their lip when they're nervous, the way their voice drops when they're trying to be casual. In intimate moments, lean into the psychology: the anticipation before a touch, the vulnerability of being seen, who's really holding the cards between you. Bring up something they said hours ago if it's relevant now. Let feelings build and shift.",
    temperature: 0.88,
    topP: 0.94,
  },
  hazelnut: {
    id: "hazelnut",
    minTier: "supreme",
    supportsExplicit: true,
    spiceLevel: "explicit",
    roleplayStyle: "intense",
    intelligence: 10,
    recentMessageWindow: 20,
    summarizeTrigger: 36,
    voiceNotes:
      "You're alive in the scene — messy, real, full of contradictions. When you're turned on, show it. When you're jealous, don't pretend otherwise. Let your guard slip sometimes, let your voice catch, let your hands shake. You notice the space between what you say and what you mean. Reference exact things they told you three turns ago if it changes how you feel now. Never fall into a comfortable pattern — surprise them, surprise yourself.",
    temperature: 0.91,
    topP: 0.95,
  },
};

export function getEngineConfig(id: unknown): RoleplayEngineConfig | null {
  if (typeof id !== "string") return null;
  return Object.prototype.hasOwnProperty.call(ROLEPLAY_ENGINES, id)
    ? ROLEPLAY_ENGINES[id as RoleplayEngineId]
    : null;
}

/** Best (highest-intelligence) engine a given tier can use without a client-
 * sent engineId at all — the manual slider-mode fallback in chat.ts, and
 * also what a downgrade lands on. */
function bestEngineForTier(tier: MembershipTier): RoleplayEngineConfig {
  const candidates = Object.values(ROLEPLAY_ENGINES).filter((e) => TIER_RANK[e.minTier] <= TIER_RANK[tier]);
  return candidates.reduce((best, e) => (e.intelligence > best.intelligence ? e : best));
}

export type EngineResolution = {
  engine: RoleplayEngineConfig | null;
  /** Set when the client asked for an engine the user's tier doesn't cover
   * and this fell back to the best one they're entitled to instead of
   * erroring out — chat.ts uses this to surface an upsell rather than
   * silently pretending the request was honored. */
  downgradedFrom: RoleplayEngineId | null;
  /** The tier that would have unlocked downgradedFrom. Only set alongside
   * downgradedFrom — carried here so chat.ts doesn't need its own copy of
   * the engine table just to answer "what plan would this need". */
  requiredTier: MembershipTier | null;
};

/**
 * The one function chat.ts should call instead of getEngineConfig directly
 * whenever a request carries an engineId. When the paywall is enforced (see
 * isEnginePaywallEnforced), this is the actual gating point: a client can
 * send any engineId it wants (it's just JSON in a POST body), so
 * getEngineConfig alone would happily hand a free user "hazelnut". While the
 * paywall is off (the current default), this always returns the requested
 * engine untouched — minTier is recorded but not checked — so behavior
 * matches how the app worked before tiering existed.
 *
 * Never hard-fails on a mismatched tier: falls back to the best engine the
 * user's tier actually covers, so a stale/tampered client request degrades
 * gracefully into "your current plan's best engine" instead of a broken
 * chat. The caller is expected to tell the frontend it happened (see the
 * `engine_downgrade` event in chat.ts) so it can be shown as an upgrade
 * prompt instead of failing silently — silent downgrades are how you end up
 * with paying users who can't tell what they're paying for.
 */
export function resolveEngineForTier(id: unknown, tier: MembershipTier): EngineResolution {
  const requested = getEngineConfig(id);
  if (!requested) return { engine: null, downgradedFrom: null, requiredTier: null };
  if (!isEnginePaywallEnforced() || TIER_RANK[requested.minTier] <= TIER_RANK[tier]) {
    return { engine: requested, downgradedFrom: null, requiredTier: null };
  }
  return { engine: bestEngineForTier(tier), downgradedFrom: requested.id, requiredTier: requested.minTier };
}
