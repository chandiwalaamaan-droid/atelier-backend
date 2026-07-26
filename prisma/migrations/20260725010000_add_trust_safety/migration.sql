-- Trust & safety: age gate + ToS acceptance, email verification, password
-- reset, and Discover moderation (reports + auto-hide).

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

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

ALTER TABLE "PasswordResetToken"
    ADD CONSTRAINT "PasswordResetToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── EmailVerificationToken ───────────────────────────────────────────────
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

ALTER TABLE "EmailVerificationToken"
    ADD CONSTRAINT "EmailVerificationToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

CREATE INDEX "Report_characterId_idx" ON "Report"("characterId");
CREATE INDEX "Report_status_idx" ON "Report"("status");

ALTER TABLE "Report"
    ADD CONSTRAINT "Report_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Report"
    ADD CONSTRAINT "Report_reporterId_fkey"
    FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
