import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import multer from "multer";
import { prisma } from "../lib/db";
import { getCurrentUserId } from "../lib/auth";
import { checkRateLimit } from "../lib/rateLimit";
import sharp from "sharp";
import { uploadAvatarBuffer } from "../lib/b2";
import { generateAiHordeImage, isAiHordeConfigured } from "../lib/providers/aihorde";
import { generateCloudflareImage, isCloudflareConfigured } from "../lib/providers/cloudflare";

const router = Router();

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

async function withPollinationsRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isQueueFull = /429|Too Many Requests|Queue full/i.test(msg);
      if (!isQueueFull || attempt === maxAttempts) throw err;
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
    model: "flux",
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
    if (err instanceof DOMException && err.name === "AbortError") {
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
    model: "flux",
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
    if (err instanceof DOMException && err.name === "AbortError") {
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
// Avatar generation
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

async function generateAvatarImage(
  character: { isExplicit?: boolean },
  prompt: string,
  timeoutMs: number
): Promise<{ bytes: Buffer; provider: string }> {
  const errors: string[] = [];

  try {
    const bytes = await withPollinationsRetry(() =>
      generatePollinationsAvatar(character, prompt, timeoutMs)
    );
    return { bytes, provider: "pollinations" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[avatar] Pollinations failed, falling back to AI Horde:", msg);
    errors.push(`pollinations: ${msg}`);
  }

  if (isAiHordeConfigured()) {
    try {
      const hordeTimeoutMs = Number(process.env.AI_HORDE_TIMEOUT_SECONDS || "90") * 1000;
      const bytes = await generateAiHordeImage(character, prompt, 1024, 1024, hordeTimeoutMs);
      return { bytes, provider: "aihorde" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[avatar] AI Horde failed, falling back to Cloudflare:", msg);
      errors.push(`aihorde: ${msg}`);
    }
  }

  if (isCloudflareConfigured()) {
    try {
      const bytes = await generateCloudflareImage(prompt, timeoutMs);
      return { bytes, provider: "cloudflare" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[avatar] Cloudflare Workers AI failed:", msg);
      errors.push(`cloudflare: ${msg}`);
    }
  }

  throw new Error("All avatar providers failed: " + errors.join("; "));
}

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
  const timeoutMs = Number(process.env.IMAGE_GEN_TIMEOUT_SECONDS || "15") * 1000;
  const regenerate = Boolean(body.regenerate);

  const cacheKey = `avatar:${prompt}`;
  const cached = regenerate ? null : getCachedImage(cacheKey);
  if (cached) {
    const cleanBytes = await sharp(cached).sharpen().toBuffer().catch(() => cached);
    const publicId = `${req.params.id}-${Date.now()}-generated`;
    const avatarUrl = await uploadAvatarBuffer(cleanBytes, publicId);
    const updated = await prisma.character.update({ where: { id: req.params.id }, data: { avatarUrl } });
    console.log(`[avatar] served from cache`);
    return res.json({ character: updated });
  }

  let result: { bytes: Buffer; provider: string };
  try {
    result = await generateAvatarImage(character, prompt, timeoutMs);
  } catch (err) {
    console.error("Avatar generation failed", err);
    return res.status(502).json({ error: "Avatar generation failed. Try again, or upload an image instead." });
  }

  const cleanBytes = await sharp(result.bytes).sharpen().toBuffer().catch(() => result.bytes);

  const publicId = `${req.params.id}-${Date.now()}-generated`;
  const avatarUrl = await uploadAvatarBuffer(cleanBytes, publicId);
  const updated = await prisma.character.update({ where: { id: req.params.id }, data: { avatarUrl } });

  setCachedImage(cacheKey, cleanBytes);

  console.log(`[avatar] generated via ${result.provider}`);
  return res.json({ character: updated });
}));

// ---------------------------------------------------------------------------
// Background generation
// ---------------------------------------------------------------------------

function buildBackgroundPrompt(
  character: {
    name: string;
    tagline: string;
    backstory?: string;
    isExplicit?: boolean;
    avatarPrompt?: string | null;
  },
  customPrompt?: string
): string {
  if (customPrompt?.trim()) {
    return customPrompt.trim();
  }

  const parts = [
    `A background scene for ${character.name}.`,
    character.tagline ? `Tagline: ${character.tagline}.` : null,
    character.avatarPrompt?.trim() ? `Visual reference: ${character.avatarPrompt.trim()}.` : null,
    character.backstory?.trim() ? `Setting: ${character.backstory.trim().slice(0, 500)}.` : null,
  ].filter(Boolean);

  return parts.join(" ");
}

async function generateBackgroundImage(
  isExplicit: boolean,
  prompt: string,
  timeoutMs: number
): Promise<{ bytes: Buffer; provider: string }> {
  const errors: string[] = [];

  try {
    const bytes = await withPollinationsRetry(() =>
      generatePollinationsBackground(isExplicit, prompt, timeoutMs)
    );
    return { bytes, provider: "pollinations" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[background] Pollinations failed, falling back to AI Horde:", msg);
    errors.push(`pollinations: ${msg}`);
  }

  if (isAiHordeConfigured()) {
    try {
      const hordeTimeoutMs = Number(process.env.AI_HORDE_TIMEOUT_SECONDS || "90") * 1000;
      const bytes = await generateAiHordeImage({ isExplicit }, prompt, 1920, 1080, hordeTimeoutMs);
      return { bytes, provider: "aihorde" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[background] AI Horde failed, falling back to Cloudflare:", msg);
      errors.push(`aihorde: ${msg}`);
    }
  }

  if (isCloudflareConfigured()) {
    try {
      const bytes = await generateCloudflareImage(prompt, timeoutMs);
      return { bytes, provider: "cloudflare" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[background] Cloudflare Workers AI failed:", msg);
      errors.push(`cloudflare: ${msg}`);
    }
  }

  throw new Error("All background providers failed: " + errors.join("; "));
}

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
  const timeoutMs = Number(process.env.IMAGE_GEN_TIMEOUT_SECONDS || "15") * 1000;
  const regenerate = Boolean(body.regenerate);

  // Rate limit
  const limit = checkRateLimit(`background:${userId}`, 10, 60);
  if (limit.limited) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many image requests. Please slow down a bit." });
  }

  const cacheKey = `background:${prompt}`;
  const cached = regenerate ? null : getCachedImage(cacheKey);
  if (cached) {
    const cleanBytes = await sharp(cached).sharpen().toBuffer().catch(() => cached);
    const publicId = `${req.params.id}-${Date.now()}-bg`;
    const backgroundUrl = await uploadAvatarBuffer(cleanBytes, publicId);
    const updated = await prisma.character.update({ where: { id: req.params.id }, data: { backgroundUrl } });
    console.log(`[background] served from cache`);
    return res.json({ character: updated });
  }

  let result: { bytes: Buffer; provider: string };
  try {
    result = await generateBackgroundImage(character.isExplicit, prompt, timeoutMs);
  } catch (err) {
    console.error("Background generation failed", err);
    return res.status(502).json({ error: "Background generation failed. Try again with a different prompt." });
  }

  let cleanBytes = await sharp(result.bytes).sharpen().toBuffer().catch(() => result.bytes);

  // Some providers may return a fixed aspect/size despite the requested
  // dimensions — normalize backgrounds to the intended 16:9 canvas so the
  // frontend wallpaper slot doesn't get a square image from AI Horde, etc.
  if (cleanBytes.length) {
    cleanBytes = await sharp(cleanBytes)
      .resize(1920, 1080, { fit: "cover" })
      .toBuffer()
      .catch(() => cleanBytes);
  }

  const publicId = `${req.params.id}-${Date.now()}-bg`;
  const backgroundUrl = await uploadAvatarBuffer(cleanBytes, publicId);
  const updated = await prisma.character.update({ where: { id: req.params.id }, data: { backgroundUrl } });

  setCachedImage(cacheKey, cleanBytes);

  console.log(`[background] generated via ${result.provider}`);
  return res.json({ character: updated });
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

// In-memory cache for recently generated images
const imageCache = new Map<string, { buffer: Buffer; expiresAt: number; size: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE_ENTRIES = 200;
const MAX_CACHE_BYTES = 300 * 1024 * 1024; // 300 MB

function getCachedImage(key: string): Buffer | null {
  const entry = imageCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    imageCache.delete(key);
    return null;
  }
  return entry.buffer;
}

function setCachedImage(key: string, buffer: Buffer): void {
  if (imageCache.has(key)) return;

  const size = buffer.length;
  if (size > MAX_CACHE_BYTES) return;

  while (
    (imageCache.size >= MAX_CACHE_ENTRIES || getTotalCacheBytes() + size > MAX_CACHE_BYTES) &&
    imageCache.size > 0
  ) {
    const oldest = imageCache.keys().next().value;
    if (oldest === undefined) break;
    imageCache.delete(oldest);
  }

  imageCache.set(key, { buffer, expiresAt: Date.now() + CACHE_TTL_MS, size });
}

function getTotalCacheBytes(): number {
  let total = 0;
  for (const entry of imageCache.values()) {
    total += entry.size;
  }
  return total;
}

export default router;
