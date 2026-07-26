// Hugging Face Inference API — free tier (rate-limited, shared queue) image
// generation. Requires a free HF account + access token (huggingface.co ->
// Settings -> Access Tokens -> create a "read" token). Set HUGGINGFACE_API_KEY
// to enable this provider; if unset, it's simply skipped in the fallback
// chain (see routes/avatar.ts).
//
// Model defaults to FLUX.1-schnell: fast (distilled, few-step) and commonly
// available on the free serverless tier. Override with
// HUGGINGFACE_IMAGE_MODEL if you want a different model (e.g. an SDXL
// variant), but note gated/licensed models require accepting their terms on
// huggingface.co with the same account before the token can use them.
const DEFAULT_MODEL = "black-forest-labs/FLUX.1-schnell";

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
  const url = `https://api-inference.huggingface.co/models/${model}`;

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
    const errText = await res.text().catch(() => "");
    throw new Error(`Hugging Face API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Hugging Face returned non-image response: ${errText.slice(0, 300)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (!bytes.length) throw new Error("Hugging Face returned an empty image");
  return bytes;
}
