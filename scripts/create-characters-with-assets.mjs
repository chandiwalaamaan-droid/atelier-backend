/**
 * Create an enriched characters JSON that includes avatarUrl and backgroundUrl
 * paths pointing to the generated images in public/assets/characters/
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const characters = JSON.parse(readFileSync(resolve(ROOT, "dark-taboo-characters.json"), "utf-8"));

const enriched = characters.map((char) => {
  const slug = char.name.toLowerCase().replace(/\s+/g, "-");
  return {
    ...char,
    avatarUrl: `/assets/characters/${slug}.png`,
    backgroundUrl: `/assets/characters/backgrounds/${slug}-bg.png`,
    avatarPrompt: "",
    scenePromptTemplate: "",
  };
});

const outputPath = resolve(ROOT, "dark-taboo-characters-enriched.json");
writeFileSync(outputPath, JSON.stringify(enriched, null, 2));
console.log(`✅ Enriched ${enriched.length} characters with image URLs → ${outputPath}`);

// Also output as a TS module for the frontend
const tsContent = `// Auto-generated from dark-taboo-characters.json
// Includes avatarUrl and backgroundUrl for generated images

export interface CharacterWithAssets {
  name: string;
  tagline: string;
  avatarEmoji: string;
  accentColor: string;
  personality: string;
  backstory: string;
  greeting: string;
  isExplicit: boolean;
  avatarUrl: string;
  backgroundUrl: string;
  avatarPrompt: string;
  scenePromptTemplate: string;
}

export const darkTabooCharacters: CharacterWithAssets[] = ${JSON.stringify(enriched, null, 2)};

export default darkTabooCharacters;
`;

const tsPath = resolve(ROOT, "dark-taboo-characters-with-assets.ts");
writeFileSync(tsPath, tsContent);
console.log(`✅ TypeScript module written → ${tsPath}`);