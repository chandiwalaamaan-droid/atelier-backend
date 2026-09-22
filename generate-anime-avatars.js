const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const BACKEND_DIR = __dirname;
const FRONTEND_DIR = path.join(BACKEND_DIR, "..", "..", "rolichat-frontend-with-ga");
const ASSETS_DIR = path.join(FRONTEND_DIR, "public", "assets", "characters");
const BG_DIR = path.join(ASSETS_DIR, "backgrounds");
const SOURCE_FILE = path.join(BACKEND_DIR, "anime-characters-with-assets.ts");

fs.mkdirSync(BG_DIR, { recursive: true });

const DELAY_MS = 4000;
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 3000;

function fetchImageWithRetry(url, retries = MAX_RETRIES) {
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
          console.log(`    ⏳ Rate-limited or timed out (attempt ${attempt}/${retries}), backing off ${backoff}ms...`);
          await delay(backoff);
          return tryFetch();
        }
        reject(err);
      }
    }
    tryFetch();
  });
}

function fetchImage(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) return resolve(fetchImage(redirectUrl));
        return reject(new Error(`Redirect without location: ${res.statusCode}`));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const tsContent = fs.readFileSync(SOURCE_FILE, "utf8");

const charBlockRegex = /\{\s*name:\s*"([^"]+)",[\s\S]*?avatarUrl:\s*"([^"]+)",\s*backgroundUrl:\s*"([^"]*)",[\s\S]*?avatarPrompt:\s*"((?:[^"\\]|\\.)*)",[\s\S]*?scenePromptTemplate:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;

const characters = [];
let match;
while ((match = charBlockRegex.exec(tsContent)) !== null) {
  const name = match[1];
  const avatarUrl = match[2];
  const backgroundUrl = match[3];
  const avatarPrompt = JSON.parse(`"${match[4]}"`);
  const scenePromptTemplate = JSON.parse(`"${match[5]}"`);
  characters.push({ name, avatarUrl, backgroundUrl, avatarPrompt, scenePromptTemplate });
}

console.log(`Parsed ${characters.length} anime characters from source file.\n`);

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function generateBackground(character) {
  const slug = slugify(character.name);
  const filePath = path.join(BG_DIR, `${slug}-bg.png`);

  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
    console.log(`  ⏭️  ${character.name} — background already exists`);
    return { ok: true, skipped: true };
  }

  const bgPrompt =
    "A stunning atmospheric background scene for " +
    character.name +
    ". Wide landscape, soft focus, dreamy lighting, rich colors, highly detailed, cinematic atmosphere. " +
    "The scene evokes the character's world and mood without any text, watermarks, or people in the foreground. " +
    "Beautiful, immersive environment with a sense of wonder and emotional depth. Soft bokeh, natural landscape, painterly quality, suitable as a chat wallpaper, no people in foreground, atmospheric.";

  const params = new URLSearchParams({
    width: "1920",
    height: "1080",
    model: "zimage",
    nologo: "true",
    safe: "true",
    seed: String(Math.floor(Math.random() * 1000000)),
    steps: "30",
  });

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(bgPrompt)}?${params.toString()}`;

  try {
    const buffer = await fetchImageWithRetry(url);
    if (buffer.length < 1000) throw new Error("Image too small, likely an error response");
    fs.writeFileSync(filePath, buffer);
    console.log(`  ✅ ${character.name} — background saved (${buffer.length} bytes)`);
    return { ok: true, skipped: false, path: `/assets/characters/backgrounds/${slug}-bg.png` };
  } catch (err) {
    console.error(`  ❌ ${character.name} — background failed: ${err.message}`);
    return { ok: false, skipped: false, error: err.message };
  }
}

async function main() {
  console.log(`Generating backgrounds for ${characters.length} anime characters...\n`);

  let bgCount = 0;
  let skipped = 0;
  let failed = 0;
  const results = [];

  for (const character of characters) {
    console.log(`\n[${character.name}]`);
    const result = await generateBackground(character);
    results.push({ name: character.name, ...result });
    if (result.ok) {
      if (result.skipped) skipped++;
      else bgCount++;
    } else {
      failed++;
    }
    await delay(DELAY_MS);

    if ((bgCount + failed) % 10 === 0 && bgCount + failed > 0) {
      console.log(`\n--- Progress: ${bgCount + failed}/${characters.length} characters processed ---`);
    }
  }

  console.log(`\n✅ Done! Generated ${bgCount} backgrounds, ${skipped} skipped, ${failed} failed.`);

  // Update the TS file with background URLs
  let updatedContent = tsContent;
  for (const result of results) {
    if (result.ok && !result.skipped && result.path) {
      const slug = slugify(result.name);
      const escapedName = result.name.replace(/"/g, '\\"');
      const oldPattern = new RegExp(`(\\{\\s*"name":\\s*"${escapedName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}",[\\s\\S]*?"backgroundUrl":\\s*")([^"]+)(")`);
      const replacement = `$1${result.path}$3`;
      updatedContent = updatedContent.replace(oldPattern, replacement);
    }
  }

  fs.writeFileSync(SOURCE_FILE, updatedContent);
  console.log(`\n✅ Updated ${SOURCE_FILE} with generated background URLs.`);
}

main().catch(console.error);
