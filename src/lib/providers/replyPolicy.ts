/**
 * Reply length and quality are engine properties, not user-message properties.
 * A one-word greeting, long narration, action-only turn, or a request to be
 * "short"/"detailed" must not collapse or inflate the selected tier.
 *
 * The word bands below are intentionally narrow enough to make engines feel
 * consistent while leaving a little room to finish a sentence naturally.
 */
export function replyProfile(intelligence: number) {
  if (intelligence <= 3) return {
    name: "Vanilla",
    purpose: "quick, direct dialogue",
    ordinaryWords: 35,
    minWords: 25,
    maxWords: 45,
    tokens: 256,
    detailedTokens: 256,
  };
  if (intelligence <= 5) return {
    name: "Balanced",
    purpose: "natural conversation",
    ordinaryWords: 50,
    minWords: 40,
    maxWords: 60,
    tokens: 384,
    detailedTokens: 384,
  };
  if (intelligence <= 7) return {
    name: "Strawberry",
    purpose: "attentive conversation with a relevant reaction",
    ordinaryWords: 60,
    minWords: 50,
    maxWords: 70,
    tokens: 512,
    detailedTokens: 512,
  };
  if (intelligence <= 8.5) return {
    name: "Chocolate",
    purpose: "grounded atmosphere and emotional follow-through",
    ordinaryWords: 100,
    minWords: 85,
    maxWords: 110,
    tokens: 640,
    detailedTokens: 640,
  };
  return {
    name: "Hazelnut",
    purpose: "precise character voice, subtext, continuity, and confident initiative",
    ordinaryWords: 120,
    minWords: 105,
    maxWords: 130,
    tokens: 768,
    detailedTokens: 768,
  };
}

export function buildReplyGuidance(intelligence: number): string {
  const p = replyProfile(intelligence);
  return `TIER-LOCKED REPLY ENVELOPE — ${p.name}: ${p.purpose}. Every normal reply from this engine should land around ${p.ordinaryWords} words, normally ${p.minWords}–${p.maxWords} words. This length and quality level belong to the selected engine and stay stable regardless of whether the latest user message is one word, very long, action-only, casual, emotional, explicit, or asks for a shorter/longer answer. Adapt the CONTENT and emotional intensity to the turn, not the tier's response depth. Complete a coherent character beat within this envelope: respond to the actual point, add the amount of dialogue/action/subtext appropriate to ${p.name}, and finish naturally without filler. Do not imitate the length of earlier replies or another engine.`;
}

/**
 * The planner is deliberately input-invariant. It keeps the existing call
 * signature because chat.ts passes the latest turn and scene directive, but
 * those values must never change a named engine's length/quality budget.
 */
export function planReply(intelligence: number, _latestUserText: string, _sceneDirective = "") {
  const p = replyProfile(intelligence);
  return {
    mode: "tier" as const,
    maxTokens: p.tokens,
    continuationMaxTokens: 320,
    targetWords: p.ordinaryWords,
    minWords: p.minWords,
    maxWords: p.maxWords,
    instruction: buildReplyGuidance(intelligence),
  };
}
