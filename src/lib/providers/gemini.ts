// Google Gemini image generation ("Nano Banana") — used as the first-priority
// provider for SFW avatar/background generation. Requires GEMINI_API_KEY;
// if unset, this provider is simply skipped in the fallback chain (see
// routes/avatar.ts), same pattern as Cloudflare.
//
// Model defaults to gemini-3.1-flash-lite-image ("Nano Banana 2 Lite") —
// the cheapest current Gemini image model (~$0.02-0.03/image at 1K) and
// the fastest in the family, which matters here since this sits in the
// front of a live user-facing request rather than a background job.
// Override with GEMINI_IMAGE_MODEL if a different quality/cost tradeoff
// is needed (e.g. gemini-3.1-flash-image-preview for higher fidelity).
//
// NOT used for NSFW generation: Gemini's safety filters reliably block
// explicit content, so trying it first there would just burn the request
// budget and add latency before falling through to Pollinations anyway.
// avatar.ts's provider chain skips this provider entirely when
// isExplicit is true rather than relying on it to fail.
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-lite-image";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Requests one image from Gemini for the given prompt. Returns image bytes
 * (PNG/JPEG, whatever Gemini returns — sharp handles either downstream) on
 * success. Throws on any failure (missing key, safety block, quota, network
 * error, timeout) so the caller can fall through to the next provider.
 */
export async function generateGeminiImage(prompt: string, timeoutMs: number): Promise<Buffer> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const url = `${GEMINI_API_URL}/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Gemini request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // 429 = quota/rate limit, 403 = billing/permission — both need to
    // read as recognizable by isRateLimitError() in circuitBreaker.ts so
    // the breaker trips instead of retrying a dead key on every request.
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data: any = await res.json().catch(() => null);
  if (!data) throw new Error("Gemini returned an unparseable response");

  // A prompt can be blocked outright before any candidate is produced —
  // surface that distinctly rather than falling through to the generic
  // "no image data" error below, since it's a content-policy block, not
  // a transient failure, and retrying it won't help.
  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Gemini blocked the prompt: ${blockReason}`);
  }

  const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p?.inlineData?.data);
  if (!imagePart) {
    const finishReason = data?.candidates?.[0]?.finishReason;
    throw new Error(
      finishReason ? `Gemini returned no image (finishReason: ${finishReason})` : "Gemini returned no image data"
    );
  }

  const bytes = Buffer.from(imagePart.inlineData.data, "base64");
  if (!bytes.length) throw new Error("Gemini returned an empty image");
  return bytes;
}
