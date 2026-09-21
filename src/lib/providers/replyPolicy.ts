/** Pacing is guidance; token ceilings are emergency budgets, never targets. */
export function replyProfile(intelligence: number) {
  if (intelligence <= 3) return { name: "Vanilla", purpose: "quick, direct dialogue", words: "15–60", tokens: 512 };
  if (intelligence <= 5) return { name: "Balanced", purpose: "natural conversation", words: "25–90", tokens: 640 };
  if (intelligence <= 7) return { name: "Strawberry", purpose: "an attentive exchange with room for a reaction and relevant detail", words: "40–130", tokens: 896 };
  if (intelligence <= 8.5) return { name: "Chocolate", purpose: "a developed scene with dialogue, atmosphere, and emotional follow-through", words: "90–220", tokens: 1536 };
  return { name: "Hazelnut", purpose: "immersive, nuanced scenes with coherent subtext and continuity", words: "120–320", tokens: 2048 };
}

export function buildReplyGuidance(intelligence: number): string {
  const p = replyProfile(intelligence);
  return `Reply pacing — ${p.name}: ${p.purpose}. For a substantive ordinary turn, roughly ${p.words} words is a useful guide, not a quota or a hard limit. There is no minimum length. A greeting or acknowledgment may need only a line. A requested detailed scene or explanation can use more room. Complete the response to the user's turn and finish the thought before stopping; leave the user's next choice open. Never pad to reach a count or omit an ending to meet one.`;
}

export function planReply(intelligence: number, latestUserText: string, sceneDirective = "") {
  const p = replyProfile(intelligence);
  const request = `${latestUserText}\n${sceneDirective}`;
  // Only clear instructions change the budget. Message size is not intent.
  const brief = /\b(?:keep (?:it|this|your (?:answer|reply)) (?:short|brief)|(?:short|brief|concise) (?:reply|answer|response)|one[- ](?:line|sentence)|in (?:a few|few) words)\b/i.test(request);
  const detailed = /\b(?:in detail|detailed (?:scene|reply|answer|response|description)|longer (?:reply|answer|response)|write (?:a |the )?(?:full |long )?(?:scene|chapter)|step[- ]by[- ]step|elaborate|expand (?:on|this|the))\b/i.test(request);
  return {
    maxTokens: brief ? Math.min(p.tokens, 512) : detailed ? Math.ceil(p.tokens * 1.5) : p.tokens,
    instruction: `${buildReplyGuidance(intelligence)}\nReassess length for THIS turn using the selected engine and the current request. Previous replies are continuity, not a length or paragraph template, including replies written using another engine. ${brief ? "The current request asks for brevity: prioritize a compact, complete answer." : detailed ? "The current request asks for development: give the requested detail and a complete ending without taking over the user's actions." : "Choose the amount of detail the current exchange needs; do not automatically repeat the previous reply's length."}`,
  };
}
