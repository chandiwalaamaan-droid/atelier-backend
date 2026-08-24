const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "anime-characters-with-assets.ts");
let content = fs.readFileSync(FILE, "utf8");

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const lines = content.split("\n");
let inCharacter = false;
let currentName = null;
const updates = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.match(/^\s*name:\s*"/)) {
    inCharacter = true;
    const m = line.match(/name:\s*"([^"]+)"/);
    currentName = m ? m[1] : null;
  }
  if (inCharacter && line.match(/^\s*backgroundUrl:\s*""/)) {
    const slug = slugify(currentName);
    const newUrl = `backgroundUrl: "/assets/characters/backgrounds/${slug}-bg.png"`;
    lines[i] = line.replace(/backgroundUrl:\s*""/, newUrl);
    updates.push(`${currentName} -> ${slug}-bg.png`);
    inCharacter = false;
    currentName = null;
  }
  if (line.match(/^\s*\},/)) {
    inCharacter = false;
    currentName = null;
  }
}

fs.writeFileSync(FILE, lines.join("\n"));
console.log(`Updated ${updates.length} background URLs:`);
updates.forEach((u) => console.log("  " + u));
