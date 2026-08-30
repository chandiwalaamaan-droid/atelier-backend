import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { asyncHandler } from "../lib/asyncHandler";
import { prisma } from "../lib/db";
import { getCurrentUserId } from "../lib/auth";
import { checkRateLimit } from "../lib/rateLimit";
import {
  buildSystemPrompt,
  streamChatWithFallback,
  summarizeConversation,
  listAvailableProviders,
  RECENT_MESSAGE_WINDOW,
  SUMMARIZE_TRIGGER,
  isGroqConfigured,
  getGroqKeys,
  synthesizeGroqSpeech,
  splitForSpeech,
  concatWavBuffers,
  TTS_VOICES,
  parseSpiceLevel,
  parseRoleplayStyle,
  cleanAssistantResponse,
  withPersonaAnchor,
  countSentences,
  getLengthCeiling,
  extractFlushableSentences,
  countActions,
  enforceActionCap,
  enforceLengthCeiling,
  actionCapForIntelligence,
  maxTokensForIntelligence,
} from "../lib/providers";
import type { TtsVoice } from "../lib/providers";
import { resolveEngineForTier, type MembershipTier } from "../lib/providers/engines";
import { computeRelationshipLevel } from "../lib/relationship";

const router = Router();

const MAX_MESSAGE_LENGTH = 4000;

// POST /api/chat/bulk-delete — wipes conversation history (messages + memory)
// for a set of characters, or for every character the user owns, in one go.
// This mirrors the existing DELETE /:characterId "reset conversation"
// behavior but scoped to many characters at once, so the "manage chat
// history" screen can offer per-chat checkboxes plus a "delete all" option
// without needing N round trips. Characters themselves are never touched —
// only their messages/memory — same as the single-chat reset.
//
// IMPORTANT: this must stay registered before the generic
// `POST /:characterId` route below, or Express would match "/bulk-delete"
// as characterId="bulk-delete" and try to send a chat message instead.
router.post("/bulk-delete", asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const body = req.body ?? {};
  const all = body.all === true;
  const requestedIds: string[] = Array.isArray(body.characterIds)
    ? body.characterIds.filter((id: unknown): id is string => typeof id === "string")
    : [];

  if (!all && requestedIds.length === 0) {
    return res.status(400).json({ error: "Select at least one chat to delete, or pass all: true." });
  }

  // Only ever touch characters the caller actually owns — requestedIds is
  // client-supplied, so this scoping is what keeps it safe.
  const owned = await prisma.character.findMany({
    where: all ? { ownerId: userId } : { ownerId: userId, id: { in: requestedIds } },
    select: { id: true },
  });
  const ownedIds = owned.map((c: { id: string }) => c.id);

  if (ownedIds.length === 0) {
    return res.json({ ok: true, deletedCount: 0 });
  }

  await prisma.message.deleteMany({ where: { characterId: { in: ownedIds }, userId } });
  await prisma.character.updateMany({
    where: { id: { in: ownedIds } },
    data: { memorySummary: "", summarizedThrough: 0, explicitEverUsed: false },
  });

  return res.json({ ok: true, deletedCount: ownedIds.length });
}));

router.get("/:characterId", asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const { characterId } = req.params;
  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character || character.ownerId !== userId) {
    return res.status(404).json({ error: "Character not found." });
  }

  const messages = await prisma.message.findMany({
    where: { characterId, userId },
    orderBy: { createdAt: "asc" },
  });

  const relationshipLevel = computeRelationshipLevel(messages.length, character.explicitEverUsed);

  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res.json({ character, messages, relationshipLevel });
}));

// Events (provider failover, stream end) are interleaved with reply text using an
// out-of-band marker the frontend strips before display: \x00EVT:{...json...}\x00
function encodeEvent(event: Record<string, unknown>) {
  return `\u0000EVT:${JSON.stringify(event)}\u0000`;
}

router.post("/:characterId", asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const { characterId } = req.params;

  const limit = checkRateLimit(`chat:${userId}`, 30, 60);
  if (limit.limited) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({
      error: "You're sending messages faster than the free-tier providers can keep up with. Please slow down a bit.",
    });
  }

  const [character, requestingUser] = await Promise.all([
    prisma.character.findUnique({ where: { id: characterId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { membershipTier: true } }),
  ]);
  if (!character || character.ownerId !== userId) {
    return res.status(404).json({ error: "Character not found." });
  }
  const membershipTier = (requestingUser?.membershipTier as MembershipTier | undefined) ?? "free";

  const body = req.body ?? {};
  const isRegenerate = body.regenerate === true;
  const editMessageId = typeof body.editMessageId === "string" ? body.editMessageId : null;
  const editContent = typeof body.editContent === "string" ? body.editContent.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
  const isEdit = editMessageId !== null;
  const userMessage = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
  // explicitMode is controlled by the chat UI toggle. Any signed-in user may
  // enable it for their private conversations — not limited to isExplicit characters.
  // If the client sent a named engine id (from the roleplay-engine picker),
  // its config is the source of truth — explicitMode/spiceLevel/
  // roleplayStyle/voiceNotes/temperature all come from this fixed,
  // server-owned list (see providers/engines.ts), not from the client
  // directly. Falls back to the older raw explicitMode/spiceLevel/
  // roleplayStyle body fields for any client that isn't sending an
  // engineId yet (manual slider mode).
  //
  // resolveEngineForTier is the actual paywall enforcement: a client can
  // send any engineId it wants (it's just JSON in a POST body), so
  // getEngineConfig alone would happily hand a free user "hazelnut". This
  // checks body.engineId against requestingUser.membershipTier and, if the
  // user isn't entitled to it, transparently substitutes the best engine
  // their plan does cover rather than erroring the request out.
  const { engine, downgradedFrom, requiredTier } = resolveEngineForTier(body.engineId, membershipTier);
  // explicitMode is the intersection of the engine's capability and the
  // client's explicit toggle. The toggle (set by the frontend based on the
  // character's isExplicit flag + user preference) is the user's actual
  // intent — for 18+ characters, it's true; for innocent characters, it's
  // false. AND-ing it with engine.explicitMode ensures that even when a
  // named engine is used (which all have explicitMode: true), an innocent
  // character still gets the SFW provider chain (NVIDIA-first), not the
  // explicit chain (Groq-first). Only when both the engine supports it AND
  // the client wants it does the explicit chain activate.
  const clientExplicitMode = body.explicitMode === true;
  const explicitMode = engine ? engine.explicitMode && clientExplicitMode : clientExplicitMode;
  const spiceLevel = engine ? engine.spiceLevel : explicitMode ? parseSpiceLevel(body.spiceLevel) : undefined;
  const roleplayStyle = engine ? engine.roleplayStyle : explicitMode ? parseRoleplayStyle(body.roleplayStyle) : undefined;
  const voiceNotes = engine?.voiceNotes;
  const intelligence = engine?.intelligence ?? 5;
  // Hazelnut gets Groq tried before NVIDIA (everything after those two —
  // SambaNova, Cloudflare, Ollama — is unaffected); every other engine, and
  // manual/no-engine requests, keep the default NVIDIA-first order. See
  // buildChain's comment in providers/index.ts for the full chain order.
  // explicitMode reorders the chain for NSFW chats: Groq -> SambaNova ->
  // Cloudflare -> NVIDIA -> Ollama, so NVIDIA only answers NSFW as a last
  // resort. SFW chats use the default NVIDIA-first chain.
  const maxTokens = maxTokensForIntelligence(intelligence);
  const genParams = engine
    ? { temperature: engine.temperature, topP: engine.topP, maxTokens, preferGroqFirst: engine.id === "hazelnut", explicitMode }
    : { maxTokens, explicitMode };
  const recentWindow = engine?.recentMessageWindow ?? RECENT_MESSAGE_WINDOW;
  const summarizeTrigger = engine?.summarizeTrigger ?? SUMMARIZE_TRIGGER;
  const sceneDirective =
    typeof body.sceneDirective === "string" ? body.sceneDirective.trim().slice(0, 500) : undefined;

  if (!isRegenerate && !isEdit && !userMessage && !sceneDirective) {
    return res.status(400).json({ error: "Message can't be empty." });
  }
  if (isEdit && !editContent) {
    return res.status(400).json({ error: "Message can't be empty." });
  }

  const available = await listAvailableProviders();
  if (available.length === 0) {
    return res.status(502).json({
      error:
        "No chat provider is available. Add a GROQ_API_KEY, NVIDIA_API_KEY, or SAMBANOVA_API_KEY to .env, or make sure " +
        "Ollama is installed and running locally (see README), then try again.",
    });
  }

  let regenTargetId: string | null = null;
  if (isEdit) {
    const target = await prisma.message.findFirst({
      where: { id: editMessageId as string, characterId, userId, role: "user" },
    });
    if (!target) {
      return res.status(404).json({ error: "That message couldn't be found." });
    }
    const positionAmongAll =
      (await prisma.message.count({
        where: { characterId, userId, createdAt: { lt: target.createdAt } },
      })) + 1;
    if (positionAmongAll <= character.summarizedThrough) {
      return res.status(400).json({ error: "That message is too old to edit." });
    }
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT id FROM \`Message\` WHERE id = ${target.id} FOR UPDATE`;
      await tx.message.deleteMany({
        where: { characterId, userId, createdAt: { gt: target.createdAt } },
      });
      await tx.message.update({ where: { id: target.id }, data: { content: editContent } });
    });
  } else if (isRegenerate) {
    // "regenerate" covers two cases: redoing an existing reply (last message
    // is the assistant's — mark it for replacement), or retrying a turn
    // where every provider failed last time (last message is still the
    // user's — nothing to replace, just try again).
    const last = await prisma.message.findFirst({
      where: { characterId, userId },
      orderBy: { createdAt: "desc" },
    });
    if (!last) {
      return res.status(400).json({ error: "Nothing to regenerate yet." });
    }
    if (last.role === "assistant") regenTargetId = last.id;
  } else if (userMessage) {
    await prisma.message.create({
      data: { characterId, userId, role: "user", content: userMessage },
    });
  }

  const allSinceSummary = await prisma.message.findMany({
    where: { characterId, userId },
    orderBy: { createdAt: "asc" },
    skip: character.summarizedThrough,
  });

  const relevant = regenTargetId
    ? allSinceSummary.filter((m: { id: string }) => m.id !== regenTargetId)
    : allSinceSummary;
  // `relevant` is everything since the last summarization fold — it's
  // either recent enough to send verbatim, or old enough that
  // maybeSummarize (below, after the reply streams) is about to fold it
  // into memorySummary. Slicing straight down to recentWindow here, before
  // that fold has actually happened, silently drops whatever sits between
  // the two thresholds: e.g. Strawberry sends 11 messages verbatim but
  // only summarizes once there are 18 unsummarized, so messages 12-17 back
  // were neither shown raw nor folded into memory — just gone from the
  // model's context. maybeSummarize keeps `relevant` naturally bounded to
  // roughly summarizeTrigger messages in the steady state, so sending it
  // in full closes that gap; the length check below is only a safety net
  // for if summarization has been failing/lagging for a while, not the
  // normal path.
  const recentHistory = relevant.length <= summarizeTrigger * 2 ? relevant : relevant.slice(-recentWindow);

  // Gap between the character's last reply and the user's latest message —
  // what powers buildTimeAwarenessBlock (see its comment in providers/
  // index.ts for why this is worth computing). Pure Date math over rows
  // already fetched above, so this costs nothing extra: no query, no
  // tokens unless the resulting block actually gets included. Takes the
  // last two entries of the *full* filtered history rather than
  // recentHistory, since a long-idle chat could in principle have a
  // window smaller than 2 — recentWindow only trims which turns are sent
  // verbatim, it shouldn't be able to hide the gap we're measuring.
  let minutesSinceLastMessage: number | undefined;
  const gapPair = relevant.slice(-2);
  if (gapPair.length === 2 && gapPair[0].role === "assistant" && gapPair[1].role === "user") {
    minutesSinceLastMessage = (gapPair[1].createdAt.getTime() - gapPair[0].createdAt.getTime()) / 60000;
  }

  const system = buildSystemPrompt(character, {
    explicitMode,
    spiceLevel,
    roleplayStyle,
    sceneDirective,
    voiceNotes,
    engine,
    minutesSinceLastMessage,
  });
  const chatMessages = [
    { role: "system" as const, content: system },
    ...recentHistory.map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];
  // Re-assert identity immediately before generation (~15-20 tokens) so long
  // conversations don't drift the model away from the persona block sitting
  // up in `system` — see buildPersonaAnchor's comment for why this works
  // and why it's cheap. Skipped when there's no trailing user turn to
  // anchor onto (pure regenerate-with-nothing-new-to-say edge case) so it
  // never silently adds a phantom user message to a real conversation.
  if (chatMessages[chatMessages.length - 1]?.role === "user") {
    withPersonaAnchor(chatMessages, character, intelligence);
  }

  res.set({
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });

  // Surface the paywall downgrade to the client (unlike provider failover
  // above, this one names names on purpose — it's the hook for an upgrade
  // prompt, not something to hide). Sent before streaming starts so the
  // frontend can show "this reply is using {engine.id}, upgrade for
  // {downgradedFrom}" alongside the reply rather than after the fact.
  if (downgradedFrom && engine) {
    res.write(
      encodeEvent({
        type: "engine_downgrade",
        requested: downgradedFrom,
        used: engine.id,
        requiredTier,
      })
    );
  }

  // The frontend's "Stop" button aborts its fetch(), which closes this
  // connection from the client side — surfaced here as the request stream
  // closing early. Wiring that into an AbortSignal lets the fallback chain
  // stop paying for tokens nobody will see, while still keeping (and
  // saving) whatever text had already streamed out.
  const stopController = new AbortController();
  req.on("close", () => stopController.abort());

  try {
    // Live-stream length cutoff, plus sentence-boundary buffering so the
    // browser never sees a fragment cut off mid-sentence or mid-action.
    //
    // Raw provider chunks arrive as arbitrary token-sized pieces — they
    // don't line up with sentence or *action* boundaries. Previously each
    // chunk was forwarded to res.write the instant it arrived, which is
    // fine while the model is still generating (the fragment fills in a
    // moment later) but breaks the moment generation actually stops
    // mid-sentence: either because the length ceiling below fires and
    // aborts the provider, or because the provider itself hits its own
    // hard token cap. In both cases whatever partial fragment had already
    // been written stays on screen, incomplete, forever.
    //
    // pendingBuffer holds back whatever hasn't yet resolved into a
    // complete, displayable unit (extractFlushableSentences decides what
    // counts — see providers/index.ts for the two boundary kinds it
    // recognizes). Only the resolved `flush` portion ever reaches
    // res.write; streamedSoFar (used for the ceiling check) tracks that
    // same displayed text, not the raw stream, so the sentence count
    // being checked is always sentences the user has actually seen in
    // full.
    let pendingBuffer = "";
    let pendingAsteriskCount = 0;
    let streamedSoFar = "";
    let ceilingHit = false;
    const lengthCeiling = getLengthCeiling(intelligence);
    // Same live-stream backstop as the sentence ceiling above, but for
    // stacked *action* beats. Under the updated prompt convention, `*...*`
    // is ONLY for action beats (never italics/emphasis), so every complete
    // asterisk pair counts as one action. Tier-scaled via
    // actionCapForIntelligence — same source of truth enforceActionCap's
    // cleanup pass uses, so the two never disagree. This live check can
    // only abort *after* a complete action has already flushed to the
    // browser (flush granularity is whole units, not character-by-
    // character), so it necessarily lags the cleanup pass by one beat —
    // exactly the same asymmetry the sentence ceiling above already accepts
    // (see its comment).
    const MAX_ACTIONS_LIVE = actionCapForIntelligence(intelligence);

    const { text: fullText, provider } = await streamChatWithFallback(
      chatMessages,
      (chunk) => {
        if (ceilingHit) return;
        pendingBuffer += chunk;
        const { flush, rest, asteriskCount } = extractFlushableSentences(pendingBuffer, pendingAsteriskCount, false);
        pendingBuffer = rest;
        pendingAsteriskCount = asteriskCount;
        if (!flush) return;

        // Check the cap against the CANDIDATE text before writing anything
        // — not after, the way this used to work. Fast providers (most of
        // this app's fallback chain) return the whole reply in one or two
        // chunks rather than token-by-token, so "write flush, then check"
        // meant the entire uncapped reply was already on the wire by the
        // time the check fired; the visible fix was only a same-length
        // save-time trim landing ~half a second later via refreshMessages,
        // which read as the reply generating huge then shrinking. Trimming
        // the candidate BEFORE writing means what's streamed live already
        // equals what gets saved — nothing to swap in after the fact.
        const candidate = streamedSoFar + flush;
        const overSentences = countSentences(candidate) >= lengthCeiling;
        const overActions = countActions(candidate) > MAX_ACTIONS_LIVE;

        if (overSentences || overActions) {
          // Same enforcement cleanAssistantResponse applies at save-time,
          // run here on the candidate so the two never disagree.
          let trimmed = enforceActionCap(candidate, MAX_ACTIONS_LIVE);
          trimmed = enforceLengthCeiling(trimmed, intelligence);
          const toWrite = trimmed.slice(streamedSoFar.length);
          if (toWrite) {
            streamedSoFar += toWrite;
            res.write(toWrite);
          }
          ceilingHit = true;
          stopController.abort();
          return;
        }

        streamedSoFar += flush;
        res.write(flush);
      },
      () => {
        // Intentionally no provider names sent to the browser — users
        // shouldn't be able to see which backend(s) power the chat, even by
        // reading the network tab. The toast on the client is generic.
        res.write(encodeEvent({ type: "failover" }));
      },
      stopController.signal,
      genParams
    );

    // Generation ended (naturally, or the provider's own hard token cap
    // kicked in) without ever crossing the length ceiling above. Anything
    // still in pendingBuffer needs one last isFinal pass: a trailing
    // complete sentence that just never got a chance to see more input
    // after it (e.g. the very last token of the whole reply) gets flushed
    // now; a genuinely incomplete scrap — an unclosed *action, or plain
    // text with no terminal punctuation because the provider was cut off
    // mid-thought — gets dropped instead of shown broken.
    if (!ceilingHit && pendingBuffer) {
      const { flush } = extractFlushableSentences(pendingBuffer, pendingAsteriskCount, true);
      if (flush) {
        streamedSoFar += flush;
        res.write(flush);
      }
    }

    if (fullText.trim().length > 0) {
      const finalText = cleanAssistantResponse(fullText.trim(), intelligence);
      if (regenTargetId) {
        await prisma.message.delete({ where: { id: regenTargetId } });
      }
      await prisma.message.create({
        data: { characterId, userId, role: "assistant", content: finalText },
      });
    }
    console.log(
      stopController.signal.aborted
        ? `[chat] reply stopped by client mid-stream (via ${provider})`
        : `[chat] reply generated via ${provider}`
    );
    // If the client already disconnected, res.write/res.end below are
    // harmless no-ops — the assistant text above is already saved.
    if (!stopController.signal.aborted) {
      res.write(encodeEvent({ type: "relationship", level: await reportRelationshipLevel(characterId, userId, explicitMode) }));
    }
    res.end();

    // Fire-and-forget: fold older messages into the running memory summary
    // once the unsummarized window gets long.
    maybeSummarize(characterId, userId, intelligence, recentWindow, summarizeTrigger).catch((err) => console.error("summarize failed", err));
  } catch (err) {
    console.error(err);
    if (!stopController.signal.aborted) {
      res.write(
        encodeEvent({ type: "fatal", message: "Every configured provider failed to respond. Please try again shortly." })
      );
      // Even on a failed generation, the user's own message (and any edit's
      // deletion of trailing messages) above already changed the persisted
      // count — keep the client's bar in sync either way.
      res.write(encodeEvent({ type: "relationship", level: await reportRelationshipLevel(characterId, userId, explicitMode) }));
    }
    res.end();
  }
}));

router.delete("/:characterId/messages/:messageId", asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const { characterId, messageId } = req.params;
  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character || character.ownerId !== userId) {
    return res.status(404).json({ error: "Character not found." });
  }

  const message = await prisma.message.findFirst({
    where: { id: messageId, characterId, userId },
  });
  if (!message) {
    return res.status(404).json({ error: "Message not found." });
  }

  await prisma.message.delete({ where: { id: messageId } });
  const relationshipLevel = await reportRelationshipLevel(characterId, userId, false);
  return res.json({ ok: true, relationshipLevel });
}));

// Resets a conversation: wipes stored messages and the running memory summary
// for this character, scoped to the current user, without deleting the character itself.
router.delete("/:characterId", asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const { characterId } = req.params;
  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character || character.ownerId !== userId) {
    return res.status(404).json({ error: "Character not found." });
  }

  await prisma.message.deleteMany({ where: { characterId, userId } });
  // Reset conversation = start fresh, so the relationship bar goes back to
  // 0 along with the messages and memory, rather than a stray
  // explicitEverUsed flag leaving it stuck at 15%.
  await prisma.character.update({
    where: { id: characterId },
    data: { memorySummary: "", summarizedThrough: 0, explicitEverUsed: false },
  });

  return res.json({ ok: true, relationshipLevel: 0 });
}));

// GET /api/chat/:characterId/memory — the running memory summary + how much
// of the conversation it currently represents, for the "what I remember"
// panel. NOTE: registered before GET "/:characterId" isn't required here
// since Express matches by segment count, but keep both routes together for
// readability.
router.get("/:characterId/memory", asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const { characterId } = req.params;
  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character || character.ownerId !== userId) {
    return res.status(404).json({ error: "Character not found." });
  }

  const totalMessages = await prisma.message.count({ where: { characterId, userId } });

  return res.json({
    memorySummary: character.memorySummary,
    summarizedThrough: character.summarizedThrough,
    totalMessages,
  });
}));

// PUT /api/chat/:characterId/memory — either edit the memory text directly
// (the user correcting/curating what's remembered), or forget it entirely.
// "Forget" can't just reset summarizedThrough to 0, or the next
// summarization pass would re-read all the old messages and regenerate the
// exact memory the user just asked to erase — so it's marked as already
// fully accounted-for instead, at today's message count.
router.put("/:characterId/memory", asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const { characterId } = req.params;
  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character || character.ownerId !== userId) {
    return res.status(404).json({ error: "Character not found." });
  }

  const body = req.body ?? {};
  if (body.forget === true) {
    const totalMessages = await prisma.message.count({ where: { characterId, userId } });
    const updated = await prisma.character.update({
      where: { id: characterId },
      data: { memorySummary: "", summarizedThrough: totalMessages },
    });
    return res.json({ memorySummary: updated.memorySummary, summarizedThrough: updated.summarizedThrough });
  }

  const memorySummary = typeof body.memorySummary === "string" ? body.memorySummary.trim().slice(0, 4000) : null;
  if (memorySummary === null) {
    return res.status(400).json({ error: "memorySummary must be a string." });
  }
  const updated = await prisma.character.update({
    where: { id: characterId },
    data: { memorySummary },
  });
  return res.json({ memorySummary: updated.memorySummary, summarizedThrough: updated.summarizedThrough });
}));

const GROQ_TTS_TIMEOUT_MS = Number(process.env.GROQ_TTS_TIMEOUT_SECONDS || "20") * 1000;
const MAX_SPEECH_INPUT_CHARS = 2000; // caps how much of a long reply we'll ever synthesize in one request

// POST /api/chat/:characterId/speak — text-to-speech for a message, using
// Groq's Orpheus TTS (same GROQ_API_KEY as chat; no separate key needed).
// Orpheus caps input at 200 characters per call, so longer text is split on
// sentence boundaries and the resulting WAV clips are stitched into one file.
router.post("/:characterId/speak", asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const { characterId } = req.params;
  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character || character.ownerId !== userId) {
    return res.status(404).json({ error: "Character not found." });
  }

  if (!isGroqConfigured()) {
    return res.status(400).json({
      error: "Voice playback needs a GROQ_API_KEY set in .env (Groq is currently the only configured TTS provider).",
    });
  }

  const limit = checkRateLimit(`speak:${userId}`, 20, 60);
  if (limit.limited) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many voice requests. Please slow down a bit." });
  }

  const body = req.body ?? {};
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_SPEECH_INPUT_CHARS) : "";
  if (!text) {
    return res.status(400).json({ error: "No text to speak." });
  }
  const requestedVoice = typeof body.voice === "string" ? body.voice : undefined;
  const voice: TtsVoice = (TTS_VOICES as readonly string[]).includes(requestedVoice ?? "")
    ? (requestedVoice as TtsVoice)
    : "hannah";

  const apiKey = getGroqKeys()[0]?.key;
  if (!apiKey) {
    return res.status(400).json({ error: "Voice playback needs a GROQ_API_KEY set in .env." });
  }

  const chunks = splitForSpeech(text);
  try {
    const buffers: Buffer[] = [];
    for (const chunk of chunks) {
      buffers.push(await synthesizeGroqSpeech(chunk, voice, apiKey, GROQ_TTS_TIMEOUT_MS));
    }
    const combined = concatWavBuffers(buffers);
    res.set("Content-Type", "audio/wav");
    res.set("Cache-Control", "no-store");
    return res.send(combined);
  } catch (err) {
    console.error("[chat] TTS synthesis failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("model_terms_required") || message.includes("requires terms acceptance")) {
      return res.status(502).json({
        error: "Voice playback needs the Groq Orpheus model terms to be accepted in the Groq console. Please contact the server admin.",
      });
    }
    return res.status(502).json({ error: "Couldn't generate audio right now. Please try again." });
  }
}));

// Persists the explicit-mode flag (only writes if it's flipping false->true,
// so a chatty conversation doesn't re-write it every turn) and returns the
// freshly computed relationship level. Pure DB reads/writes — no provider
// call, so this never costs API tokens.
async function reportRelationshipLevel(characterId: string, userId: string, explicitMode: boolean): Promise<number> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { explicitEverUsed: true },
  });
  let explicitEverUsed = character?.explicitEverUsed ?? false;
  if (explicitMode && !explicitEverUsed) {
    await prisma.character.update({ where: { id: characterId }, data: { explicitEverUsed: true } });
    explicitEverUsed = true;
  }
  const totalMessages = await prisma.message.count({ where: { characterId, userId } });
  return computeRelationshipLevel(totalMessages, explicitEverUsed);
}

async function maybeSummarize(
  characterId: string,
  userId: string,
  intelligence: number = 5,
  recentWindow: number = RECENT_MESSAGE_WINDOW,
  summarizeTrigger: number = SUMMARIZE_TRIGGER
) {
  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character) return;

  const total = await prisma.message.count({ where: { characterId, userId } });
  const unsummarized = total - character.summarizedThrough;
  if (unsummarized < summarizeTrigger) return;

  const toFoldCount = unsummarized - recentWindow;
  if (toFoldCount <= 0) return;

  const toFold = await prisma.message.findMany({
    where: { characterId, userId },
    orderBy: { createdAt: "asc" },
    skip: character.summarizedThrough,
    take: toFoldCount,
  });
  if (toFold.length === 0) return;

  const updatedSummary = await summarizeConversation(
    character,
    character.memorySummary,
    toFold,
    character.isExplicit || character.explicitEverUsed,
    intelligence
  );

  await prisma.character.update({
    where: { id: characterId },
    data: {
      memorySummary: updatedSummary,
      summarizedThrough: character.summarizedThrough + toFold.length,
    },
  });
}

export default router;
