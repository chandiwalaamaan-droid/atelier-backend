-- Exact creator-specified visual/appearance description, used verbatim as
-- the primary image-gen prompt for avatar + background, and as the identity
-- anchor for in-chat scene images so the character stays visually consistent.
ALTER TABLE "Character" ADD COLUMN "avatarPrompt" TEXT NOT NULL DEFAULT '';

-- Creator-specified art style / setting DNA reused across every in-chat
-- scene image for this character so scenes stay visually consistent with
-- each other, independent of the exact moment being depicted.
ALTER TABLE "Character" ADD COLUMN "scenePromptTemplate" TEXT NOT NULL DEFAULT '';
