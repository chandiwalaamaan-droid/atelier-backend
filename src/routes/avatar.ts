import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import multer from "multer";
import { prisma } from "../lib/db";
import { getCurrentUserId } from "../lib/auth";
import { checkRateLimit } from "../lib/rateLimit";
import sharp from "sharp";
import { uploadAvatarBuffer } from "../lib/cloudinary";
import { generateHuggingFaceImage, isHuggingFaceConfigured } from "../lib/providers/huggingface";
import { generateCloudflareImage, isCloudflareConfigured } from "../lib/providers/cloudflare";

// In-memory cache for recently generated images (keyed by prompt hash)
// Reduces duplicate generation and improves perceived speed.
const imageCache = new Map<string, { buffer: Buffer; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE_ENTRIES = 200;

function cacheKey(prompt: string, width: number, height: number): string {
  return `${width}x${height}:${prompt.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

async function getCachedImage(key: string): Promise<Buffer | null> {
  const entry = imageCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    imageCache.delete(key);
    return null;
  }
  return entry.buffer;
}

function setCachedImage(key: string, buffer: Buffer): void {
  if (imageCache.size >= MAX_CACHE_ENTRIES) {
    // Evict a random expired (or any) entry to bound cache size — O(1) instead
    // of sorting all entries. Expired entries are cleaned on read paths.
    const first = imageCache.keys().next();
    if (!first.done) imageCache.delete(first.value);
  }
  imageCache.set(key, { buffer, expiresAt: Date.now() + CACHE_TTL_MS });
}

const router = Router();

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });

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

// Portrait prompt tuned for character avatars. Explicit characters skip the
// family-friendly guardrails; optional customPrompt overrides the default.
function buildImagePrompt(
  character: { name: string; personality: string; tagline: string; isExplicit?: boolean },
  customPrompt?: string
) {
  if (customPrompt?.trim()) {
    return customPrompt.trim().slice(0, 4000);
  }

  const base =
    `A highly polished digital portrait of a fictional character named ${character.name}. ` +
    `Tagline: ${character.tagline || "n/a"}. Traits: ${character.personality}. ` +
    `Cinematic lighting, ultra-detailed rendering, smooth skin tones, crisp focus, and a refined shoulders-up composition with a clean, subtle background. `;

  if (character.isExplicit) {
    return (
      `${base} Mature, alluring adult energy with tasteful sensuality, confident body language, and flattering intimate styling. ` +
      `Keep the image portrait-focused, elegant, and polished — no text, no watermark, and no distracting elements.`
    );
  }

  return (
    `${base} Beautiful stylized character art with expressive emotion, rich detail, and a professional finish.`
  );
}

// Pollinations.ai (https://pollinations.ai) — free, keyless, OpenAI-Flux-backed
// image generation. No API key, no billing, no signup required. Optionally
// set POLLINATIONS_API_KEY if you have one (raises rate limits) but it's not
// required for this to work out of the box.
const POLLINATIONS_IMAGE_URL = "https://image.pollinations.ai/prompt";

async function generatePollinationsImage(
  character: { isExplicit?: boolean },
  prompt: string,
  timeoutMs: number
): Promise<Buffer> {
  const params = new URLSearchParams({
    width: "1024",
    height: "1024",
    model: "flux",
    nologo: "true",
    // Pollinations' "safe" filter defaults to permissive; explicitly mark
    // non-explicit characters as safe and leave explicit ones unfiltered so
    // portraits actually match the persona instead of getting blocked.
    safe: character.isExplicit ? "false" : "true",
    seed: String(Date.now() % 1_000_000),
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

// Pollinations' free tier only allows one in-flight request per source IP
// ("Queue full for IP... max: 1"). On Render this IP is shared with other
// apps, so 429s here are transient congestion, not a hard block — a short
// backoff and retry clears them most of the time instead of failing the
// whole request immediately.
async function withPollinationsRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isQueueFull = /429|Too Many Requests|Queue full/i.test(msg);
      if (!isQueueFull || attempt === maxAttempts) throw err;
      const backoffMs = 500 * attempt; // 500ms, 1000ms, ...
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Some providers' safety filters don't throw an error for blocked/explicit
// prompts — they silently return a solid black (or flat gray/white) image
// as a "successful" response. Since that's valid image bytes, the normal
// try/catch fallback logic never sees it as a failure. This check inspects
// the actual pixel statistics to catch that case and treat it as a failure
// so the caller falls through to the next provider instead of serving a
// blank image to the user.
async function isBlankOrBlockedImage(bytes: Buffer): Promise<boolean> {
  try {
    // Downscale first — stats() on a huge image is wasteful, and we only
    // need a coarse signal, not per-pixel precision.
    const { channels } = await sharp(bytes).resize(32, 32, { fit: "fill" }).stats();
    const rgb = channels.slice(0, 3); // ignore alpha if present
    if (rgb.length === 0) return false;

    const allNearBlack = rgb.every((c) => c.mean < 12);
    const allFlat = rgb.every((c) => c.stdev < 3); // solid color: black, white, or gray placeholder
    return allNearBlack || allFlat;
  } catch {
    // If we can't even parse the image, something's wrong with it — treat
    // as blocked/broken rather than silently serving whatever this is.
    return true;
  }
}

// ---------------------------------------------------------------------------
// Enhanced image-gen fallback chain: HF -> Pollinations -> Cloudflare.
// Each provider's output is checked for blank/safety-filtered results (see
// isBlankOrBlockedImage above) before being accepted — a blank image counts
// as a failure and moves on to the next provider, same as a thrown error.
// ---------------------------------------------------------------------------
async function generateAvatarImage(
  character: { isExplicit?: boolean },
  prompt: string,
  timeoutMs: number
): Promise<{ bytes: Buffer; provider: string }> {
  const errors: string[] = [];

  // Try Pollinations first (unrestricted mode for explicit personas, keyless)
  try {
    const bytes = await withPollinationsRetry(() =>
      generatePollinationsImage(character, prompt, timeoutMs)
    );
    if (await isBlankOrBlockedImage(bytes)) {
      throw new Error("returned a blank/blocked image (likely safety filter)");
    }
    return { bytes, provider: "pollinations" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[avatar] Pollinations failed, falling back to Hugging Face:", msg);
    errors.push(`pollinations: ${msg}`);
  }

  // Fallback to Hugging Face if configured
  if (isHuggingFaceConfigured()) {
    try {
      const bytes = await generateHuggingFaceImage(prompt, timeoutMs);
      if (await isBlankOrBlockedImage(bytes)) {
        throw new Error("returned a blank/blocked image (likely safety filter)");
      }
      return { bytes, provider: "huggingface" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[avatar] Hugging Face failed, falling back to Cloudflare:", msg);
      errors.push(`huggingface: ${msg}`);
    }
  }

  // Final fallback: Cloudflare Workers AI
  if (isCloudflareConfigured()) {
    try {
      const bytes = await generateCloudflareImage(prompt, timeoutMs);
      if (await isBlankOrBlockedImage(bytes)) {
        throw new Error("returned a blank/blocked image (likely safety filter)");
      }
      return { bytes, provider: "cloudflare" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[avatar] Cloudflare Workers AI failed:", msg);
      errors.push(`cloudflare: ${msg}`);
    }
  }

  throw new Error("All image providers failed: " + errors.join("; "));
}

// Scene prompt for in-chat image generation (more cinematic, less portrait-focused)
function buildSceneImagePrompt(character: { name: string; personality: string; tagline: string; isExplicit?: boolean }) {
  const base =
    `Cinematic scene featuring ${character.name}. ` +
    `Tagline: ${character.tagline || "n/a"}. Traits: ${character.personality}. ` +
    `Dramatic lighting, rich atmosphere, highly detailed, photorealistic or stylized, 8k.`;

  if (character.isExplicit) {
    return (
      `${base} Mature adult scene, sensual atmosphere, intimate moment, tasteful but uninhibited. ` +
      `Focus on emotion, chemistry, and physical connection. High quality, polished, no watermarks.`
    );
  }

  return `${base} Emotional, engaging scene with strong composition.`;
}

// Generate a scene image (not necessarily portrait/avatar) with given dimensions
async function generateSceneImage(
  prompt: string,
  width: number,
  height: number,
  isExplicit: boolean,
  timeoutMs: number
): Promise<{ bytes: Buffer; provider: string }> {
  const errors: string[] = [];

  // Pollinations first (unrestricted mode, exact width/height, keyless)
  try {
    const bytes = await withPollinationsRetry(() =>
      generatePollinationsSceneImage(prompt, width, height, isExplicit, timeoutMs)
    );
    if (await isBlankOrBlockedImage(bytes)) {
      throw new Error("returned a blank/blocked image (likely safety filter)");
    }
    return { bytes, provider: "pollinations" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`pollinations: ${msg}`);
  }

  // Hugging Face second (open model, no content policy)
  if (isHuggingFaceConfigured()) {
    try {
      const bytes = await generateHuggingFaceImageWithSize(prompt, width, height, timeoutMs);
      if (await isBlankOrBlockedImage(bytes)) {
        throw new Error("returned a blank/blocked image (likely safety filter)");
      }
      return { bytes, provider: "huggingface" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`huggingface: ${msg}`);
    }
  }

  // Final fallback: Cloudflare Workers AI. Note this ignores width/height
  // (SDXL-Lightning outputs a fixed ~1024x1024) — callers that need an exact
  // aspect ratio should resize downstream, same as the rest of this codebase
  // already does with sharp.
  if (isCloudflareConfigured()) {
    try {
      const bytes = await generateCloudflareImage(prompt, timeoutMs);
      if (await isBlankOrBlockedImage(bytes)) {
        throw new Error("returned a blank/blocked image (likely safety filter)");
      }
      return { bytes, provider: "cloudflare" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`cloudflare: ${msg}`);
    }
  }

  throw new Error("All image providers failed: " + errors.join("; "));
}

async function generateHuggingFaceImageWithSize(
  prompt: string,
  width: number,
  height: number,
  timeoutMs: number
): Promise<Buffer> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) throw new Error("HUGGINGFACE_API_KEY not set");

  const model = process.env.HUGGINGFACE_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell";
  const url = `https://router.huggingface.co/hf-inference/models/${model}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "image/png",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { width, height },
        options: { wait_for_model: true },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Hugging Face request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Hugging Face API error ${res.status} [model=${model}, url=${url}]: ${errText.slice(0, 300)}`
    );
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Hugging Face returned non-image response [model=${model}]: ${errText.slice(0, 300)}`
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (!bytes.length) throw new Error("Hugging Face returned an empty image");
  return bytes;
}

async function generatePollinationsSceneImage(
  prompt: string,
  width: number,
  height: number,
  isExplicit: boolean,
  timeoutMs: number
): Promise<Buffer> {
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    model: "flux",
    nologo: "true",
    safe: isExplicit ? "false" : "true",
    seed: String(Date.now() % 1_000_000),
  });
  const apiKey = process.env.POLLINATIONS_API_KEY;
  if (apiKey) params.set("key", apiKey);

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;

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

// POST /api/characters/:id/image/generate — AI-generate an in-chat scene image
// Supports both explicit and non-explicit characters with tailored prompts.
router.post("/:id/image/generate", asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const character = await prisma.character.findUnique({ where: { id: req.params.id } });
  if (!character || character.ownerId !== userId) {
    return res.status(404).json({ error: "Character not found." });
  }

  const body = req.body ?? {};
  const customPrompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 4000) : undefined;
  const aspect = typeof body.aspect === "string" && ["1:1", "16:9", "9:16", "4:3", "3:4"].includes(body.aspect)
    ? body.aspect
    : "1:1";

  // Rate limit to prevent abuse
  const limit = checkRateLimit(`image:${userId}`, 10, 60);
  if (limit.limited) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many image requests. Please slow down a bit." });
  }

  const aspectMap: Record<string, { w: number; h: number }> = {
    "1:1": { w: 1024, h: 1024 },
    "16:9": { w: 1024, h: 576 },
    "9:16": { w: 576, h: 1024 },
    "4:3": { w: 1024, h: 768 },
    "3:4": { w: 768, h: 1024 },
  };
  const { w, h } = aspectMap[aspect] || { w: 1024, h: 1024 };

  const scenePrompt = customPrompt || buildSceneImagePrompt(character);
  const timeoutMs = Number(process.env.IMAGE_GEN_TIMEOUT_SECONDS || "30") * 1000;

  // Check cache first for near-instant repeat generation
  const key = cacheKey(scenePrompt, w, h);
  const cached = await getCachedImage(key);
  if (cached) {
    const cleanBytes = await sharp(cached).toBuffer().catch(() => cached);
    const publicId = `${req.params.id}-${Date.now()}-scene`;
    const imageUrl = await uploadAvatarBuffer(cleanBytes, publicId);
    console.log(`[image] served scene from cache`);
    return res.json({ url: imageUrl, provider: "cache" });
  }

  let result: { bytes: Buffer; provider: string };
  try {
    result = await generateSceneImage(scenePrompt, w, h, character.isExplicit, timeoutMs);
  } catch (err) {
    console.error("Scene image generation failed", err);
    return res.status(502).json({ error: "Image generation failed. Try again with a different prompt." });
  }

  const cleanBytes = await sharp(result.bytes).toBuffer().catch(() => result.bytes);
  const publicId = `${req.params.id}-${Date.now()}-scene`;
  const imageUrl = await uploadAvatarBuffer(cleanBytes, publicId);

  setCachedImage(key, cleanBytes);
  console.log(`[image] generated scene via ${result.provider}`);
  return res.json({ url: imageUrl, provider: result.provider });
}));

// POST /api/characters/:id/avatar/generate — AI-generate an avatar (free, no API key needed)
router.post("/:id/avatar/generate", asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const character = await prisma.character.findUnique({ where: { id: req.params.id } });
  if (!character || character.ownerId !== userId) {
    return res.status(404).json({ error: "Character not found." });
  }

  const body = req.body ?? {};
  const customPrompt = typeof body.prompt === "string" ? body.prompt : undefined;
  const prompt = buildImagePrompt(character, customPrompt);
  const timeoutMs = Number(process.env.IMAGE_GEN_TIMEOUT_SECONDS || "30") * 1000;

  // Check cache first for near-instant repeat generation
  const sizesEnv = (process.env.AVATAR_SIZES || "1024x1024").split(",").map((s) => s.trim());
  const primarySize = sizesEnv[0] || "1024x1024";
  const [cacheW, cacheH] = primarySize.split("x").map(Number);
  const key = cacheKey(prompt, cacheW || 1024, cacheH || 1024);
  const cached = await getCachedImage(key);
  if (cached) {
    const cleanBytes = await sharp(cached).toBuffer().catch(() => cached);
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
    console.error("Image generation failed", err);
    return res.status(502).json({ error: "Image generation failed. Try again, or upload an image instead." });
  }

  // Strip all metadata (EXIF, PNG text chunks, etc.) before this ever leaves
  // the server — generation providers sometimes embed the model name,
  // prompt, or "Software" tag in there, and nothing about who/what
  // generated the image should be recoverable from the file itself.
  // NOTE: sharp strips all metadata by default on output — do NOT call
  // .withMetadata() here, since that opts back into carrying it through.
  const cleanBytes = await sharp(result.bytes).toBuffer().catch(() => result.bytes);

  const publicId = `${req.params.id}-${Date.now()}-generated`;
  const avatarUrl = await uploadAvatarBuffer(cleanBytes, publicId);
  const updated = await prisma.character.update({ where: { id: req.params.id }, data: { avatarUrl } });

  // Cache for fast repeat generation
  setCachedImage(key, cleanBytes);

  // Provider name is logged server-side only for debugging — never sent in
  // the API response, so the client/user has no way to see which service
  // generated a given avatar.
  console.log(`[avatar] generated via ${result.provider}`);
  return res.json({ character: updated });
}));

// ---------------------------------------------------------------------------
// BACKGROUND IMAGE (chat interface wallpaper)
// ---------------------------------------------------------------------------

// Background prompt tuned for chat interface wallpapers — atmospheric, wide,
// non-distracting scenes that look good behind text bubbles.
function buildBackgroundPrompt(
  character: { name: string; personality: string; tagline: string; isExplicit?: boolean }
) {
  const base =
    `A stunning atmospheric background scene for a character named ${character.name}. ` +
    `Tagline: ${character.tagline || "n/a"}. Traits: ${character.personality}. ` +
    `Wide landscape, soft focus, dreamy lighting, rich colors, highly detailed, cinematic atmosphere. ` +
    `The scene should evoke the character's world and mood without any text, watermarks, or people in the foreground.`;

  if (character.isExplicit) {
    return (
      `${base} Mature, sensual ambient atmosphere with warm mood lighting, velvety textures, ` +
      `intimate setting, elegant and tasteful. No explicit nudity, but a seductive, luxurious ambiance.`
    );
  }

  return (
    `${base} Beautiful, immersive environment with a sense of wonder and emotional depth. ` +
    `Soft bokeh, natural or fantasy landscape, painterly quality, suitable as a chat wallpaper.`
  );
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
  const customPrompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 4000) : undefined;
  const prompt = customPrompt || buildBackgroundPrompt(character);

  const timeoutMs = Number(process.env.IMAGE_GEN_TIMEOUT_SECONDS || "30") * 1000;

  // Rate limit
  const limit = checkRateLimit(`background:${userId}`, 10, 60);
  if (limit.limited) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many image requests. Please slow down a bit." });
  }

  // Use scene image generation with landscape dimensions for backgrounds
  let result: { bytes: Buffer; provider: string };
  try {
    // 16:9 landscape for background
    result = await generateSceneImage(prompt, 1920, 1080, character.isExplicit, timeoutMs);
  } catch (err) {
    console.error("Background image generation failed", err);
    return res.status(502).json({ error: "Background image generation failed. Try again with a different prompt." });
  }

  // Strip metadata
  const cleanBytes = await sharp(result.bytes).toBuffer().catch(() => result.bytes);
  const publicId = `${req.params.id}-${Date.now()}-bg`;
  const backgroundUrl = await uploadAvatarBuffer(cleanBytes, publicId);
  const updated = await prisma.character.update({ where: { id: req.params.id }, data: { backgroundUrl } });

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

export default router;
