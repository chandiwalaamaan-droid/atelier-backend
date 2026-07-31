// AI Horde (aihorde.net, formerly Stable Horde) — free, crowdsourced,
// community-run distributed Stable Diffusion cluster. No signup or API key
// required (falls back to the shared anonymous key), and unlike Pollinations
// or Cloudflare it can dispatch to slower, dedicated-GPU checkpoints instead
// of only fast/distilled ones — see QUALITY_MODELS below. Set
// AI_HORDE_API_KEY if you register your own free key: same access, just
// better queue priority (via kudos) than the anonymous key gets.
//
// Unlike the other providers, this one is async: submit a job, poll until a
// volunteer worker picks it up and finishes it, then download the result.
// That's why it takes its own timeout (timeoutMs, driven by
// AI_HORDE_TIMEOUT_SECONDS at the call site) instead of the short
// IMAGE_GEN_TIMEOUT_SECONDS used for Pollinations/Cloudflare — a queued
// job can legitimately take 30-90s depending on volunteer capacity.
const AI_HORDE_BASE = "https://aihorde.net/api/v2";
const ANON_API_KEY = "0000000000";
const POLL_INTERVAL_MS = 2000;

// Ordered best-quality-first. AI Horde workers each load a subset of these,
// so listing several gives the queue room to match an available worker
// without silently dropping to a lower-tier checkpoint. These are
// well-regarded general-purpose/portrait SDXL checkpoints — deliberately NOT
// fast/distilled models. The whole reason to use Horde here is to trade
// Pollinations' speed for a quality tier neither Pollinations nor
// Cloudflare's SDXL-Lightning reach.
const QUALITY_MODELS = ["AlbedoBase XL (SDXL)", "Juggernaut XL", "DreamShaper XL", "ICBINP XL"];

// Same idea, but for isExplicit characters — checkpoints that actually
// render mature content instead of refusing or silently blanking it.
const QUALITY_MODELS_NSFW = [
  "WAI-NSFW-illustrious-SDXL",
  "AlbedoBase XL (SDXL)",
  "Juggernaut XL",
  "DreamShaper XL",
];

export function isAiHordeConfigured(): boolean {
  // Works anonymously out of the box, so it's always available. An
  // AI_HORDE_API_KEY just improves queue priority.
  return true;
}

interface HordeCheckResponse {
  done?: boolean;
  faulted?: boolean;
  queue_position?: number;
  wait_time?: number;
}

interface HordeStatusResponse {
  generations?: Array<{ img: string; censored?: boolean }>;
}

async function submitJob(
  prompt: string,
  width: number,
  height: number,
  nsfw: boolean,
  apiKey: string
): Promise<string> {
  const models = nsfw ? QUALITY_MODELS_NSFW : QUALITY_MODELS;

  const res = await fetch(`${AI_HORDE_BASE}/generate/async`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({
      prompt,
      nsfw,
      // We handle content policy via the isExplicit flag ourselves; don't
      // let Horde additionally re-censor a knowingly-explicit request.
      censor_nsfw: false,
      models,
      r2: true, // return a downloadable URL instead of a giant base64 blob
      params: {
        width,
        height,
        steps: 30,
        cfg_scale: 7,
        sampler_name: "k_euler_a",
        karras: true,
        n: 1,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`AI Horde submit failed ${res.status}: ${errText.slice(0, 300)}`);
  }
  const body = (await res.json()) as { id?: string; message?: string };
  if (!body.id) throw new Error(`AI Horde did not return a job id: ${body.message || "unknown error"}`);
  return body.id;
}

async function pollUntilDone(id: string, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    const res = await fetch(`${AI_HORDE_BASE}/generate/check/${id}`);
    if (!res.ok) throw new Error(`AI Horde check failed: ${res.status}`);
    const check = (await res.json()) as HordeCheckResponse;
    if (check.faulted) throw new Error("AI Horde generation faulted (no worker could complete it)");
    if (check.done) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  // Best-effort cleanup so the job stops holding a worker slot after we give up on it.
  fetch(`${AI_HORDE_BASE}/generate/status/${id}`, { method: "DELETE" }).catch(() => {});
  throw new Error("AI Horde generation timed out waiting for a worker");
}

/**
 * Requests one image from the AI Horde community cluster. Returns image
 * bytes on success. Throws on any failure (queue timeout, faulted job,
 * network error) so the caller can fall through to the next provider.
 */
export async function generateAiHordeImage(
  character: { isExplicit?: boolean },
  prompt: string,
  width: number,
  height: number,
  timeoutMs: number
): Promise<Buffer> {
  const apiKey = process.env.AI_HORDE_API_KEY || ANON_API_KEY;
  const nsfw = Boolean(character.isExplicit);

  // SDXL checkpoints expect dimensions on 64px boundaries, capped at 1024
  // for anonymous/low-kudos requests.
  const w = Math.max(512, Math.min(1024, Math.round(width / 64) * 64));
  const h = Math.max(512, Math.min(1024, Math.round(height / 64) * 64));

  const id = await submitJob(prompt, w, h, nsfw, apiKey);
  await pollUntilDone(id, Date.now() + timeoutMs);

  const statusRes = await fetch(`${AI_HORDE_BASE}/generate/status/${id}`);
  if (!statusRes.ok) throw new Error(`AI Horde status fetch failed: ${statusRes.status}`);
  const status = (await statusRes.json()) as HordeStatusResponse;
  const gen = status.generations?.[0];
  if (!gen) throw new Error("AI Horde returned no generations");
  if (gen.censored) throw new Error("AI Horde worker's CSAM filter replaced this result");

  const imgRes = await fetch(gen.img);
  if (!imgRes.ok) throw new Error(`AI Horde image download failed: ${imgRes.status}`);
  const bytes = Buffer.from(await imgRes.arrayBuffer());
  if (!bytes.length) throw new Error("AI Horde returned an empty image");
  return bytes;
}
