// Generates PNG avatar and background images for all 50 SFW characters
// using the free, keyless Pollinations.ai API (same provider used by the backend).

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const ASSETS_DIR = path.join(__dirname, "..", "public", "assets", "characters");
const BG_DIR = path.join(ASSETS_DIR, "backgrounds");

fs.mkdirSync(ASSETS_DIR, { recursive: true });
fs.mkdirSync(BG_DIR, { recursive: true });

const DELAY_MS = 5000; // Pollinations free tier: one request per IP, need generous spacing
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 3000;

async function fetchImageWithRetry(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetchImage(url);
    } catch (err) {
      const msg = err.message || String(err);
      const isRateLimit = /429|Too Many Requests|Queue full/i.test(msg);
      const isTimeout = /timed out/i.test(msg);
      if (attempt === retries) throw err;
      if (isRateLimit || isTimeout) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        console.log(`    ⏳ Rate-limited or timed out (attempt ${attempt}/${retries}), backing off ${backoff}ms...`);
        await delay(backoff);
      } else {
        throw err;
      }
    }
  }
}

// Parse the avatarPrompt, scenePromptTemplate, avatarUrl, backgroundUrl, and name
// from the TypeScript source file using regex.
const tsContent = fs.readFileSync(
  path.join(__dirname, "sfw-premium-characters-with-assets.ts"),
  "utf8"
);

// Extract all character objects
const charBlockRegex = /\{\s*"name":\s*"([^"]+)",[\s\S]*?"avatarUrl":\s*"([^"]+)",\s*"backgroundUrl":\s*"([^"]+)",\s*"avatarPrompt":\s*"((?:[^"\\]|\\.)*)",\s*"scenePromptTemplate":\s*"((?:[^"\\]|\\.)*)"\s*\}/g;

const characters = [];
let match;
while ((match = charBlockRegex.exec(tsContent)) !== null) {
  const name = match[1];
  const avatarUrl = match[2];
  const backgroundUrl = match[3];
  // Unescape the JSON string values (handle \", \\n, etc.)
  const avatarPrompt = JSON.parse(`"${match[4]}"`);
  const scenePromptTemplate = JSON.parse(`"${match[5]}"`);
  characters.push({ name, avatarUrl, backgroundUrl, avatarPrompt, scenePromptTemplate });
}

console.log(`Parsed ${characters.length} characters from source file.`);

function fetchImage(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          resolve(fetchImage(redirectUrl));
        } else {
          reject(new Error(`Redirect without location: ${res.statusCode}`));
        }
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
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

async function generateAvatar(character) {
  const slug = character.avatarUrl.replace("/assets/characters/", "").replace(".png", "");
  const filePath = path.join(ASSETS_DIR, `${slug}.png`);

  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
    console.log(`  ⏭️  ${character.name} — avatar already exists`);
    return true;
  }

  const params = new URLSearchParams({
    width: "1024",
    height: "1024",
    model: "flux",
    nologo: "true",
    safe: "true",
    seed: String(Math.floor(Math.random() * 1000000)),
    steps: "30",
  });

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(character.avatarPrompt)}?${params.toString()}`;

  try {
    const buffer = await fetchImageWithRetry(url);
    if (buffer.length < 1000) throw new Error("Image too small, likely an error response");
    fs.writeFileSync(filePath, buffer);
    console.log(`  ✅ ${character.name} — avatar saved (${buffer.length} bytes)`);
    return true;
  } catch (err) {
    console.error(`  ❌ ${character.name} — avatar failed: ${err.message}`);
    return false;
  }
}

async function generateBackground(character) {
  const slug = character.backgroundUrl.replace("/assets/characters/backgrounds/", "").replace("-bg.png", "");
  const filePath = path.join(BG_DIR, `${slug}-bg.png`);

  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
    console.log(`  ⏭️  ${character.name} — background already exists`);
    return true;
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
    model: "flux",
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
    return true;
  } catch (err) {
    console.error(`  ❌ ${character.name} — background failed: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log(`Generating images for ${characters.length} SFW characters...\n`);

  let avatarCount = 0;
  let bgCount = 0;
  let failed = 0;

  for (const character of characters) {
    console.log(`\n[${character.name}]`);
    const avatarOk = await generateAvatar(character);
    if (avatarOk) avatarCount++;
    else failed++;
    await delay(DELAY_MS);

    const bgOk = await generateBackground(character);
    if (bgOk) bgCount++;
    else failed++;
    await delay(DELAY_MS);

    if ((avatarCount + failed) % 10 === 0) {
      console.log(`\n--- Progress: ${avatarCount + failed}/${characters.length} characters processed ---`);
    }
  }

  console.log(`\n✅ Done! Generated ${avatarCount} avatars, ${bgCount} backgrounds, ${failed} failed.`);
}

main().catch(console.error);
