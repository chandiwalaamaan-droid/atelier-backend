import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { characters as sfwCharacters } from "../sfw-premium-characters-with-assets";
import { darkTabooCharacters } from "../dark-taboo-characters-with-assets";

const prisma = new PrismaClient();

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
  // dark-taboo-characters.json (the old plain-JSON source) has no avatarUrl/
  // backgroundUrl fields at all, which is why every explicit character was
  // being seeded with null avatar/background - the generated
  // dark-taboo-characters-with-assets.ts file next to it already has the
  // correct asset paths (and matching files under public/assets/characters/
  // on the frontend), it just was never wired in here. Use that instead.
  const jsonCharacters: SeedCharacter[] = darkTabooCharacters.map((c) => ({
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

  const sfwSeedCharacters: SeedCharacter[] = sfwCharacters.map((c) => ({
    name: c.name,
    tagline: c.tagline,
    avatarEmoji: c.avatarEmoji,
    accentColor: c.accentColor,
    personality: c.personality,
    backstory: c.backstory,
    greeting: c.greeting,
    // sfw-premium-characters-with-assets.ts has a generation bug where every
    // entry's isExplicit got set to true, even though these are all meant to
    // be SFW (see sfw-premium-characters.ts, the source file, which has them
    // all correctly as false). This array is definitionally the SFW set, so
    // force it here rather than trust the generated file's flag.
    isExplicit: false,
    avatarUrl: c.avatarUrl,
    backgroundUrl: c.backgroundUrl,
  }));

  const allCharacters: SeedCharacter[] = [...jsonCharacters, ...sfwSeedCharacters];

  console.log(
    `Loaded ${allCharacters.length} characters total (${jsonCharacters.length} explicit + ${sfwSeedCharacters.length} premium)`
  );

  let seedUser = await prisma.user.findUnique({
    where: { email: "seed@rolichat.local" },
  });

  if (!seedUser) {
    seedUser = await prisma.user.create({
      data: {
        email: "seed@rolichat.local",
        passwordHash: await bcrypt.hash("seed-password-123", 10),
        displayName: "Rolichat Seed",
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

  // Upsert each seed character by (ownerId, name) instead of skipping once the
  // count matches. The old count-based guard meant that once a bad seed run
  // landed (e.g. a data bug flipping isExplicit), re-running the seed script
  // would never fix it - it only ever flipped isPublic and returned early.
  // This version always corrects every field on every run, and only creates
  // rows that don't already exist.
  let created = 0;
  let updated = 0;

  for (const char of allCharacters) {
    const existing = await prisma.character.findFirst({
      where: { ownerId: seedUser.id, name: char.name },
      select: { id: true },
    });

    const data = {
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
    };

    if (existing) {
      await prisma.character.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.character.create({ data: { ownerId: seedUser.id, name: char.name, ...data } });
      created++;
    }
  }

  // Clean up seed-owned characters no longer present in the source data
  // (e.g. renamed or removed from the JSON/TS files).
  const currentNames = allCharacters.map((c) => c.name);
  const removed = await prisma.character.deleteMany({
    where: { ownerId: seedUser.id, name: { notIn: currentNames } },
  });

  console.log(
    `Seed complete: ${created} created, ${updated} updated, ${removed.count} removed. ${allCharacters.length} total.`
  );
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
