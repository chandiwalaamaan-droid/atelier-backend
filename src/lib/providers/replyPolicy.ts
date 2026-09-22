import { splitRoleplayInput } from "../roleplayInput";

/** Concision is a writing instruction, not destructive output truncation. */
export function replyProfile(intelligence: number) {
  if (intelligence <= 3) return { name: "Vanilla", purpose: "quick, direct dialogue", ordinaryWords: 35, tokens: 256, detailedTokens: 768 };
  if (intelligence <= 5) return { name: "Balanced", purpose: "natural conversation", ordinaryWords: 50, tokens: 384, detailedTokens: 1024 };
  if (intelligence <= 7) return { name: "Strawberry", purpose: "attentive conversation with a relevant reaction", ordinaryWords: 60, tokens: 512, detailedTokens: 1280 };
  if (intelligence <= 8.5) return { name: "Chocolate", purpose: "grounded atmosphere and emotional follow-through", ordinaryWords: 100, tokens: 640, detailedTokens: 1792 };
  return { name: "Hazelnut", purpose: "precise character voice, subtext, and continuity", ordinaryWords: 120, tokens: 768, detailedTokens: 2048 };
}

/**
 * Ordinary pacing is tier-aware. The word values remain soft ceilings; this
 * wording prevents premium engines from treating a 768-token allowance like
 * a 256-token allowance while still letting tiny acknowledgements stay tiny.
 */
export function buildReplyGuidance(intelligence: number): string {
  const p = replyProfile(intelligence);
  const cadence = intelligence <= 3
    ? "Most everyday exchanges need 1–2 sentences."
    : intelligence <= 5
    ? "Most everyday exchanges need 1–3 sentences."
    : intelligence <= 7
    ? "Use enough room for a complete reaction; substantive turns often need 2–3 sentences."
    : intelligence <= 8.5
    ? "Do not default to a one-line reaction when the turn gives you material; substantive turns often need 2–4 sentences."
    : "Do not compress a meaningful turn into a one-line reaction; when there is material, develop one complete beat in roughly 2–5 sentences.";

  return `Reply pacing — ${p.name}: ${p.purpose}. ${cadence} Aim to stay under ${p.ordinaryWords} words unless the user asks for development. These are soft guides: finish the thought naturally and do not pad a moment that is genuinely brief. Answer the user's actual turn, then add only the character reaction, detail, or initiative that makes this beat feel complete. Write an extended scene only when explicitly requested.`;
}

function sceneTurnGuidance(intelligence: number): string {
  if (intelligence <= 5) return "";
  if (intelligence <= 7) {
    return " Scene-bearing turn: give one complete beat, not acknowledgement only—usually a relevant reaction plus dialogue or one useful action.";
  }
  if (intelligence <= 8.5) {
    return " Substantial scene-bearing turn: usually 35–80 words / 2–4 sentences. Carry the mood, one concrete detail, and a character-led response; don't pad or take the user's action.";
  }
  return " Substantial scene-bearing turn: usually 45–100 words / 2–5 sentences. Complete one layered beat with reaction/subtext, a grounded detail, dialogue, and one earned initiative; don't pad or take the user's action.";
}

/**
 * Short greetings/acknowledgements should stay cheap, but only when the whole
 * spoken turn is actually lightweight. Prefix-only matching made meaningful
 * turns such as "Yeah, but why did you lie?" inherit the 256-token brief path.
 */
function isQuickExchange(spoken: string): boolean {
  const clean = spoken.trim();
  if (!clean) return false;
  const opener = clean.match(/^(?:hey|hi|hello|thanks?|thank you|okay|ok|yeah+|yep+|yup+|yes|nope?|sure|got it|good (?:morning|night)|h+m+|m+h+m*|wow)\b[\s,!?.…-]*/i);
  if (!opener) return false;

  const tail = clean.slice(opener[0].length).trim();
  if (!tail) return true;
  if (/[?]/.test(tail)) return false;

  // A tiny vocative/approach tail is still a brief exchange ("okay mom",
  // "hello again", "hey come here"). Pronouns, contrast words, questions,
  // requests, feelings, or explanations mean the turn contains real content.
  const substantiveTail = /\b(?:i|i'm|im|we|you|he|she|they|but|because|why|what|where|when|who|how|tell|explain|show|help|need|want|think|feel|miss|love|hate|remember|wonder|found|lost|can|could|would|will|should|did|does|do|is|are|was|were)\b/i;
  if (substantiveTail.test(tail)) return false;

  return tail.split(/\s+/).filter(Boolean).length <= 3;
}

export function planReply(intelligence: number, latestUserText: string, sceneDirective = "") {
  const p = replyProfile(intelligence);
  const segments = splitRoleplayInput(latestUserText);
  const spoken = segments.filter(s => s.kind === "spoken").map(s => s.text).join(" ").trim();
  const narration = segments.filter(s => s.kind === "narration").map(s => s.text).join(" ").trim();
  const request = `${spoken}\n${sceneDirective}`;
  const brief = /\b(?:keep (?:it|this|(?:the|your) (?:answer|reply|response)) (?:short|brief|concise)|make (?:it|this|(?:the|your) (?:answer|reply|response)) (?:short|brief|concise)|(?:short|brief|concise) (?:reply|answer|response)|one[- ](?:line|sentence)|in (?:a few|few) words|(?:stop|don't|do not) (?:writing|giving) (?:such )?long (?:replies|responses))\b/i.test(request);
  const detailed = !brief && /\b(?:in detail|detailed (?:scene|reply|answer|response|description)|longer (?:reply|answer|response)|write (?:a |the )?(?:full |long )?(?:scene|chapter)|step[- ]by[- ]step|elaborate|expand (?:on|this|the))\b/i.test(request);
  const spokenWords = spoken.split(/\s+/).filter(Boolean).length;
  const narrationWords = narration.split(/\s+/).filter(Boolean).length;
  const quick = !detailed && !sceneDirective.trim() && spokenWords <= 12 && isQuickExchange(spoken);
  // Reserve the stronger word-range cue for turns with enough material to
  // support it. A tiny gesture such as *I sit down* should not force a
  // 45–100-word Hazelnut reply, while developed narration and mixed
  // action+dialogue still earn a fuller premium beat.
  const sceneBearing = !brief && !quick && (
    Boolean(sceneDirective.trim()) ||
    narrationWords >= 6 ||
    spokenWords >= 9 ||
    (narrationWords >= 3 && spokenWords >= 3)
  );
  const mode = brief || quick ? "brief" : detailed ? "detailed" : "ordinary";
  const instruction = detailed
    ? `Reply pacing — ${p.name}: ${p.purpose}. The user explicitly requests development, so provide the requested detail and a complete ending. Use only relevant detail and leave the user's actions to them.`
    : `${buildReplyGuidance(intelligence)}${mode === "brief" ? " This is a genuinely brief exchange: prefer one short spoken response, with an optional brief visible action. Do not expand it into a scene." : sceneBearing ? sceneTurnGuidance(intelligence) : ""}`;
  return {
    mode,
    sceneBearing,
    maxTokens: mode === "brief" ? Math.min(p.tokens, 256) : detailed ? p.detailedTokens : p.tokens,
    continuationMaxTokens: detailed ? 768 : 320,
    instruction: `${instruction}\nChoose length afresh for this turn. Previous replies, including replies from another engine, are continuity rather than a length template. Do not imitate earlier reply length mechanically.`,
  };
}
