-- Add backgroundUrl column to Character model for chat interface wallpapers
ALTER TABLE "Character" ADD COLUMN "backgroundUrl" STRING(255);