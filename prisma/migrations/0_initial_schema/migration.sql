-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "avatarEmoji" TEXT NOT NULL DEFAULT '🌸',
    "avatarUrl" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#c9a227',
    "personality" TEXT NOT NULL,
    "backstory" TEXT NOT NULL,
    "greeting" TEXT NOT NULL,
    "memorySummary" TEXT NOT NULL DEFAULT '',
    "summarizedThrough" INTEGER NOT NULL DEFAULT 0,
    "isExplicit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CockroachDB (v26.2+) creates new tables with schema_locked = true by
-- default (a changefeed-performance optimization). This blocks ANY later
-- schema change on the table within this same migration — including the
-- CREATE INDEX statements below — so the unlock must happen here, right
-- after CREATE TABLE and before any index/constraint touches these
-- tables. (ADD CONSTRAINT statements still live in the follow-up
-- 0_initial_schema_fk migration, which runs as its own separate
-- transaction after this one has fully committed.) Left unlocked
-- permanently rather than re-locked, since later migrations keep adding
-- columns/constraints to these same tables.
ALTER TABLE "Character" SET (schema_locked = false);
ALTER TABLE "User" SET (schema_locked = false);
ALTER TABLE "Message" SET (schema_locked = false);

-- CreateIndex
CREATE INDEX "Character_ownerId_idx" ON "Character"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Message_characterId_userId_createdAt_idx" ON "Message"("characterId", "userId", "createdAt");
