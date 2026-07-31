/**
 * Generate profile photos and cover/background images for all 30 dark taboo characters
 * Uses Pollinations.ai (free, keyless image generation)
 * 
 * Run: node scripts/generate-avatars.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUTPUT_DIR = resolve(ROOT, "public/assets/characters");

// Ensure directories exist
mkdirSync(OUTPUT_DIR, { recursive: true });
mkdirSync(resolve(OUTPUT_DIR, "backgrounds"), { recursive: true });

const characters = JSON.parse(readFileSync(resolve(ROOT, "dark-taboo-characters.json"), "utf-8"));

const POLLINATIONS_URL = "https://image.pollinations.ai/prompt";

/**
 * Build a highly detailed portrait prompt for each character
 */
function buildPortraitPrompt(char) {
  const base = `High quality cinematic portrait of ${char.name}, ${char.tagline}. Personality: ${char.personality}. ${char.backstory.slice(0, 200)}.`;
  const style = `Ultra detailed, photorealistic, 8K, professional studio lighting, sharp focus, flawless skin texture, elegant composition, shoulders-up framing, rich color grading, award-winning photography, stunning beauty, captivating gaze, high fashion aesthetic, perfect lighting, masterpiece, trending on ArtStation.`;
  const bg = `Clean blurred background with thematic accent lighting, subtle bokeh, professional backdrop, atmospheric depth.`;
  
  if (char.isExplicit) {
    return `${base} Mature sophisticated adult beauty, confident sensual presence, tasteful allure, seductive expression, magnetic charisma. ${bg} ${style} --no text, watermark, logo, signature, bad anatomy, distorted features.`;
  }
  
  return `${base} Expressive charismatic character, emotional depth, compelling presence, magnetic personality. ${bg} ${style} --no text, watermark, logo, signature, bad anatomy, distorted features.`;
}

/**
 * Build a cinematic background/cover scene prompt for each character
 */
function buildBackgroundPrompt(char) {
  const scenePrompts = {
    "Elena Voss": "Luxurious dimly lit wine cellar with mahogany shelves, candlelight reflecting on crystal glasses, deep burgundy shadows, sensual atmospheric lighting, gothic mansion interior, vintage decor, moody elegant ambiance",
    "Marcus Reed": "Modern luxury bedroom with floor-to-ceiling windows, dark wood furniture, moody twilight lighting through sheer curtains, masculine sophisticated interior, city skyline at dusk, warm amber tones",
    "Sophia Laurent": "Soft dreamy bedroom with twinkling fairy lights, plush white bedding, warm golden hour sunlight streaming through lace curtains, cozy intimate atmosphere, pastel tones, romantic ethereal mood",
    "Damien Black": "Dark underground club with neon purple and blue lighting, leather furniture, smoke haze, industrial concrete walls, mysterious shadows, dangerous atmosphere, crimson accents, urban gothic",
    "Lila Rose": "Pink and lavender kawaii bedroom filled with plushies, fairy lights, anime posters, soft carpet, pastel everything, cute but dark undertones, moonlight streaming through window, dreamy twilight",
    "Scarlett Vale": "Cozy basement apartment with warm string lights, vintage furniture, stacks of books, small fireplace, rainy window view, intimate cramped space, golden lamplight, bohemian decor",
    "Victor Kane": "Sterile modern apartment hallway with numbered doors, cold fluorescent lighting, beige walls, security cameras, institutional atmosphere, lonely urban setting, ominous clean aesthetic",
    "Nadia Voss": "Professional therapy office with leather couch, bookshelves, dim lighting, rain-streaked window, warm amber desk lamp, calm yet sinister atmosphere, psychological thriller aesthetic",
    "Lilith Crowe": "Dark gothic cathedral interior with stained glass windows casting crimson light, ancient stone pillars, flickering candles, occult symbols carved in stone, supernatural crimson glow, haunting ethereal atmosphere",
    "Rhea Blackwood": "Grand wealthy mansion kitchen, marble countertops, silver utensils gleaming, morning light through bay windows, elegant but cold, servant quarters visible, contrast between luxury and servitude",
    "Isabella Voss": "Bedroom with two identical beds, mirror wall reflecting twin imagery, split lighting - one side warm pink, other side cool blue, psychological duality, symmetrical composition, unsettling beautiful atmosphere",
    "Cassandra Noir": "Gothic ritual chamber with pentagram on floor, black candles, velvet drapes, full moon visible through arched window, occult altar, smoke and incense, purple and black color scheme, supernatural",
    "Dr. Elena Hart": "Empty university lecture hall, wooden desks, green chalkboard with equations, afternoon light through tall windows, dust particles floating, academic atmosphere, institutional green and brown tones",
    "Julian Cross": "Elegant dining room during family gathering, warm chandelier light, long wooden table, wine glasses, family photos, expensive decor, comfortable but oppressive atmosphere, twilight through windows",
    "Serena Vale": "Suburban living room at sunset, comfortable sofas, family photos, warm golden light, half-empty wine glass on coffee table, lonely housewife aesthetic, cozy yet melancholic atmosphere",
    "Victoria Black": "Modern BDSM dungeon with red lighting, professional equipment, black leather, chains, elegant restraint, sophisticated kink space, shadow play, dramatic spotlighting, high-end dominatrix studio",
    "Aria Sinclair": "Large family home staircase during party, voices and music from downstairs, moonlight through window on landing, party lights reflecting, secret meeting spot, romantic tension, warm amber glow",
    "Professor Lena Voss": "Cluttered university office with overflowing bookshelves, mahogany desk, green banker's lamp, papers everywhere, afternoon light through venetian blinds, academic cozy, intellectual atmosphere",
    "Morgana Crowe": "Hidden attic occult library with ancient spellbooks, glowing potions, crystal balls, magical circles, moonlight through circular window, mysterious blue-purple lighting, arcane symbols floating",
    "Diana Vale": "Modern bedroom with gaming setup visible through crack in door, pink ambient lighting, makeup table, trendy clothes scattered, posters on walls, youthful energetic vibe, secret rendezvous atmosphere",
    "Raven Sinclair": "Gothic bedroom with black velvet canopy bed, purple string lights, band posters, vinyl records, incense burning, occult decor, nighttime city lights through window, dark romantic atmosphere",
    "Dr. Amelia Cross": "Sterile medical examination room with modern equipment, bright fluorescent lights, medical charts, white walls, clinical atmosphere, unsettling cleanliness, cold professional aesthetic",
    "Kira Vale": "Retro styled living room with 90s decor, neon signs, bean bags, game console setup, nostalgic atmosphere, warm amber lighting, comfortable messy vibe, time capsule aesthetic",
    "Selene Blackthorn": "Ancient gothic castle chamber with stone walls, crimson drapes, ornate coffin, candelabras, full moon through tall arched window, mist on floor, eternal dark elegant atmosphere",
    "Luna Voss": "Soft pastel bedroom with altar dedicated to brother, fairy lights in shape of hearts, handwritten notes on walls, dreamy pink and lavender lighting, obsessive shrine atmosphere, moonlight",
    "Ophelia Noir": "High society gala ballroom with crystal chandeliers, champagne towers, art deco details, elegant guests in formal wear, golden lighting, marble floors, luxury and sophistication",
    "Freya Storm": "Dense forest clearing at twilight, campfire glowing, tent in background, starry sky through canopy, wild nature, misty atmosphere, adventure awaits, moonlight filtering through leaves",
    "Mistress Vesper": "Professional dominatrix studio with red and black theme, dungeon equipment, cages, whips displayed on walls, dramatic theatrical lighting, shadows and spotlights, high-end kink aesthetic",
    "Evelyn Rose": "Peaceful garden at golden hour, rose bushes in bloom, white picket fence, cozy porch with swing, teacup on table, warm nostalgic suburban atmosphere, neighborly warmth with hidden depth",
    "Nyra Shadow": "Interdimensional void with swirling shadows, purple and black energy vortex, floating rocks, demonic runes glowing, reality tearing apart, cosmic horror meets dark beauty, otherworldly atmosphere"
  };

  const scene = scenePrompts[char.name] || `${char.tagline} atmospheric cinematic scene, moody lighting, rich colors, professional photography, 8K`;
  
  return `${scene}, cinematic lighting, ultra detailed, 8K, dramatic atmosphere, rich color palette, professional photography, masterpiece, breathtaking, wide angle establishing shot --no text, watermark, logo, people, characters, signatures`;
}

async function downloadImage(url, filepath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(filepath, buffer);
  console.log(`  ✓ Saved: ${filepath.split("/").pop()}`);
}

async function generateAvatar(char, index) {
  const prompt = buildPortraitPrompt(char);
  const encodedPrompt = encodeURIComponent(prompt);
  
  // Profile photo - square 1024x1024
  const profileParams = new URLSearchParams({
    width: "1024",
    height: "1024",
    model: "flux",
    nologo: "true",
    safe: char.isExplicit ? "false" : "true",
    seed: String(1000 + index),
    steps: "30",
  });
  
  const profileUrl = `${POLLINATIONS_URL}/${encodedPrompt}?${profileParams.toString()}`;
  const profilePath = resolve(OUTPUT_DIR, `${char.name.toLowerCase().replace(/\s+/g, "-")}.png`);
  
  await downloadImage(profileUrl, profilePath);
  return profilePath;
}

async function generateBackground(char, index) {
  const prompt = buildBackgroundPrompt(char);
  const encodedPrompt = encodeURIComponent(prompt);
  
  // Background/cover - widescreen 1920x1080
  const bgParams = new URLSearchParams({
    width: "1920",
    height: "1080",
    model: "flux",
    nologo: "true",
    safe: "true",
    seed: String(2000 + index),
    steps: "30",
  });
  
  const bgUrl = `${POLLINATIONS_URL}/${encodedPrompt}?${bgParams.toString()}`;
  const bgPath = resolve(OUTPUT_DIR, "backgrounds", `${char.name.toLowerCase().replace(/\s+/g, "-")}-bg.png`);
  
  await downloadImage(bgUrl, bgPath);
  return bgPath;
}

async function main() {
  console.log(`\n🎨 Generating avatars and backgrounds for ${characters.length} characters...\n`);

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i];
    console.log(`[${i + 1}/${characters.length}] ${char.name}...`);
    
    try {
      await generateAvatar(char, i);
      console.log(`  📸 Profile photo generated`);
    } catch (err) {
      console.error(`  ❌ Avatar failed: ${err.message}`);
    }

    try {
      await generateBackground(char, i);
      console.log(`  🖼️  Background generated`);
    } catch (err) {
      console.error(`  ❌ Background failed: ${err.message}`);
    }

    // Small delay between requests to be polite to the API
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n✅ All generations complete!`);
  console.log(`📁 Profiles: ${OUTPUT_DIR}`);
  console.log(`📁 Backgrounds: ${OUTPUT_DIR}/backgrounds/\n`);
}

main().catch(console.error);