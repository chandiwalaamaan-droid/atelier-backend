import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import multer from "multer";
import { prisma } from "../lib/db";
import { getCurrentUserId } from "../lib/auth";
import sharp from "sharp";
import { uploadAvatarBuffer } from "../lib/cloudinary";
import { generateHuggingFaceImage, isHuggingFaceConfigured } from "../lib/providers/huggingface";

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
    `A stylized portrait avatar of a fictional character named ${character.name}. ` +
    `Tagline: ${character.tagline || "n/a"}. Traits: ${character.personality}. ` +
    `Digital illustration, shoulders-up portrait, clean background, no text.`;

  if (character.isExplicit) {
    return (
      `${base} Mature, alluring adult aesthetic; confident sensuality, flattering lighting, suggestive or revealing ` +
      `fashion that fits the persona. Evocative but portrait-focused (shoulders-up), no text or watermarks.`
    );
  }

  return `${base} Attractive stylized character art.`;
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

// ---------------------------------------------------------------------------
// Image-gen fallback chain: Pollinations (free, keyless, always available,
// and handles explicit personas unfiltered) tried first; Hugging Face
// (FLUX.1-schnell) is the fallback when HUGGINGFACE_API_KEY is set and
// Pollinations fails or times out.
// ---------------------------------------------------------------------------
async function generateAvatarImage(
  character: { isExplicit?: boolean },
  prompt: string,
  timeoutMs: number
): Promise<{ bytes: Buffer; provider: string }> {
  const errors: string[] = [];

  try {
    const bytes = await generatePollinationsImage(character, prompt, timeoutMs);
    return { bytes, provider: "pollinations" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[avatar] Pollinations failed, falling back to Hugging Face:", msg);
    errors.push(`pollinations: ${msg}`);
  }

  if (isHuggingFaceConfigured()) {
    try {
      const bytes = await generateHuggingFaceImage(prompt, timeoutMs);
      return { bytes, provider: "huggingface" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`huggingface: ${msg}`);
    }
  }

  throw new Error("All image providers failed: " + errors.join("; "));
}

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

  // Provider name is logged server-side only for debugging — never sent in
  // the API response, so the client/user has no way to see which service
  // generated a given avatar.
  console.log(`[avatar] generated via ${result.provider}`);
  return res.json({ character: updated });
}));

export default router;
