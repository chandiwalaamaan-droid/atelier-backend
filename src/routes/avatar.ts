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

// In-memory cache for recently generated images (keyed by prompt hash)
// Reduces duplicate generation and improves perceived speed.
const imageCache = new Map<string, { buffer: Buffer; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE_ENTRIES = 200;

function cacheKey(prompt: string, width: number, height: number, imageUrl?: string): string {
  const base = `${width}x${height}:${prompt.toLowerCase().replace(/\s+/g, " ").trim()}`;
  if (!imageUrl) return base;
  return `${base}:img=${encodeURIComponent(imageUrl)}`;
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

// Portrait prompt tuned for character avatars. Priority order for what
// actually describes what the character LOOKS like:
//   1. customPrompt   — a one-off override typed by the user for this
//                        specific generation request. Highest priority:
//                        exactly what was asked for, right now.
//   2. avatarPrompt   — the creator's exact, saved visual description for
//                        this character (set at creation/import time).
//                        This is the character's true "appearance" field —
//                        personality/tagline are behavior, not looks, and
//                        should never stand in for this when it exists.
//   3. Fallback       — reconstructed from tagline/personality when neither
//                        of the above is available (legacy characters).
//
// Quality suffixes are split into neutral and style-specific variants so
// user-requested styles like "anime" or "cartoon" aren't overwritten by
// photorealism terms like "cinematic lighting" or "digital portrait quality."
const NEUTRAL_QUALITY_SUFFIX = "Highly detailed, crisp focus, clean composition, no text, no watermark, no signature, no logo.";
const REALISTIC_QUALITY_SUFFIX = "Cinematic lighting, ultra-detailed rendering, crisp focus, professional digital portrait quality, smooth skin tones, no text, no watermark.";
const ANIME_QUALITY_SUFFIX = "Vibrant anime style, clean lines, expressive eyes, cel-shaded or painterly anime aesthetic, high quality anime illustration, no text, no watermark.";
const CARTOON_QUALITY_SUFFIX = "Bold cartoon style, thick outlines, flat colors, expressive caricature, graphic illustration style, no text, no watermark.";
const PAINTING_QUALITY_SUFFIX = "Rich painterly style, visible brushstrokes, artistic composition, gallery-quality artwork, no text, no watermark.";

function detectStyle(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (/\banime\b|\bmanga\b|\bchibi\b/.test(lower)) return "anime";
  if (/\bcartoon\b|\bilustration\b|\bcomic\b|\bvector\b/.test(lower)) return "cartoon";
  if (/\bpainting\b|\bpainterly\b|\boil paint\b|\bwatercolor\b|\bpixel art\b/.test(lower)) return "painting";
  if (/\brealistic\b|\bphotorealistic\b|\bphoto\b|\bcinematic\b/.test(lower)) return "realistic";
  return "neutral";
}

function buildImagePrompt(
  character: {
    name: string;
    personality: string;
    tagline: string;
    isExplicit?: boolean;
    avatarPrompt?: string | null;
  },
  customPrompt?: string
) {
  let corePrompt: string;
  let style: string;

  if (customPrompt?.trim()) {
    corePrompt = customPrompt.trim();
    style = detectStyle(customPrompt);
  } else if (character.avatarPrompt?.trim()) {
    corePrompt = character.avatarPrompt.trim();
    style = detectStyle(character.avatarPrompt);
  } else {
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

    return `${base} Beautiful stylized character art with expressive emotion, rich detail, and a professional finish.`;
  }

  const suffix =
    style === "anime"
      ? ANIME_QUALITY_SUFFIX
      : style === "cartoon"
        ? CARTOON_QUALITY_SUFFIX
        : style === "painting"
          ? PAINTING_QUALITY_SUFFIX
          : style === "realistic"
            ? REALISTIC_QUALITY_SUFFIX
            : NEUTRAL_QUALITY_SUFFIX;

  const explicitSuffix = character.isExplicit
    ? " Mature, alluring adult energy with tasteful sensuality, confident body language, and flattering intimate styling. Keep the image portrait-focused, elegant, and polished — no text, no watermark, and no distracting elements."
    : "";

  return `${corePrompt} ${suffix}${explicitSuffix}`.slice(0, 4000);
}

// Pollinations.ai (https://pollinations.ai) — free, keyless, OpenAI-Flux-backed
// image generation. No API key, no billing, no signup required. Optionally
// set POLLINATIONS_API_KEY if you have one (raises rate limits) but it's not
// required for this to work out of the box.
const POLLINATIONS_IMAGE_URL = "https://image.pollinations.ai/prompt";

async function generatePollinationsImage(
  character: { isExplicit?: boolean },
  prompt: string,
  timeoutMs: number,
  style: string = "neutral"
): Promise<Buffer> {
  const model =
    style === "anime"
      ? "animagine-xl"
      : style === "cartoon"
        ? "stable-diffusion-xl-base-1.0"
        : "flux";

  const params = new URLSearchParams({
    width: "1024",
    height: "1024",
    model,
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
// ---------------------------------------------------------------------------
// Image-gen fallback chain, ordered by generation quality (best first):
// 1. Pollinations first — primary. Fast Flux-family generation, unrestricted
//    mode (safe:false) for explicit personas, keyless. Best speed/quality
//    tradeoff, so it's tried first.
// 2. AI Horde second — free community-run cluster of volunteer GPUs running
//    dedicated SDXL checkpoints (AlbedoBase XL, Juggernaut XL, etc. — see
//    aihorde.ts) rather than fast/distilled models, so output quality is at
//    least as good as Pollinations and often better. It's async (submit +
//    poll a worker) so it's slower — used when Pollinations fails rather
//    than as primary. Has real NSFW-capable checkpoints for isExplicit
//    characters, unlike Cloudflare below.
// 3. Cloudflare Workers AI last — fixed-aspect SDXL-Lightning, lowest
//    quality of the three and no permissive-mode toggle for explicit
//    prompts; kept purely as a last-resort safety net when both of the
//    above are down.
// ---------------------------------------------------------------------------
async function generateAvatarImage(
  character: { isExplicit?: boolean },
  prompt: string,
  timeoutMs: number,
  style: string = "neutral"
): Promise<{ bytes: Buffer; provider: string }> {
  const errors: string[] = [];

  // Try Pollinations first (primary)
  try {
    const bytes = await withPollinationsRetry(() =>
      generatePollinationsImage(character, prompt, timeoutMs, style)
    );
    return { bytes, provider: "pollinations" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[avatar] Pollinations failed, falling back to AI Horde:", msg);
    errors.push(`pollinations: ${msg}`);
  }

  // Fallback to AI Horde (free community cluster, higher-tier checkpoints)
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

  // Final fallback: Cloudflare Workers AI if configured
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

  throw new Error("All image providers failed: " + errors.join("; "));
}

// Scene prompt for in-chat image generation (more cinematic, less portrait-
// focused). Identity preservation is the #1 priority: the character must look
// like themselves in every frame, not drift to a different person each time.
// Structure: identity → style DNA → exact scenario → technical quality.
function buildSceneImagePrompt(
  character: {
    name: string;
    personality: string;
    tagline: string;
    isExplicit?: boolean;
    avatarPrompt?: string | null;
    scenePromptTemplate?: string | null;
  },
  context?: string
) {
  // --- 1. IDENTITY (must come first, must be loud) ---
  const appearance = character.avatarPrompt?.trim();
  const identityBlock = appearance
    ? `CRITICAL IDENTITY PRESERVATION: This is ${character.name}. ` +
      `Their exact appearance is: ${appearance}. ` +
      `Face, hair, eyes, body, clothing, and visual style MUST remain [CONSISTENT] with this description. ` +
      `Do NOT change their look, age, build, or outfit unless the scene explicitly requires it.`
    : `CRITICAL IDENTITY PRESERVATION: This is ${character.name}. ` +
      `Traits: ${character.personality}. Tagline: ${character.tagline || "n/a"}. ` +
      `Their core visual identity must remain [CONSISTENT] across every image.`;

  // --- 2. STYLE DNA (art style + setting consistency) ---
  const styleBlock = character.scenePromptTemplate?.trim()
    ? `STYLE DNA (MANDATORY): ${character.scenePromptTemplate.trim()}. ` +
      `Camera language, lighting setup, color grading, and environment palette from this template are NON-NEGOTIABLE. ` +
      `Do not drift to a different aesthetic, era, or background universe.`
    : "";

  // --- 3. EXACT SCENARIO (what's happening right now) ---
  const scenarioBlock = context?.trim()
    ? `EXACT SCENE TO DEPICT: ${context.trim().slice(0, 2500)}. ` +
      `Show THIS specific moment, pose, interaction, and environment. ` +
      `Do not invent a different situation, location, or action than what is described above.`
    : `MOOD: ${character.tagline || "n/a"}. `;

  // --- 4. TECHNICAL QUALITY (placed last so identity/style/scenario aren't drowned out) ---
  const qualityBlock =
    `Cinematic composition, dramatic lighting, rich atmosphere, highly detailed, ` +
    `8k, professional photography, sharp focus, volumetric lighting, intricate details, ` +
    `masterpiece, film grain, immersive environment. ` +
    `No text, no watermark, no signature, no logo, no UI elements. ` +
    `Do not add captions or letterboxing.`;

  const base = `${identityBlock} ${styleBlock} ${scenarioBlock} ${qualityBlock}`;

  if (character.isExplicit) {
    return (
      `${base} ` +
      `EXPLICIT CONTENT ALLOWED: Mature adult scene, sensual atmosphere, intimate moment, ` +
      `tasteful but uninhibited. Focus on emotion, chemistry, and physical connection. ` +
      `Polished, high quality, no watermarks, no text.`
    );
  }

  return `${base} Emotional, engaging scene with strong composition, vivid colors, immersive environment.`;
}

// Generate a scene image (not necessarily portrait/avatar) with given dimensions
async function generateSceneImage(
  prompt: string,
  width: number,
  height: number,
  isExplicit: boolean,
  timeoutMs: number,
  avatarUrl?: string,
  strength: number = 0.4,
  style: string = "neutral"
): Promise<{ bytes: Buffer; provider: string }> {
  const errors: string[] = [];

  // Pollinations first (primary — exact width/height, unrestricted mode, keyless)
  try {
    const bytes = await withPollinationsRetry(() =>
      generatePollinationsSceneImage(prompt, width, height, isExplicit, timeoutMs, avatarUrl, strength, style)
    );
    return { bytes, provider: "pollinations" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`pollinations: ${msg}`);
  }

  // AI Horde second (dedicated SDXL checkpoints, higher quality tier)
  if (isAiHordeConfigured()) {
    try {
      const hordeTimeoutMs = Number(process.env.AI_HORDE_TIMEOUT_SECONDS || "90") * 1000;
      const bytes = await generateAiHordeImage(
        { isExplicit },
        prompt,
        width,
        height,
        hordeTimeoutMs,
        avatarUrl,
        strength
      );
      return { bytes, provider: "aihorde" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`aihorde: ${msg}`);
    }
  }

  // Cloudflare Workers AI last. Note this ignores width/height
  // (SDXL-Lightning outputs a fixed ~1024x1024) — callers that need an exact
  // aspect ratio should resize downstream, same as the rest of this codebase
  // already does with sharp.
  if (isCloudflareConfigured()) {
    try {
      const bytes = await generateCloudflareImage(prompt, timeoutMs);
      return { bytes, provider: "cloudflare" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`cloudflare: ${msg}`);
    }
  }

  throw new Error("All image providers failed: " + errors.join("; "));
}

async function generatePollinationsSceneImage(
  prompt: string,
  width: number,
  height: number,
  isExplicit: boolean,
  timeoutMs: number,
  avatarUrl?: string,
  strength: number = 0.4,
  style: string = "neutral"
): Promise<Buffer> {
  const model =
    style === "anime"
      ? "animagine-xl"
      : style === "cartoon"
        ? "stable-diffusion-xl-base-1.0"
        : "flux";

  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    model,
    nologo: "true",
    safe: isExplicit ? "false" : "true",
    seed: String(Date.now() % 1_000_000),
    steps: "30",
  });
  const apiKey = process.env.POLLINATIONS_API_KEY;
  if (apiKey) params.set("key", apiKey);
  if (avatarUrl && /^https?:\/\//i.test(avatarUrl)) {
    params.set("image", avatarUrl);
    params.set("strength", String(Math.max(0, Math.min(1, strength))));
  }

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
  const regenerate = Boolean(body.regenerate);

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

  // Always anchor to the character's identity + style (avatarPrompt /
  // scenePromptTemplate) so every scene image still looks like the same
  // character in the same visual style. customPrompt — built client-side
  // from the live conversation — is passed through as the exact scenario
  // to depict, rather than replacing the identity anchor outright.
  const scenePrompt = buildSceneImagePrompt(character, customPrompt);
  const timeoutMs = Number(process.env.IMAGE_GEN_TIMEOUT_SECONDS || "15") * 1000;

  // Check cache first for near-instant repeat generation, unless the client
  // explicitly asked for a fresh generation.
  const key = cacheKey(scenePrompt, w, h);
  const cached = regenerate ? null : await getCachedImage(key);
  if (cached) {
    const cleanBytes = await sharp(cached).sharpen().toBuffer().catch(() => cached);
    const publicId = `${req.params.id}-${Date.now()}-scene`;
    const imageUrl = await uploadAvatarBuffer(cleanBytes, publicId);
    console.log(`[image] served scene from cache`);
    return res.json({ url: imageUrl, provider: "cache" });
  }

  let result: { bytes: Buffer; provider: string };
  try {
    const sceneStyle = detectStyle(scenePrompt);
    result = await generateSceneImage(scenePrompt, w, h, character.isExplicit, timeoutMs, undefined, 0, sceneStyle);
  } catch (err) {
    console.error("Scene image generation failed", err);
    return res.status(502).json({ error: "Image generation failed. Try again with a different prompt." });
  }

  const cleanBytes = await sharp(result.bytes).sharpen().toBuffer().catch(() => result.bytes);
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
  const timeoutMs = Number(process.env.IMAGE_GEN_TIMEOUT_SECONDS || "15") * 1000;
  const regenerate = Boolean(body.regenerate);

  // Check cache first for near-instant repeat generation, unless the client
  // explicitly asked for a fresh generation.
  const sizesEnv = (process.env.AVATAR_SIZES || "1024x1024").split(",").map((s) => s.trim());
  const primarySize = sizesEnv[0] || "1024x1024";
  const [cacheW, cacheH] = primarySize.split("x").map(Number);
  const key = cacheKey(prompt, cacheW || 1024, cacheH || 1024);
  const cached = regenerate ? null : await getCachedImage(key);
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
    const avatarStyle = detectStyle(prompt);
    result = await generateAvatarImage(character, prompt, timeoutMs, avatarStyle);
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
  const cleanBytes = await sharp(result.bytes).sharpen().toBuffer().catch(() => result.bytes);

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
// non-distracting scenes that look good behind text bubbles. Reuses the
// character's avatarPrompt (their actual visual/style identity) so the
// background's mood and palette stay consistent with how the character
// looks, rather than being derived from unrelated personality traits.
function buildBackgroundPrompt(
  character: {
    name: string;
    personality: string;
    tagline: string;
    backstory?: string;
    isExplicit?: boolean;
    avatarPrompt?: string | null;
  },
  customPrompt?: string
) {
  const sourcePrompt = customPrompt || character.avatarPrompt || "";
  const style = detectStyle(sourcePrompt);

  const styleAnchor = character.avatarPrompt?.trim()
    ? `Visual style/identity reference (match the palette, era, and aesthetic; do not depict the character): ${character.avatarPrompt.trim()}. `
    : "";
  const settingHint = character.backstory?.trim()
    ? `Setting/world details to draw from: ${character.backstory.trim().slice(0, 500)}. `
    : "";

  const base =
    `A stunning atmospheric background scene for a character named ${character.name}. ` +
    `Tagline: ${character.tagline || "n/a"}. ${styleAnchor}${settingHint}` +
    `Wide landscape, soft focus, dreamy lighting, rich colors, highly detailed, cinematic atmosphere. ` +
    `The scene should evoke the character's world and mood without any text, watermarks, or people in the foreground.`;

  const styleSuffix =
    style === "anime"
      ? "Anime background art, vibrant colors, stylized environment, painterly or cel-shaded aesthetic, high quality."
      : style === "cartoon"
        ? "Cartoon background style, bold shapes, graphic illustration, flat colors with depth."
        : style === "painting"
          ? "Painterly background, visible brushwork, artistic atmosphere, gallery-quality."
          : "";

  if (character.isExplicit) {
    return (
      `${base} ${styleSuffix} Mature, sensual ambient atmosphere with warm mood lighting, velvety textures, ` +
      `intimate setting, elegant and tasteful. No explicit nudity, but a seductive, luxurious ambiance.`
    );
  }

  return `${base} ${styleSuffix} Beautiful, immersive environment with a sense of wonder and emotional depth. Soft bokeh, natural or fantasy landscape, suitable as a chat wallpaper.`;
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
  const prompt = buildBackgroundPrompt(character, customPrompt);

  const timeoutMs = Number(process.env.IMAGE_GEN_TIMEOUT_SECONDS || "15") * 1000;

  // Rate limit
  const limit = checkRateLimit(`background:${userId}`, 10, 60);
  if (limit.limited) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many image requests. Please slow down a bit." });
  }

  // Use scene image generation with landscape dimensions for backgrounds
  let result: { bytes: Buffer; provider: string };
  try {
    const bgStyle = detectStyle(prompt);
    result = await generateSceneImage(prompt, 1920, 1080, character.isExplicit, timeoutMs, undefined, 0, bgStyle);
  } catch (err) {
    console.error("Background image generation failed", err);
    return res.status(502).json({ error: "Background image generation failed. Try again with a different prompt." });
  }

  // Strip metadata
  const cleanBytes = await sharp(result.bytes).sharpen().toBuffer().catch(() => result.bytes);
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
