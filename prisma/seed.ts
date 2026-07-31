import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { characters as sfwCharacters } from "../sfw-premium-characters-with-assets";
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
  avatarUrl?: string;
  backgroundUrl?: string;
}

async function main() {
  const raw = fs.readFileSync(CHARACTERS_JSON_PATH, "utf-8");
  const jsonCharacters: SeedCharacter[] = JSON.parse(raw);

  const sfwSeedCharacters: SeedCharacter[] = sfwCharacters.map((c) => ({
    name: c.name,
    tagline: c.tagline,
    avatarEmoji: c.avatarEmoji,
    accentColor: c.accentColor,
    personality: c.personality,
    backstory: c.backstory,
    greeting: c.greeting,
    isExplicit: c.isExplicit,
    avatarUrl: c.avatarUrl,
    backgroundUrl: c.backgroundUrl,
  }));

  const allCharacters: SeedCharacter[] = [...jsonCharacters, ...sfwSeedCharacters];

  console.log(
    `Loaded ${allCharacters.length} characters total (${jsonCharacters.length} explicit + ${sfwSeedCharacters.length} premium)`
  );

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

  const existingCount = await prisma.character.count({
    where: { ownerId: seedUser.id },
  });
  console.log(`Existing characters for seed user: ${existingCount}`);

  if (existingCount >= allCharacters.length) {
    console.log("Characters already seeded. Making sure they're all public...");
    await prisma.character.updateMany({
      where: { ownerId: seedUser.id },
      data: { isPublic: true },
    });
    console.log("Done.");
    return;
  }

  await prisma.character.deleteMany({
    where: { ownerId: seedUser.id },
  });

  for (const char of allCharacters) {
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
        avatarUrl: char.avatarUrl ?? null,
        backgroundUrl: char.backgroundUrl ?? null,
        isPublic: true,
      },
    });
  }

  console.log(`Seeded ${allCharacters.length} characters successfully!`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
