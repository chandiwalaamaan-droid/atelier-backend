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

-- CreateIndex
CREATE INDEX "Character_ownerId_idx" ON "Character"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Message_characterId_userId_createdAt_idx" ON "Message"("characterId", "userId", "createdAt");

-- CockroachDB (v26.2+) creates new tables with schema_locked = true by
-- default (a changefeed-performance optimization). Prisma runs this whole
-- file in one transaction, and CockroachDB doesn't apply schema changes
-- within a transaction atomically — so an unlock here would NOT be visible
-- to an ADD CONSTRAINT later in this same file. Unlocking is done here;
-- the ADD CONSTRAINT statements live in the follow-up
-- 0_initial_schema_fk migration instead, which runs as its own separate
-- transaction after this one has fully committed. Left unlocked
-- permanently rather than re-locked, since later migrations keep adding
-- columns/constraints to these same tables.
ALTER TABLE "Character" SET (schema_locked = false);
ALTER TABLE "User" SET (schema_locked = false);
ALTER TABLE "Message" SET (schema_locked = false);
