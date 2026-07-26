import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import multer from "multer";
import { prisma } from "../lib/db";
import { getCurrentUserId } from "../lib/auth";
import { uploadAvatarBuffer } from "../lib/cloudinary";

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
  const timeoutMs = Number(process.env.IMAGE_GEN_TIMEOUT_SECONDS || "30") * 1000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let apiRes: Response;
  try {
    apiRes = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return res.status(504).json({
        error: `Image generation timed out after ${timeoutMs / 1000}s. Try again, or upload an image instead.`,
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!apiRes.ok) {
    const errText = await apiRes.text().catch(() => "");
    console.error("Image generation failed", errText);
    return res.status(502).json({ error: "Image generation failed. Try again, or upload an image instead." });
  }

  const arrayBuffer = await apiRes.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (!bytes.length) {
    return res.status(502).json({ error: "Image generation returned no image." });
  }

  const publicId = `${req.params.id}-${Date.now()}-generated`;
  const avatarUrl = await uploadAvatarBuffer(bytes, publicId);
  const updated = await prisma.character.update({ where: { id: req.params.id }, data: { avatarUrl } });

  return res.json({ character: updated });
}));

export default router;
