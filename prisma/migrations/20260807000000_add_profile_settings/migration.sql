-- Adds the "Me" / profile-settings fields that PUT /api/auth/me and
-- GET /api/auth/me have relied on since the account-settings screen shipped
-- (see routes/auth.ts), but which never got a migration — schema.prisma had
-- these columns, prisma/seed.ts and the app's User selects reference them,
-- but no `ALTER TABLE` for them ever existed in prisma/migrations, so any
-- fresh `prisma migrate deploy` created a database missing these columns
-- entirely (P2022: column does not exist).
-- AlterTable
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "highlights" TEXT;
ALTER TABLE "User" ADD COLUMN "explicitMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "blurExplicitImages" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "defaultModel" TEXT DEFAULT 'default';
ALTER TABLE "User" ADD COLUMN "preferredLanguage" TEXT DEFAULT 'en';

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
