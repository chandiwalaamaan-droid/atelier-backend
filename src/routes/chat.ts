import { Router } from "express";
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
} from "../lib/providers";
import type { TtsVoice } from "../lib/providers";
import { getEngineConfig } from "../lib/providers/engines";

const router = Router();

const MAX_MESSAGE_LENGTH = 4000;

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

  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res.json({ character, messages });
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

  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character || character.ownerId !== userId) {
    return res.status(404).json({ error: "Character not found." });
  }

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
  const engine = getEngineConfig(body.engineId);
  const explicitMode = engine ? engine.explicitMode : body.explicitMode === true;
  const spiceLevel = engine ? engine.spiceLevel : explicitMode ? parseSpiceLevel(body.spiceLevel) : undefined;
  const roleplayStyle = engine ? engine.roleplayStyle : explicitMode ? parseRoleplayStyle(body.roleplayStyle) : undefined;
  const voiceNotes = engine?.voiceNotes;
  const intelligence = engine?.intelligence ?? 5;
  const genParams = engine ? { temperature: engine.temperature, topP: engine.topP } : undefined;
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
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "Message" WHERE id = ${target.id} FOR UPDATE`;
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
  const recentHistory = relevant.slice(-recentWindow);

  const system = buildSystemPrompt(character, {
    explicitMode,
    spiceLevel,
    roleplayStyle,
    sceneDirective,
    voiceNotes,
    engine,
  });
  const chatMessages = [
    { role: "system" as const, content: system },
    ...recentHistory.map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  res.set({
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });

  // The frontend's "Stop" button aborts its fetch(), which closes this
  // connection from the client side — surfaced here as the request stream
  // closing early. Wiring that into an AbortSignal lets the fallback chain
  // stop paying for tokens nobody will see, while still keeping (and
  // saving) whatever text had already streamed out.
  const stopController = new AbortController();
  req.on("close", () => stopController.abort());

  try {
    const { text: fullText, provider } = await streamChatWithFallback(
      chatMessages,
      (chunk) => {
        res.write(chunk);
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

    if (fullText.trim().length > 0) {
      const finalText = cleanAssistantResponse(fullText.trim());
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
  return res.json({ ok: true });
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
  await prisma.character.update({
    where: { id: characterId },
    data: { memorySummary: "", summarizedThrough: 0 },
  });

  return res.json({ ok: true });
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
    character.isExplicit,
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
