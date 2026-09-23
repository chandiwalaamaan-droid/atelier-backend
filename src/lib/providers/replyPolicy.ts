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
    tokens: 128,
    detailedTokens: 128,
  };
  if (intelligence <= 5) return {
    name: "Balanced",
    purpose: "natural conversation",
    ordinaryWords: 50,
    minWords: 40,
    maxWords: 60,
    tokens: 144,
    detailedTokens: 144,
  };
  if (intelligence <= 7) return {
    name: "Strawberry",
    purpose: "attentive conversation with a relevant reaction",
    ordinaryWords: 60,
    minWords: 50,
    maxWords: 70,
    // 104 tokens was too close to the 70-word ceiling for punctuation-heavy
    // roleplay text and could end with finish_reason=length mid-sentence.
    // 144 still keeps Strawberry materially cheaper than Chocolate while
    // leaving enough room for a natural stop inside its 50–70 word envelope.
    tokens: 144,
    detailedTokens: 144,
  };
  if (intelligence <= 8.5) return {
    name: "Chocolate",
    purpose: "grounded atmosphere and emotional follow-through",
    ordinaryWords: 100,
    minWords: 85,
    maxWords: 110,
    tokens: 224,
    detailedTokens: 224,
  };
  return {
    name: "Hazelnut",
    purpose: "precise character voice, subtext, continuity, and confident initiative",
    ordinaryWords: 120,
    minWords: 105,
    maxWords: 130,
    tokens: 256,
    detailedTokens: 256,
  };
}


/**
 * Hard server-side ceiling for a tier reply. Prompts are advisory; hosted
 * models can and do ignore requested word counts. Prefer the last complete
 * sentence near the ceiling so the saved/final reply stays coherent instead
 * of chopping a sentence at an arbitrary word.
 */
export function clampReplyToWordCeiling(text: string, maxWords: number, minWords = 0): string {
  const clean = text.trim();
  if (!clean || maxWords <= 0) return clean;

  const words = [...clean.matchAll(/\S+/g)];
  // Preserve the provider text byte-for-byte when it is already inside the
  // ceiling. This matters while streaming: trimming harmless trailing space
  // here can make a later continuation emit an extra separator.
  if (words.length <= maxWords) return text;

  const hard = words[maxWords - 1];
  const hardEnd = (hard.index ?? 0) + hard[0].length;
  const prefix = clean.slice(0, hardEnd);

  // Avoid collapsing a premium reply too far below its own minimum merely
  // because an early sentence happens to end well before the tier ceiling.
  const floorWord = Math.min(maxWords - 1, Math.max(0, Math.min(minWords, maxWords) - 1));
  const floor = words[floorWord];
  const floorEnd = floor ? (floor.index ?? 0) + floor[0].length : Math.floor(hardEnd * 0.7);

  let boundary = -1;
  let lastCompleteBoundary = -1;
  const sentenceEnd = /[.!?](?:[\"'”’)*_\]]*)?(?=\s|$)/g;
  for (const match of prefix.matchAll(sentenceEnd)) {
    const end = (match.index ?? 0) + match[0].length;
    lastCompleteBoundary = end;
    if (end >= floorEnd) boundary = end;
  }
  if (boundary > 0) return prefix.slice(0, boundary).trim();

  // Completeness beats mechanically hitting the tier minimum. If the model
  // started another long sentence that crosses the hard ceiling, keep the
  // last complete sentence even when it is a little below minWords; the
  // same-provider depth top-up can then add a fresh complete beat.
  if (lastCompleteBoundary > 0) return prefix.slice(0, lastCompleteBoundary).trim();

  // Last resort for one extremely long unpunctuated sentence: stay inside
  // the hard ceiling and terminate it cleanly rather than returning an
  // ellipsis that looks like a provider cutoff.
  const clipped = prefix.replace(/[\s,;:—-]+$/g, '').trim();
  return /[.!?](?:[\"'”’)*_\]]*)?$/.test(clipped) ? clipped : clipped + '.';
}

export function buildReplyGuidance(intelligence: number): string {
  const p = replyProfile(intelligence);
  return `TIER-LOCKED REPLY ENVELOPE — ${p.name}: ${p.purpose}. Every normal reply from this engine should land around ${p.ordinaryWords} words, normally ${p.minWords}–${p.maxWords} words. This length and quality level belong to the selected engine and stay stable regardless of whether the latest user message is one word, very long, action-only, casual, emotional, explicit, or asks for a shorter/longer answer. Adapt the CONTENT and emotional intensity to the turn, not the tier's response depth. Complete a coherent character beat within this envelope: respond to the actual point, add the amount of dialogue/action/subtext appropriate to ${p.name}, and finish naturally without filler. Treat ${p.maxWords} words as a finish line: start wrapping up before it, and do not begin a new sentence near the ceiling unless you can finish that sentence inside the envelope. Every sentence should add something new; do not restate the same emotion, gaze, blush, heartbeat, hesitation, posture, or invitation merely to fill the word target. Prefer one specific reaction plus meaningful dialogue/scene movement over several paraphrases of the same beat. Do not imitate the length of earlier replies or another engine.`;
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
    continuationMaxTokens: p.name === "Vanilla" ? 96 : p.name === "Strawberry" ? 128 : 160,
    // streamCompleteReply now withholds only the near-ceiling tail until it
    // knows the authoritative sentence-complete final text, so no tier needs
    // a "preserve an already hard-clipped stream" exception.
    preserveStreamedLength: false,
    targetWords: p.ordinaryWords,
    minWords: p.minWords,
    maxWords: p.maxWords,
    instruction: buildReplyGuidance(intelligence),
  };
}
