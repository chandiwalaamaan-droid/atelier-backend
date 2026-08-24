// DiceBear — procedural SVG/PNG avatar generator, not an AI provider.
// This is the true last resort in the avatar fallback chain: no
// credentials, no meaningful rate limit at this app's volume, and
// (being deterministic per seed) it effectively never fails. It exists
// purely so a user's "Generate with AI" click never ends in a hard
// error even if every real AI provider is down at the same moment — the
// user gets a generic avatar instead of a 502, and can regenerate or
// upload manually afterward.
//
// Not used for backgrounds — DiceBear only produces square icon-style
// avatars, so there's no equivalent fallback for the 1920x1080 scene
// images background generation needs.
const DICEBEAR_BASE_URL = "https://api.dicebear.com/9.x";

/**
 * Fetches a deterministic PNG avatar for the given seed. Should only
 * ever be reached as the final step after every real AI provider has
 * already failed.
 */
export async function generateDicebearAvatar(
  seed: string,
  timeoutMs: number,
  style: string = "bottts"
): Promise<Buffer> {
  const url = `${DICEBEAR_BASE_URL}/${style}/png?seed=${encodeURIComponent(seed)}&size=512`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`DiceBear request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`DiceBear error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (!bytes.length) throw new Error("DiceBear returned an empty image");
  return bytes;
}
