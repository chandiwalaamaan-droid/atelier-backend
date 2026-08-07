/**
 * Retry generating images for characters that failed due to rate limits
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUTPUT_DIR = resolve(ROOT, "public/assets/characters");

mkdirSync(OUTPUT_DIR, { recursive: true });
mkdirSync(resolve(OUTPUT_DIR, "backgrounds"), { recursive: true });

const characters = JSON.parse(readFileSync(resolve(ROOT, "dark-taboo-characters.json"), "utf-8"));

const POLLINATIONS_URL = "https://image.pollinations.ai/prompt";

async function downloadImage(url, filepath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(filepath, buffer);
  console.log(`  ✓ Saved: ${filepath.split("/").pop()}`);
}

function buildPortraitPrompt(char) {
  const base = `High quality cinematic portrait of ${char.name}, ${char.tagline}. Personality: ${char.personality}. ${char.backstory.slice(0, 200)}.`;
  const style = `Ultra detailed, photorealistic, 8K, professional studio lighting, sharp focus, flawless skin texture, elegant composition, shoulders-up framing, rich color grading, award-winning photography, stunning beauty, captivating gaze, high fashion aesthetic, masterpiece, trending on ArtStation.`;
  const bg = `Clean blurred background with thematic accent lighting, subtle bokeh, professional backdrop.`;
  return `${base} Mature sophisticated adult beauty, confident sensual presence, tasteful allure, seductive expression, magnetic charisma. ${bg} ${style}`;
}

function buildBackgroundPrompt(char) {
  const scenePrompts = {
    "Evelyn Rose": "Peaceful garden at golden hour, rose bushes in bloom, white picket fence, cozy porch with swing, warm nostalgic suburban atmosphere, neighborly warmth",
    "Nyra Shadow": "Interdimensional void with swirling shadows, purple energy vortex, floating rocks, demonic runes glowing, reality tearing, cosmic horror meets dark beauty"
  };
  const scene = scenePrompts[char.name] || `${char.tagline} atmospheric scene, cinematic lighting`;
  return `${scene}, cinematic lighting, ultra detailed, 8K, dramatic atmosphere, rich color palette, professional photography, wide angle establishing shot`;
}

async function generateAvatar(char, index) {
  const prompt = buildPortraitPrompt(char);
  const encodedPrompt = encodeURIComponent(prompt);
  const params = new URLSearchParams({
    width: "1024", height: "1024", model: "flux", nologo: "true",
    safe: char.isExplicit ? "false" : "true",
    seed: String(3000 + index),
    steps: "30",
  });
  const url = `${POLLINATIONS_URL}/${encodedPrompt}?${params}`;
  const path = resolve(OUTPUT_DIR, `${char.name.toLowerCase().replace(/\s+/g, "-")}.png`);
  await downloadImage(url, path);
}

async function generateBackground(char, index) {
  const prompt = buildBackgroundPrompt(char);
  const encodedPrompt = encodeURIComponent(prompt);
  const params = new URLSearchParams({
    width: "1920", height: "1080", model: "flux", nologo: "true",
    safe: "true", seed: String(4000 + index),
    steps: "30",
  });
  const url = `${POLLINATIONS_URL}/${encodedPrompt}?${params}`;
  const path = resolve(OUTPUT_DIR, "backgrounds", `${char.name.toLowerCase().replace(/\s+/g, "-")}-bg.png`);
  await downloadImage(url, path);
}

// Characters that need retry (evelyn-rose, nyra-shadow) + lilith-crowe avatar + mistress-vesper bg
const retryIndices = [28, 29]; // 0-indexed: Evelyn Rose=28, Nyra Shadow=29

async function main() {
  console.log(`\n🔄 Retrying failed images...\n`);
  
  for (const i of retryIndices) {
    const char = characters[i];
    console.log(`[${char.name}]...`);
    
    // Wait before retrying
    await new Promise(r => setTimeout(r, 3000));
    
    try {
      await generateAvatar(char, i);
      console.log(`  📸 Profile photo generated`);
    } catch (err) {
      console.error(`  ❌ Avatar failed: ${err.message}`);
    }
    
    await new Promise(r => setTimeout(r, 2000));
    
    try {
      await generateBackground(char, i);
      console.log(`  🖼️  Background generated`);
    } catch (err) {
      console.error(`  ❌ Background failed: ${err.message}`);
    }
  }
  
  console.log(`\n✅ Retry complete!\n`);
}

main().catch(console.error);