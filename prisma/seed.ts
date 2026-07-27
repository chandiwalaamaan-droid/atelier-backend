import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

const CHARACTERS_JSON_PATH = path.resolve(__dirname, "../dark-taboo-characters.json");

interface SeedCharacter {
  name: string;
  tagline: string;
  avatarEmoji: string;
  accentColor: string;
  personality: string;
  backstory: string;
  greeting: string;
  isExplicit: boolean;
}

async function main() {
  // Load the characters JSON
  const raw = fs.readFileSync(CHARACTERS_JSON_PATH, "utf-8");
  const characters: SeedCharacter[] = JSON.parse(raw);

  console.log(`Loaded ${characters.length} characters from JSON`);

  // Find or create a seed admin user to own these characters
  // This user is for demo/seed purposes
  let seedUser = await prisma.user.findUnique({
    where: { email: "seed@atelier.local" },
  });

  if (!seedUser) {
    seedUser = await prisma.user.create({
      data: {
        email: "seed@atelier.local",
        passwordHash: await bcrypt.hash("seed-password-123", 10),
        displayName: "Atelier Seed",
        birthdate: new Date("1990-01-01"),
        tosAcceptedAt: new Date(),
        emailVerified: true,
      },
    });
    console.log(`Created seed user: ${seedUser.id}`);
  }

  // Count existing seed characters
  const existingCount = await prisma.character.count({
    where: { ownerId: seedUser.id },
  });
  console.log(`Existing characters for seed user: ${existingCount}`);

  if (existingCount >= characters.length) {
    console.log("Characters already seeded. Making sure they're all public...");
    await prisma.character.updateMany({
      where: { ownerId: seedUser.id },
      data: { isPublic: true },
    });
    console.log("Done.");
    return;
  }

  // Delete any existing seed characters and re-insert
  await prisma.character.deleteMany({
    where: { ownerId: seedUser.id },
  });

  // Insert all characters
  for (const char of characters) {
    await prisma.character.create({
      data: {
        ownerId: seedUser.id,
        name: char.name,
        tagline: char.tagline,
        avatarEmoji: char.avatarEmoji || "🌸",
        accentColor: char.accentColor || "#c9a227",
        personality: char.personality,
        backstory: char.backstory,
        greeting: char.greeting,
        isExplicit: char.isExplicit,
        isPublic: true, // shown on Discover; explicit ones only surface when the NSFW toggle is on
      },
    });
  }

  console.log(`Seeded ${characters.length} characters successfully!`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });