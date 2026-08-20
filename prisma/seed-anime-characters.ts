import { PrismaClient } from "@prisma/client";
import { animeCharacters } from "../anime-characters-with-assets";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  let seedUser = await prisma.user.findUnique({ where: { email: "seed@rolichat.local" } });
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

  let created = 0;
  let updated = 0;

  for (const char of animeCharacters) {
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
      isExplicit: false,
      avatarUrl: char.avatarUrl || null,
      backgroundUrl: char.backgroundUrl || null,
      isPublic: true,
      avatarPrompt: char.avatarPrompt,
      scenePromptTemplate: char.scenePromptTemplate,
      tags: JSON.stringify(["Anime"]),
    };

    if (existing) {
      await prisma.character.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.character.create({ data: { ownerId: seedUser.id, name: char.name, ...data } });
      created++;
    }
  }

  console.log(`Anime seed complete: ${created} created, ${updated} updated. ${animeCharacters.length} total.`);
}

main()
  .catch((e) => {
    console.error("Anime seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
