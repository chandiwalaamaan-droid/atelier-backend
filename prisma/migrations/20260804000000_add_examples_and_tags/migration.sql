-- Example dialogues (Character.AI-style training data) — JSON array of
-- {user, character} message pairs that teach the model the character's voice,
-- mannerisms, and conversational patterns.
ALTER TABLE "Character" ADD COLUMN "examples" TEXT NOT NULL DEFAULT '[]';

-- Searchable tags for discoverability and filtering.
ALTER TABLE "Character" ADD COLUMN "tags" TEXT NOT NULL DEFAULT '[]';
