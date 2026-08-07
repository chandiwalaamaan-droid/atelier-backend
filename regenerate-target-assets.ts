import fs from "fs";
import path from "path";
import https from "https";

import { characters as TARGET_CHARACTERS } from "./sfw-premium-characters-with-assets";

const TARGETS = [
  { name: "Yuki Kamishiro", slug: "yuki-kamishiro" },
  { name: "Zara Night", slug: "zara-night" },
  { name: "Detective Elena Marchetti", slug: "detective-elena-marchetti" },
  { name: "Clover Finch", slug: "clover-finch" },
  { name: "Dr. Ari Vesper", slug: "dr-ari-vesper" },
];

const ASSETS_DIR = path.join(__dirname, "..", "public", "assets", "characters");
const BG_DIR = path.join(ASSETS_DIR, "backgrounds");
const DELAY_MS = 3000;
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 3000;

const PROMPT_LOOKUP = Object.fromEntries(
  TARGET_CHARACTERS.map((character) => [character.name, character])
);

function fetchImageWithRetry(url: string, retries = MAX_RETRIES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    async function tryFetch() {
      attempt++;
      try {
        const buffer = await fetchImage(url);
        resolve(buffer);
      } catch (err) {
        if (attempt >= retries) return reject(err);
        const msg = err instanceof Error ? err.message : String(err);
        const isRateLimit = /429|Too Many Requests|Queue full/i.test(msg);
        const isTimeout = /timed out/i.test(msg);
        if (isRateLimit || isTimeout) {
          const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
          await delay(backoff);
          return tryFetch();
        }
        reject(err);
      }
    }

    tryFetch();
  });
}

function fetchImage(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : require("http");
    const req = lib.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) return resolve(fetchImage(redirectUrl));
        return reject(new Error(`Redirect without location: ${res.statusCode}`));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function generateAvatar(character: { name: string; slug: string; isExplicit?: boolean }) {
  const filePath = path.join(ASSETS_DIR, `${character.slug}.png`);
  const characterData = PROMPT_LOOKUP[character.name];
  const prompt =
    characterData && characterData.avatarPrompt
      ? characterData.avatarPrompt
      : /* fallback */
        "A highly polished digital portrait of a fictional character named " +
        character.name +
        ". Cinematic lighting, ultra-detailed rendering, smooth skin tones, crisp focus, and a refined shoulders-up composition with a clean, subtle background. " +
        "Beautiful stylized character art with expressive emotion, rich detail, and a professional finish. 8k, masterpiece quality, no text, no watermark.";

  const isExplicit = character.isExplicit === true;

  const params = new URLSearchParams({
    width: "1024",
    height: "1024",
    model: isExplicit ? "vendouple/uncensored-image-enhanced" : "flux",
    nologo: "true",
    safe: isExplicit ? "false" : "true",
    seed: String(Math.floor(Math.random() * 1000000)),
    steps: "30",
  });

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;

  try {
    const buffer = await fetchImageWithRetry(url);
    if (buffer.length < 1000) throw new Error("Image too small, likely an error response");
    fs.writeFileSync(filePath, buffer);
    console.log(`  ✅ ${character.name} — avatar saved (${buffer.length} bytes)`);
    return true;
  } catch (err) {
    console.error(`  ❌ ${character.name} — avatar failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function generateBackground(character: { name: string; slug: string; isExplicit?: boolean }) {
  const filePath = path.join(BG_DIR, `${character.slug}-bg.png`);
  const characterData = PROMPT_LOOKUP[character.name];

  const isExplicit = character.isExplicit === true;

  const prompt =
    characterData && characterData.scenePromptTemplate
      ? characterData.scenePromptTemplate.replace("{scene}", "character portrait background")
      : null;
  const bgPrompt =
    prompt ||
    "A stunning atmospheric background scene for " +
      character.name +
      ". Wide landscape, soft focus, dreamy lighting, rich colors, highly detailed, cinematic atmosphere. " +
      "The scene evokes the character's world and mood without any text, watermarks, or people in the foreground. " +
      "Beautiful, immersive environment with a sense of wonder and emotional depth. Soft bokeh, natural landscape, painterly quality, suitable as a chat wallpaper, no people in foreground, atmospheric.";

  const params = new URLSearchParams({
    width: "1920",
    height: "1080",
    model: isExplicit ? "vendouple/uncensored-image-enhanced" : "flux",
    nologo: "true",
    safe: isExplicit ? "false" : "true",
    seed: String(Math.floor(Math.random() * 1000000)),
    steps: "30",
  });

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(bgPrompt)}?${params.toString()}`;

  try {
    const buffer = await fetchImageWithRetry(url);
    if (buffer.length < 1000) throw new Error("Image too small, likely an error response");
    fs.writeFileSync(filePath, buffer);
    console.log(`  ✅ ${character.name} — background saved (${buffer.length} bytes)`);
    return true;
  } catch (err) {
    console.error(`  ❌ ${character.name} — background failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function main() {
  console.log(`Regenerating assets for ${TARGETS.length} characters...\n`);

  for (const character of TARGETS) {
    const characterData = PROMPT_LOOKUP[character.name];
    console.log(`\n[${character.name}]`);
    await generateAvatar({ ...character, isExplicit: characterData?.isExplicit });
    await delay(DELAY_MS);
    await generateBackground({ ...character, isExplicit: characterData?.isExplicit });
    await delay(DELAY_MS);
  }

  console.log("\n✅ Targeted regeneration complete.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
