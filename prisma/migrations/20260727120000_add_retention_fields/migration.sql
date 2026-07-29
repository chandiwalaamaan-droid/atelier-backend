-- AlterTable
-- Adds the inactivity/data-retention fields that schema.prisma already
-- declares (see src/jobs/retentionCleanup.ts) but which were never
-- captured in a migration, causing Prisma Client to query columns that
-- don't exist in the database (P2022).
ALTER TABLE "User" ADD COLUMN "lastActiveAt" TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE "User" ADD COLUMN "deletionWarningSentAt" TIMESTAMPTZ;
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMPTZ;
