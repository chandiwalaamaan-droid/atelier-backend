import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import multer from "multer";
import { prisma } from "../lib/db";
import { getCurrentUserId } from "../lib/auth";
import sharp from "sharp";
import { uploadAvatarBuffer } from "../lib/b2";
import { generateCloudflareImage, isCloudflareConfigured } from "../lib/providers/cloudflare";
import { acquireImageGenSlot, releaseImageGenSlot, ImageGenJobData, ImageGenJobResult } from "../lib/imageQueue";
import { ProviderBreaker, isRateLimitError, isTimeoutError } from "../lib/providers/circuitBreaker";

const router = Router();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const POLLINATIONS_IMAGE_URL = "https://image.pollinations.ai/prompt";

const pollinationsBreaker = new ProviderBreaker("Pollinations", { cooldownSeconds: 30, timeoutTripThreshold: 2, timeoutCooldownSeconds: 15 }, "POLLINATIONS");

async function withPollinationsRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (pollinationsBreaker.isOpen()) {
        throw new Error("Pollinations circuit breaker open, retry later");
      }
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = isRateLimitError(err);
      const isTimeout = isTimeoutError(err);
      if ((isRateLimit || isTimeout) && pollinationsBreaker.isOpen()) {
        throw err;
      }
      const isQueueFull = /429|Too Many Requests|Queue full/i.test(msg);
      if (!isQueueFull || attempt === maxAttempts) {
        if (isRateLimit) {
          pollinationsBreaker.trip(err);
        } else if (isTimeout) {
          pollinationsBreaker.recordTimeout();
        }
        throw err;
      }
      const backoffMs = 500 * attempt;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastErr;
}

async function generatePollinationsAvatar(
  character: { isExplicit?: boolean },
  prompt: string,
  timeoutMs: number
): Promise<Buffer> {
  const params = new URLSearchParams({
    width: "1024",
    height: "1024",
    model: character.isExplicit ? "vendouple/uncensored-image-enhanced" : "flux",
    nologo: "true",
    safe: character.isExplicit ? "false" : "true",
    seed: String(Date.now() % 1_000_000),
    steps: "30",
  });
  const apiKey = process.env.POLLINATIONS_API_KEY;
  if (apiKey) params.set("key", apiKey);

  const url = `${POLLINATIONS_IMAGE_URL}/${encodeURIComponent(prompt)}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let apiRes: Response;
  try {
    apiRes = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Pollinations request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!apiRes.ok) {
    const errText = await apiRes.text().catch(() => "");
    throw new Error(`Pollinations API error ${apiRes.status}: ${errText.slice(0, 300)}`);
  }

  const arrayBuffer = await apiRes.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (!bytes.length) throw new Error("Pollinations returned an empty image");
  return bytes;
}

async function generatePollinationsBackground(
  isExplicit: boolean,
  prompt: string,
  timeoutMs: number
): Promise<Buffer> {
  const params = new URLSearchParams({
    width: "1920",
    height: "1080",
    model: isExplicit ? "vendouple/uncensored-image-enhanced" : "flux",
    nologo: "true",
    safe: isExplicit ? "false" : "true",
    seed: String(Date.now() % 1_000_000),
    steps: "30",
  });
  const apiKey = process.env.POLLINATIONS_API_KEY;
  if (apiKey) params.set("key", apiKey);

  const url = `${POLLINATIONS_IMAGE_URL}/${encodeURIComponent(prompt)}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let apiRes: Response;
  try {
    apiRes = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Pollinations request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!apiRes.ok) {
    const errText = await apiRes.text().catch(() => "");
    throw new Error(`Pollinations API error ${apiRes.status}: ${errText.slice(0, 300)}`);
  }

  const arrayBuffer = await apiRes.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (!bytes.length) throw new Error("Pollinations returned an empty image");
  return bytes;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildAvatarPrompt(
  character: {
    name: string;
    tagline: string;
    personality: string;
    isExplicit?: boolean;
    avatarPrompt?: string | null;
  },
  customPrompt?: string
): string {
  if (customPrompt?.trim()) {
    return customPrompt.trim();
  }

  if (character.avatarPrompt?.trim()) {
    return character.avatarPrompt.trim();
  }

  return `A highly polished digital portrait of a fictional character named ${character.name}. Tagline: ${character.tagline || "n/a"}. Traits: ${character.personality}.`;
}

function buildBackgroundPrompt(
  character: {
    name: string;
    tagline: string;
    backstory?: string;
    isExplicit?: boolean;
  },
  customPrompt?: string
): string {
  if (customPrompt?.trim()) {
    return customPrompt.trim();
  }

  const parts = [
    `A background scene for ${character.name}.`,
    character.tagline ? `Tagline: ${character.tagline}.` : null,
    character.backstory?.trim() ? `Setting: ${character.backstory.trim().slice(0, 500)}.` : null,
  ].filter(Boolean);

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

async function processImageGen(data: ImageGenJobData): Promise<ImageGenJobResult> {
  await acquireImageGenSlot();
  try {
    const { prompt, isExplicit, kind } = data;
    const timeoutMs = Number(process.env.IMAGE_GEN_TIMEOUT_SECONDS || "15") * 1000;
    const cloudflareAvailable = isCloudflareConfigured();

    const pollinationsFn = kind === "avatar"
      ? () => withPollinationsRetry(() => generatePollinationsAvatar({ isExplicit }, prompt, timeoutMs))
      : () => withPollinationsRetry(() => generatePollinationsBackground(isExplicit, prompt, timeoutMs));

    const cloudflareFn = () => generateCloudflareImage(prompt, timeoutMs);

    const pollinationsPromise = pollinationsFn()
      .then((result) => ({ result, provider: "pollinations" } as const))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        return Promise.reject(new Error(`pollinations: ${msg}`));
      });

    // Bug fix: this used to be `Promise.reject(...)` when Cloudflare isn't
    // configured — an already-settled rejected promise created at the top
    // of the function. Racing that against the real, still-in-flight
    // Pollinations call meant the race always resolved to this rejection
    // immediately, and the catch-block fallback re-awaited the very same
    // already-rejected promise instead of the in-flight Pollinations one.
    // Net effect: whenever Cloudflare wasn't configured (a common setup —
    // it needs an extra API token), avatar/background generation always
    // failed even though Pollinations would have succeeded. Only build a
    // real Cloudflare attempt when it's actually configured, and use
    // Promise.any so whichever provider finishes successfully first wins,
    // regardless of which one was faster to *settle*.
    const attempts = cloudflareAvailable
      ? [
          pollinationsPromise,
          cloudflareFn()
            .then((result) => ({ result, provider: "cloudflare" } as const))
            .catch((err) => {
              const msg = err instanceof Error ? err.message : String(err);
              return Promise.reject(new Error(`cloudflare: ${msg}`));
            }),
        ]
      : [pollinationsPromise];

    try {
      const winner = await Promise.any(attempts);
      return { bytes: winner.result, provider: winner.provider };
    } catch (err) {
      const messages =
        err instanceof AggregateError
          ? err.errors.map((e) => (e instanceof Error ? e.message : String(e)))
          : [err instanceof Error ? err.message : String(err)];
      if (!cloudflareAvailable) messages.push("cloudflare: not configured");
      throw new Error(`All providers failed: ${messages.join("; ")}`);
    }
  } finally {
    releaseImageGenSlot();
  }
}

export function startImageGenWorker(): void {
  console.log("[image-queue] Using in-memory queue (BullMQ Postgres backend disabled)");
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// POST /api/characters/:id/avatar — upload an image file
router.post("/:id/avatar", upload.single("avatar"), asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const character = await prisma.character.findUnique({ where: { id: req.params.id } });
  if (!character || character.ownerId !== userId) {
    return res.status(404).json({ error: "Character not found." });
  }

  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "No image file was sent." });
  }
  const ext = ALLOWED_TYPES[file.mimetype];
  if (!ext) {
    return res.status(400).json({ error: "Use a PNG, JPEG, WebP, or GIF image." });
  }

  const publicId = `${req.params.id}-${Date.now()}`;
  const avatarUrl = await uploadAvatarBuffer(file.buffer, publicId);
  const updated = await prisma.character.update({ where: { id: req.params.id }, data: { avatarUrl } });

  return res.json({ character: updated });
}));

// POST /api/characters/:id/avatar/generate — AI-generate an avatar
router.post("/:id/avatar/generate", asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const character = await prisma.character.findUnique({ where: { id: req.params.id } });
  if (!character || character.ownerId !== userId) {
    return res.status(404).json({ error: "Character not found." });
  }

  const body = req.body ?? {};
  const customPrompt = typeof body.prompt === "string" ? body.prompt : undefined;
  const prompt = buildAvatarPrompt(character, customPrompt);

  try {
    const result = await processImageGen({ prompt, isExplicit: !!character.isExplicit, kind: "avatar" });
    const cleanBytes = await sharp(result.bytes).sharpen().toBuffer().catch(() => result.bytes);
    const publicId = `${req.params.id}-${Date.now()}-generated`;
    const avatarUrl = await uploadAvatarBuffer(cleanBytes, publicId);
    const updated = await prisma.character.update({ where: { id: req.params.id }, data: { avatarUrl } });
    console.log(`[avatar] generated via ${result.provider}`);
    return res.json({ character: updated });
  } catch (err) {
    console.error("Avatar generation failed", err);
    return res.status(502).json({ error: "Avatar generation failed. Try again, or upload an image instead." });
  }
}));

// ---------------------------------------------------------------------------
// Background generation
// ---------------------------------------------------------------------------

// POST /api/characters/:id/background/generate — AI-generate a chat background/wallpaper image
router.post("/:id/background/generate", asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const character = await prisma.character.findUnique({ where: { id: req.params.id } });
  if (!character || character.ownerId !== userId) {
    return res.status(404).json({ error: "Character not found." });
  }

  const body = req.body ?? {};
  const customPrompt = typeof body.prompt === "string" ? body.prompt : undefined;
  const prompt = buildBackgroundPrompt(character, customPrompt);

  try {
    const result = await processImageGen({ prompt, isExplicit: !!character.isExplicit, kind: "background" });
    let cleanBytes = await sharp(result.bytes).sharpen().toBuffer().catch(() => result.bytes);
    if (cleanBytes.length) {
      cleanBytes = await sharp(cleanBytes)
        .resize(1920, 1080, { fit: "cover" })
        .toBuffer()
        .catch(() => cleanBytes);
    }
    const publicId = `${req.params.id}-${Date.now()}-bg`;
    const backgroundUrl = await uploadAvatarBuffer(cleanBytes, publicId);
    const updated = await prisma.character.update({ where: { id: req.params.id }, data: { backgroundUrl } });
    console.log(`[background] generated via ${result.provider}`);
    return res.json({ character: updated });
  } catch (err) {
    console.error("Background generation failed", err);
    return res.status(502).json({ error: "Background generation failed. Try again with a different prompt." });
  }
}));

// POST /api/characters/:id/background — upload a custom background image
router.post("/:id/background", upload.single("background"), asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const character = await prisma.character.findUnique({ where: { id: req.params.id } });
  if (!character || character.ownerId !== userId) {
    return res.status(404).json({ error: "Character not found." });
  }

  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "No image file was sent." });
  }
  const ext = ALLOWED_TYPES[file.mimetype];
  if (!ext) {
    return res.status(400).json({ error: "Use a PNG, JPEG, WebP, or GIF image." });
  }

  const publicId = `${req.params.id}-${Date.now()}-bg`;
  const backgroundUrl = await uploadAvatarBuffer(file.buffer, publicId);
  const updated = await prisma.character.update({ where: { id: req.params.id }, data: { backgroundUrl } });

  return res.json({ character: updated });
}));

// DELETE /api/characters/:id/background — remove the background image
router.delete("/:id/background", asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const character = await prisma.character.findUnique({ where: { id: req.params.id } });
  if (!character || character.ownerId !== userId) {
    return res.status(404).json({ error: "Character not found." });
  }

  const updated = await prisma.character.update({
    where: { id: req.params.id },
    data: { backgroundUrl: null },
  });

  return res.json({ character: updated });
}));

export default router;
