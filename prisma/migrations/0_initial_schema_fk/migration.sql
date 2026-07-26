-- Split out from 0_initial_schema: these FK constraints need Character/User/
-- Message to already be unlocked (schema_locked = false), and that unlock
-- only takes effect once its own migration transaction has committed. See
-- the comment in 0_initial_schema/migration.sql for the full explanation.

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
