-- Performance indexes for the retention cleanup job and general user lookups.
-- These were added to the Prisma schema (schema.prisma) but had no corresponding
-- migration, so they're applied here explicitly for CockroachDB.

CREATE INDEX IF NOT EXISTS "User_lastActiveAt_idx" ON "User" ("lastActiveAt");

CREATE INDEX IF NOT EXISTS "User_deletedAt_idx" ON "User" ("deletedAt");
