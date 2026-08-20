// Cloudflare Workers AI — free tier (10,000 "neurons"/day, resets daily,
// no credit card required) image generation. Requires a Cloudflare account
// ID + a Workers AI API token (Cloudflare dashboard -> AI -> Workers AI ->
// "Create a Workers AI API Token"). Set CLOUDFLARE_ACCOUNT_ID and
// CLOUDFLARE_API_TOKEN to enable this provider; if unset, it's simply
// skipped in the fallback chain (see routes/avatar.ts).
//
// Model defaults to Flux Schnell: reverted from Leonardo Phoenix 1.0 after
// Phoenix burned through the entire 10,000/day free neuron allowance
// almost immediately in production (2026-08-20 — confirmed via Cloudflare
// error code 4006, "used up your daily free allocation of 10,000
// neurons"). Phoenix is billed per tile+step as a paid partner model
// rather than drawing from the flat free pool the way Flux Schnell does,
// so at this app's request volume it isn't sustainable as the default —
// once the quota trips, Cloudflare 429s on every request for the rest of
// the day, and if Pollinations has a rough patch at the same time (as it
// did here — timeouts, circuit breaker opening) avatar/background
// generation fails outright with no fallback left.
//
// Flux Schnell still gives meaningfully better prompt adherence than
// SDXL 1.0 (the original default) while staying inside the free neuron
// pool. If Cloudflare billing is set up and the quota exhaustion isn't a
// concern, Phoenix can be brought back via CLOUDFLARE_IMAGE_MODEL, but
// don't flip the default back without billing enabled — this is now a
// documented trade-off, not an accident.
const MODEL = process.env.CLOUDFLARE_IMAGE_MODEL || "@cf/black-forest-labs/flux-1-schnell";

// Only meaningful for Leonardo Phoenix (a `guidance` knob for how
// strictly it follows the prompt); harmless no-op field for Flux Schnell
// and other models, which just ignore an unrecognized body field. Kept
// so switching CLOUDFLARE_IMAGE_MODEL back to Phoenix later doesn't also
// require re-adding this.
const GUIDANCE = Number(process.env.CLOUDFLARE_IMAGE_GUIDANCE || "7");

// Request body varies by model family, so it's built per-model rather
// than hardcoded — Flux Schnell is a distilled model with a hard-capped
// steps param (default 4, max 8, param name `steps`) and no `guidance`
// field at all; Phoenix/FLUX.2 use `num_steps` and support `guidance`.
// Sending the wrong field name or an out-of-range value doesn't
// necessarily error (Cloudflare can silently clamp or ignore unknown
// fields), but it's not something to rely on — build the right shape for
// whichever model is actually configured.
function buildRequestBody(prompt: string): Record<string, unknown> {
  if (MODEL.includes("flux-1-schnell")) {
    return { prompt, steps: 8 };
  }
  if (MODEL.includes("phoenix") || MODEL.includes("flux-2")) {
    return { prompt, guidance: GUIDANCE, num_steps: 30 };
  }
  // Unknown/other model (SDXL, DreamShaper, etc.) — just the prompt, let
  // Cloudflare apply that model's own defaults for everything else.
  return { prompt };
}

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
      body: JSON.stringify(buildRequestBody(prompt)),
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
