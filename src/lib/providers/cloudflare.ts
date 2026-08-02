// Cloudflare Workers AI — free tier (10,000 "neurons"/day, resets daily,
// no credit card required) image generation. Requires a Cloudflare account
// ID + a Workers AI API token (Cloudflare dashboard -> AI -> Workers AI ->
// "Create a Workers AI API Token"). Set CLOUDFLARE_ACCOUNT_ID and
// CLOUDFLARE_API_TOKEN to enable this provider; if unset, it's simply
// skipped in the fallback chain (see routes/avatar.ts).
//
// Model defaults to Stable Diffusion XL: Cloudflare's highest-quality
// text-to-image model for professional results. Override with
// CLOUDFLARE_IMAGE_MODEL if you want a different Workers AI text-to-image
// model (e.g. @cf/lykon/dreamshaper-8-lcm for faster generation with
// acceptable quality, or @cf/black-forest-labs/flux-1-schnell for Flux
// at the cost of stricter content filtering).
const MODEL = process.env.CLOUDFLARE_IMAGE_MODEL || "@cf/stabilityai/stable-diffusion-xl-base-1.0";

export function isCloudflareConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);
}

/**
 * Requests one image from Cloudflare Workers AI for the given prompt.
 * Returns PNG/JPEG bytes on success. Throws on any failure (missing
 * credentials, over the free daily neuron budget, network error, timeout)
 * so the caller can fall through to the next provider.
 *
* Note: unlike Pollinations, Workers AI's text-to-image models don't take
* arbitrary width/height — DreamShaper 8 LCM supports 256–2048px
* dimensions. The width/height args are accepted for signature parity
* with the other providers but are not sent to the API; callers
* needing a specific aspect ratio should resize the returned bytes
* downstream (this codebase already does that with sharp for
* avatar/scene post-processing).
 */
export async function generateCloudflareImage(
  prompt: string,
  timeoutMs: number
): Promise<Buffer> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) throw new Error("CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN not set");
  if (!MODEL) throw new Error("CLOUDFLARE_IMAGE_MODEL is set but empty — provide a valid model name");

  const model = MODEL;
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Cloudflare Workers AI request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const contentType = res.headers.get("content-type") || "";

  if (!res.ok) {
    // Cloudflare returns JSON on error (even with a 200-shaped envelope
    // sometimes) — surface that text for logging instead of a byte dump.
    const errText = await res.text().catch(() => "");
    throw new Error(`Cloudflare Workers AI error ${res.status}: ${errText.slice(0, 300)}`);
  }

  // Successful image responses come back as raw image bytes with an
  // image/* content-type. If we instead get JSON back, it's Cloudflare's
  // {"success":false,"errors":[...]} envelope even on a 200 status.
  if (!contentType.startsWith("image/")) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Cloudflare Workers AI returned non-image response: ${errText.slice(0, 300)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (!bytes.length) throw new Error("Cloudflare Workers AI returned an empty image");
  return bytes;
}
