-- Trust & safety: age gate + ToS acceptance, email verification, password
-- reset, and Discover moderation (reports + auto-hide).
--
-- FK constraints for the three new tables below live in the follow-up
-- 20260725010000_add_trust_safety_fk migration instead of inline here:
-- CockroachDB creates new tables with schema_locked = true by default, and
-- since Prisma runs this whole file as one transaction, an unlock here
-- wouldn't be visible to an ADD CONSTRAINT later in the same transaction.
-- Splitting into two migrations means the unlock is fully committed before
-- the FK migration runs.

-- ── User: age gate / ToS / email verification ──────────────────────────
-- Added as nullable first so this doesn't break on existing rows, backfilled
-- with a conservative placeholder, then locked to NOT NULL. Any account
-- created before this migration already passed through signup once; if you
-- want to force existing users to re-confirm their age/ToS, do that as a
-- product decision (e.g. a one-time interstitial) rather than here.
ALTER TABLE "User" ADD COLUMN "birthdate" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "tosAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User" SET "birthdate" = TIMESTAMP '2000-01-01' WHERE "birthdate" IS NULL;
UPDATE "User" SET "tosAcceptedAt" = "createdAt" WHERE "tosAcceptedAt" IS NULL;

ALTER TABLE "User" ALTER COLUMN "birthdate" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "tosAcceptedAt" SET NOT NULL;

-- ── Character: Discover moderation ──────────────────────────────────────
ALTER TABLE "Character" ADD COLUMN "flagCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "isHidden" BOOLEAN NOT NULL DEFAULT false;

-- ── PasswordResetToken ───────────────────────────────────────────────────
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- Unlock before creating indexes on it — CockroachDB locks new tables by
-- default and blocks any schema change, including CREATE INDEX, until
-- unlocked.
ALTER TABLE "PasswordResetToken" SET (schema_locked = false);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- ── EmailVerificationToken ───────────────────────────────────────────────
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EmailVerificationToken" SET (schema_locked = false);

CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- ── Report ────────────────────────────────────────────────────────────
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Report" SET (schema_locked = false);

CREATE INDEX "Report_characterId_idx" ON "Report"("characterId");
CREATE INDEX "Report_status_idx" ON "Report"("status");

