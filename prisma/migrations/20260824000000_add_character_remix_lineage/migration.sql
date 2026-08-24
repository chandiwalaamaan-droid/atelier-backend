-- Adds remix lineage tracking so Discover can show real "N remixes" /
-- "Based on X by Y" attribution instead of the fabricated pseudoViews()
-- counter, and so trending can be scored off real remix activity.
ALTER TABLE "Character" ADD COLUMN "remixOfId" STRING;

ALTER TABLE "Character" ADD CONSTRAINT "Character_remixOfId_fkey"
  FOREIGN KEY ("remixOfId") REFERENCES "Character"("id") ON DELETE SET NULL;

CREATE INDEX "Character_remixOfId_idx" ON "Character"("remixOfId");
