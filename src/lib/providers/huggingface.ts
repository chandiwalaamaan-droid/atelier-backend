// Hugging Face Inference — free-tier fallback (rate-limited to a few
// hundred requests/hour, no fixed daily image cap, no credit card
// required) via the unified Hugging Face Inference Providers router.
// Requires a Hugging Face user access token (Settings -> Access Tokens ->
// "Read" scope is enough). Set HUGGINGFACE_API_KEY and (optionally)
// HUGGINGFACE_IMAGE_MODEL to enable this provider; if the token is unset,
// it's simply skipped in the fallback chain (see routes/avatar.ts).
//
// Defaults to FLUX.1-schnell: fast (1-4 steps), strong prompt adherence,
// and the model most current Hugging Face free-tier guides point to for
// text-to-image. If HUGGINGFACE_IMAGE_MODEL is set to a Stable Diffusion
// model instead, the request parameters are adjusted accordingly — SD
// needs real guidance + more steps, Flux is a distilled model tuned to
// look right with near-zero guidance and very few steps.
const MODEL = process.env.HUGGINGFACE_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell";

function routerUrl(): string {
  return `https://router.huggingface.co/hf-inference/models/${MODEL}`;
}

function buildParameters(): Record<string, unknown> {
  if (MODEL.toLowerCase().includes("flux")) {
    return { num_inference_steps: 4, guidance_scale: 0.0 };
  }
  // Stable Diffusion family (SD 1.5 / 2.1 / XL) and most other diffusion
  // checkpoints — real guidance + more steps or quality drops sharply.
  return { num_inference_steps: 30, guidance_scale: 7.5 };
}

export function isHuggingFaceConfigured(): boolean {
  return Boolean(process.env.HUGGINGFACE_API_KEY);
}

/**
 * Requests one image from Hugging Face's Inference Providers router for
 * the given prompt. Returns image bytes on success. Throws on any
 * failure (missing token, model still cold-loading, rate limit, network
 * error, timeout) so the caller can fall through to the next provider.
 */
export async function generateHuggingFaceImage(
  prompt: string,
  timeoutMs: number
): Promise<Buffer> {
  const token = process.env.HUGGINGFACE_API_KEY;
  if (!token) throw new Error("HUGGINGFACE_API_KEY not set");
  if (!MODEL) throw new Error("HUGGINGFACE_IMAGE_MODEL is set but empty — provide a valid model name");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(routerUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // Skip Hugging Face's response cache so retries with the same
        // prompt (e.g. after a user hits "regenerate") don't just get
        // handed back the exact same image.
        "x-use-cache": "false",
      },
      body: JSON.stringify({ inputs: prompt, parameters: buildParameters() }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Hugging Face request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const contentType = res.headers.get("content-type") || "";

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    // A cold model returns 503 with an estimated_time field rather than
    // an outright failure — still thrown here so the caller falls
    // through to the next provider instead of blocking on a 20-60s load.
    throw new Error(`Hugging Face API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  // Successful image responses come back as raw bytes with an image/*
  // content-type. A JSON content-type on a 200 means something other
  // than an image came back — surface it rather than silently discarding
  // what might actually be a usable image (same bug class as the earlier
  // Cloudflare Flux parsing issue: don't assume, check the content-type).
  if (contentType.startsWith("image/")) {
    const arrayBuffer = await res.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    if (!bytes.length) throw new Error("Hugging Face returned an empty image");
    return bytes;
  }

  const bodyText = await res.text().catch(() => "");
  throw new Error(`Hugging Face returned non-image response: ${bodyText.slice(0, 300)}`);
}
