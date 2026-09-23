import type { GenParams } from "./index";
import { clampReplyToWordCeiling } from "./replyPolicy";

type Message = { role: "system" | "user" | "assistant"; content: string };
type Stream = (messages: Message[], onToken: (text: string) => void, signal?: AbortSignal, params?: GenParams) => Promise<string>;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Premium/locked tiers should not collapse to a one-liner just because a
 * provider ignored the prompt. This is intentionally a single bounded
 * same-provider continuation, not a regeneration: it preserves the reply
 * already streamed and asks only for the missing depth.
 */
function depthContinuationSuffix(previous: string, next: string): string {
  if (!next.trim()) return "";
  if (next.startsWith(previous)) return next.slice(previous.length);

  // Strip a repeated tail if the model echoed a little context before
  // continuing. Requiring a meaningful overlap avoids guessing joins.
  for (let n = Math.min(previous.length, next.length); n >= 24; n--) {
    if (previous.endsWith(next.slice(0, n))) return next.slice(n);
  }

  // Depth continuations are explicitly instructed to begin with NEW text, so
  // an un-repeated completion can be appended safely with natural spacing.
  const fresh = next.trimStart();
  if (!fresh) return "";
  return `${/\s$/.test(previous) || /^[,.;:!?]/.test(fresh) ? "" : " "}${fresh}`;
}

/** Same-provider recovery for token cutoffs plus one bounded tier-depth top-up after an abnormally short normal stop. */
export async function streamCompleteReply(stream: Stream, messages: Message[], onToken: (text: string) => void, signal?: AbortSignal, params?: GenParams) {
  let reason = "unknown";
  const capture = (value: string) => { reason = value; };
  const maxWords = params?.maxWords ?? 0;
  const minWords = params?.minWords ?? 0;

  // Vanilla/Strawberry have short hard ceilings, so a normal token stream can
  // easily expose part of a sentence that reply_final later has to remove.
  // For those two envelopes (<=70 words), only release sentence-complete
  // prefixes that are inside the ceiling. Chocolate/Hazelnut keep the old
  // fine-grained streaming behavior because their larger envelopes were not
  // exhibiting the snap-back bug and we do not want to regress their feel.
  let streamedVisible = "";
  let providerVisible = "";
  let streamCapped = false;
  const stabilizeShortTierStream = maxWords > 0 && maxWords <= 70;
  const cappedOnToken = maxWords > 0 ? (chunk: string) => {
    if (!chunk || streamCapped) return;
    providerVisible += chunk;

    if (stabilizeShortTierStream) {
      let safeEnd = -1;
      const sentenceEnd = /[.!?](?:[\"'”’)*_\]]*)?(?=\s|$)/g;
      for (const match of providerVisible.matchAll(sentenceEnd)) {
        const end = (match.index ?? 0) + match[0].length;
        const prefix = providerVisible.slice(0, end);
        if (countWords(prefix) <= maxWords) safeEnd = end;
        else break;
      }
      if (safeEnd > streamedVisible.length) {
        const safePrefix = providerVisible.slice(0, safeEnd);
        const addition = safePrefix.slice(streamedVisible.length);
        streamedVisible = safePrefix;
        if (addition) onToken(addition);
      }
      return;
    }

    const words = [...providerVisible.matchAll(/\S+/g)];
    if (words.length <= maxWords) {
      const addition = providerVisible.slice(streamedVisible.length);
      if (addition) {
        streamedVisible = providerVisible;
        onToken(addition);
      }
      return;
    }
    const last = words[maxWords - 1];
    const end = (last.index ?? 0) + last[0].length;
    const hardCapped = providerVisible.slice(0, end);
    const addition = hardCapped.slice(streamedVisible.length);
    if (addition) onToken(addition);
    streamedVisible = hardCapped;
    streamCapped = true;
  } : onToken;

  const rawText = await stream(messages, cappedOnToken, signal, { ...params, onFinish: capture });
  let text = maxWords > 0 ? clampReplyToWordCeiling(rawText, maxWords, minWords) : rawText;

  // For short tiers, release only text that survived final reconciliation.
  // Their live stream contains sentence-complete prefixes only, so final text
  // extends (or equals) what the user has already seen instead of replacing it.
  if (stabilizeShortTierStream && text.startsWith(streamedVisible)) {
    const deferred = text.slice(streamedVisible.length);
    if (deferred) {
      onToken(deferred);
      streamedVisible = text;
    }
  }

  let continuations = 0;

  // If the model ignored the prompt and already ran past the tier ceiling,
  // the saved/final reply is capped locally. Do not ask for an additional
  // continuation merely because the provider itself stopped on max_tokens.
  if (maxWords > 0 && countWords(rawText) > maxWords) reason = "stop";

  while (reason === "length" && text.trim() && !signal?.aborted && continuations < 2 && (!maxWords || countWords(text) < maxWords)) {
    continuations++;
    const anchor = text.slice(-160);
    const recovery: Message[] = [
      ...messages,
      { role: "assistant", content: text },
      { role: "system", content: `The previous output hit a token limit. Finish that same reply, without starting another scene or taking the user's turn. Begin by copying the exact tail below (including its spacing), then continue directly from its final character. Finish the pending thought and stop promptly. Do not explain the interruption.\n<reply_tail>${anchor}</reply_tail>` },
    ];
    reason = "unknown";
    try {
      // Buffer recovery so an echoed prefix never appears twice on screen.
      const next = await stream(recovery, () => {}, signal, {
        ...params, maxTokens: params?.continuationMaxTokens !== undefined
          ? Math.min(1024, Math.max(64, params.continuationMaxTokens))
          : Math.min(1024, Math.max(512, params?.maxTokens ?? 512)), onFinish: capture,
      });
      if (signal?.aborted) break;
      const suffix = continuationSuffix(text, next, anchor);
      if (!suffix) { reason = "length"; break; }
      const combined = maxWords > 0 ? clampReplyToWordCeiling(text + suffix, maxWords, minWords) : text + suffix;
      const accepted = combined.startsWith(text) ? combined.slice(text.length) : "";
      if (!accepted) { reason = maxWords > 0 && countWords(text) >= maxWords ? "stop" : "length"; break; }
      text = combined;
      onToken(accepted);
      if (maxWords > 0 && countWords(text) >= maxWords) reason = "stop";
    } catch {
      // Keep already-visible content; do not replace it with another provider.
      reason = "length";
      break;
    }
  }

  // A normal provider stop can still be far below the server-owned tier
  // minimum. Recover that once on the SAME provider so a greeting or tiny
  // user message cannot collapse Chocolate/Hazelnut (or any other tier) into
  // a one-liner. Unknown/content-filter/cancelled endings are never extended.
  const minimumWords = params?.minWords ?? 0;
  if (reason === "stop" && minimumWords > 0 && countWords(text) < minimumWords && text.trim() && !signal?.aborted) {
    const targetWords = Math.max(minimumWords, params?.targetWords ?? minimumWords);
    const currentWords = countWords(text);
    const missingWords = Math.max(1, targetWords - currentWords);
    const recovery: Message[] = [
      ...messages,
      { role: "assistant", content: text },
      { role: "system", content: `The assistant reply above stopped too early for this engine's fixed tier envelope. Continue that SAME assistant turn only, adding roughly ${missingWords} words of natural character-specific dialogue, action, atmosphere, or subtext until the COMPLETE reply is near ${targetWords} words. Start directly with new continuation text; do not restart, summarize, repeat the existing opening, take the user's turn, or begin a new scene. Finish naturally.` },
    ];
    let extensionReason = "unknown";
    try {
      const next = await stream(recovery, () => {}, signal, {
        ...params,
        // Scale the top-up budget to the amount actually missing. The old
        // fixed 320-token allowance could turn a 30-word top-up into another
        // full paragraph and push a 120-word tier close to 200 words.
        maxTokens: Math.min(
          params?.continuationMaxTokens ?? 160,
          Math.max(64, Math.ceil(missingWords * 1.8 + 24))
        ),
        onFinish: value => { extensionReason = value; },
      });
      if (!signal?.aborted) {
        const suffix = depthContinuationSuffix(text, next);
        if (suffix) {
          const combined = maxWords > 0 ? clampReplyToWordCeiling(text + suffix, maxWords, minimumWords) : text + suffix;
          const accepted = combined.startsWith(text) ? combined.slice(text.length) : "";
          if (accepted) {
            text = combined;
            onToken(accepted);
            reason = (maxWords > 0 && countWords(text) >= maxWords) || countWords(text) >= minimumWords
              ? "stop"
              : extensionReason;
          }
        }
      }
    } catch {
      // A tier-depth top-up is best-effort. Keep the valid first completion
      // instead of turning an otherwise successful reply into a provider fail.
    }
  }

  const finishReason = signal?.aborted ? "cancelled" : reason;
  params?.onFinish?.(finishReason);
  return { text, finishReason, continuations };
}

export function continuationSuffix(previous: string, next: string, anchor = previous.slice(-160)): string {
  if (next.startsWith(previous)) return next.slice(previous.length);
  const start = next.indexOf(anchor);
  if (start >= 0 && next.slice(0, start).trim() === "") return next.slice(start + anchor.length);
  // Some models strip leading whitespace from the requested tail.
  const trimmed = anchor.trimStart();
  if (trimmed && next.trimStart().startsWith(trimmed)) return next.trimStart().slice(trimmed.length);
  // Accept a shorter exact overlap, but never guess how to join an unfinished
  // word. An unanchored continuation stays flagged as incomplete for the UI.
  for (let n = Math.min(previous.length, next.length); n >= 24; n--) {
    if (previous.endsWith(next.slice(0, n))) return next.slice(n);
  }
  return "";
}
