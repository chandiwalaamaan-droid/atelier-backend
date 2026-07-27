// Tensor.Art — free tier image generation service with relatively uncensored
// content policies. Requires a free API key from tensor.art.
// Set TENSOR_ART_API_KEY to enable this provider; if unset, it's simply
// skipped in the fallback chain (see routes/avatar.ts).
export function isTensorArtConfigured(): boolean {
  return Boolean(process.env.TENSOR_ART_API_KEY);
}

/**
 * Requests one image from Tensor.Art for the given prompt.
 * Returns PNG/JPEG bytes on success. Throws on any failure (missing
 * credentials, network error, timeout) so the caller can fall through
 * to the next provider.
 */
export async function generateTensorArtImage(
  prompt: string,
  width: number,
  height: number,
  timeoutMs: number
): Promise<Buffer> {
  const apiKey = process.env.TENSOR_ART_API_KEY;
  if (!apiKey) throw new Error("TENSOR_ART_API_KEY not set");

  const url = "https://api.tensor.art/v1/text-to-image";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        width,
        height,
        nologo: true,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Tensor.Art request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Tensor.Art API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const contentType = res.headers.get("content-type") || "";

  // Tensor.Art may return JSON with a URL to the generated image
  if (contentType.includes("application/json")) {
    const json = await res.json().catch(() => ({}));
    const imageUrl = json?.data?.url || json?.url || json?.image_url;
    if (imageUrl) {
      const imageRes = await fetch(imageUrl);
      if (!imageRes.ok) {
        throw new Error(`Tensor.Art failed to serve generated image: ${imageRes.status}`);
      }
      const arrayBuffer = await imageRes.arrayBuffer();
      const bytes = Buffer.from(arrayBuffer);
      if (!bytes.length) throw new Error("Tensor.Art returned an empty image");
      return bytes;
    }
    throw new Error(`Tensor.Art returned JSON without image URL: ${JSON.stringify(json).slice(0, 300)}`);
  }

  // Raw image bytes
  if (!contentType.startsWith("image/")) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Tensor.Art returned non-image response: ${errText.slice(0, 300)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (!bytes.length) throw new Error("Tensor.Art returned an empty image");
  return bytes;
}