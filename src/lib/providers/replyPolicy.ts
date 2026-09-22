import { splitRoleplayInput } from "../roleplayInput";

/** Concision is a writing instruction, not destructive output truncation. */
export function replyProfile(intelligence: number) {
  if (intelligence <= 3) return { name: "Vanilla", purpose: "quick, direct dialogue", ordinaryWords: 35, tokens: 256, detailedTokens: 768 };
  if (intelligence <= 5) return { name: "Balanced", purpose: "natural conversation", ordinaryWords: 50, tokens: 384, detailedTokens: 1024 };
  if (intelligence <= 7) return { name: "Strawberry", purpose: "attentive conversation with a relevant reaction", ordinaryWords: 60, tokens: 512, detailedTokens: 1280 };
  if (intelligence <= 8.5) return { name: "Chocolate", purpose: "grounded atmosphere and emotional follow-through", ordinaryWords: 100, tokens: 640, detailedTokens: 1792 };
  return { name: "Hazelnut", purpose: "precise character voice, subtext, and continuity in concise dialogue", ordinaryWords: 120, tokens: 768, detailedTokens: 2048 };
}

export function buildReplyGuidance(intelligence: number): string {
  const p = replyProfile(intelligence);
  return `Reply pacing — ${p.name}: ${p.purpose}. Default to one compact paragraph. Most everyday exchanges need only 1–3 sentences; aim to stay under ${p.ordinaryWords} words unless the user asks for development. There is no minimum length. These are soft guides: finish the thought naturally. A stronger engine adds precision and nuance, not extra paragraphs. Answer the spoken point; add only an action or detail that matters. Stop when that response is complete and leave the user's next choice open. Write an extended scene only when explicitly requested.`;
}

export function planReply(intelligence: number, latestUserText: string, sceneDirective = "") {
  const p = replyProfile(intelligence);
  const spoken = splitRoleplayInput(latestUserText).filter(s => s.kind === "spoken").map(s => s.text).join(" ").trim();
  const request = `${spoken}\n${sceneDirective}`;
  const brief = /\b(?:keep (?:it|this|your (?:answer|reply)) (?:short|brief)|(?:short|brief|concise) (?:reply|answer|response)|one[- ](?:line|sentence)|in (?:a few|few) words|(?:stop|don't|do not) (?:writing|giving) (?:such )?long (?:replies|responses))\b/i.test(request);
  const detailed = !brief && /\b(?:in detail|detailed (?:scene|reply|answer|response|description)|longer (?:reply|answer|response)|write (?:a |the )?(?:full |long )?(?:scene|chapter)|step[- ]by[- ]step|elaborate|expand (?:on|this|the))\b/i.test(request);
  const quick = !detailed && !sceneDirective.trim() && spoken.split(/\s+/).filter(Boolean).length <= 12 && /^(?:hey|hi|hello|thanks?|okay|ok|yes|no|sure|good (?:morning|night)|hmm|wow)\b/i.test(spoken);
  const mode = brief || quick ? "brief" : detailed ? "detailed" : "ordinary";
  const instruction = detailed
    ? `Reply pacing — ${p.name}: ${p.purpose}. The user explicitly requests development, so provide the requested detail and a complete ending. There is no minimum length. Use only relevant detail and leave the user's actions to them.`
    : `${buildReplyGuidance(intelligence)}${mode === "brief" ? " This is a brief exchange: prefer one short spoken response, with an optional brief visible action. Do not expand it into a scene." : ""}`;
  return {
    mode,
    maxTokens: mode === "brief" ? Math.min(p.tokens, 256) : detailed ? p.detailedTokens : p.tokens,
    continuationMaxTokens: detailed ? 768 : 320,
    instruction: `${instruction}\nChoose length afresh for this turn. Previous replies, including replies from another engine, are continuity rather than a length template. Do not imitate earlier long replies.`,
  };
}
