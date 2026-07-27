// Hugging Face Inference API — free tier (rate-limited, shared queue) image
// generation. Requires a free HF account + access token (huggingface.co ->
// Settings -> Access Tokens -> create a "read" token). Set HUGGINGFACE_API_KEY
// to enable this provider; if unset, it's simply skipped in the fallback
// chain (see routes/avatar.ts).
//
// Model defaults to stable-diffusion-2-1: HF's hf-inference provider has
// pulled FLUX entirely (both schnell and dev return HTTP 410 as of mid-2026,
// apparently moved to paid third-party providers like fal-ai/replicate).
// SD 2.1 is an older but stable model that's been on HF's free serverless
// tier since 2022 and is still what HF's own SDK docs demo as the default
// free-tier example. Override with HUGGINGFACE_IMAGE_MODEL if you want a
// different model, but verify it's still live first — HF's free-tier
// catalog has been shrinking, so don't assume a model listed in docs is
// actually being served: check
// https://huggingface.co/api/models?inference_provider=hf-inference&pipeline_tag=text-to-image
// before switching, and expect this to need occasional revisiting.
const DEFAULT_MODEL = "stabilityai/stable-diffusion-2-1";

export function isHuggingFaceConfigured(): boolean {
  return Boolean(process.env.HUGGINGFACE_API_KEY);
}

/**
 * Requests one image from the HF Inference API for the given prompt.
 * Returns PNG/JPEG bytes on success. Throws on any failure (missing key,
 * model still loading / cold-starting, rate limit, network error, timeout)
 * so the caller can fall through to the next provider.
 */
export async function generateHuggingFaceImage(
  prompt: string,
  timeoutMs: number
): Promise<Buffer> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) throw new Error("HUGGINGFACE_API_KEY not set");

  const model = process.env.HUGGINGFACE_IMAGE_MODEL || DEFAULT_MODEL;
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
        // Ask HF to wait for a cold model to spin up rather than 503-ing
        // immediately, but only up to our own timeout below.
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
    // On failure HF returns JSON (error message / estimated_time), not an
    // image — surface that text for logging instead of a useless byte dump.
    // Include the model + URL so logs show exactly what was requested,
    // instead of us having to guess whether an env var override is in play.
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
