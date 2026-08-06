-- Backs the persisted relationship-level "explicit" bonus (see
-- computeRelationshipLevel in lib/relationship.ts) with real per-character
-- history instead of the old client-only, current-toggle-state heuristic.
ALTER TABLE "Character" ADD COLUMN "explicitEverUsed" BOOLEAN NOT NULL DEFAULT false;
