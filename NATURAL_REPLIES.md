> Latest reply-length behavior and deployment notes: see REPLY_LENGTH_FIX.md. Earlier sentence/action caps described below are superseded.

# Natural character dialogue update

## Deploy

This is the complete backend source, based on Story Edition. Replace the source in your backend repository, preserve your Render environment variables, and deploy with the existing `npm ci`, `npm run build`, and `npm start` workflow. Keep the mobile-fixed frontend already supplied. This patch requires no database migration, reset, or character reseeding.

## What changed

- Every engine can give a brief response to a brief everyday turn. Removed minimum sentence targets while retaining existing maximum output budgets.
- Replaced overlapping reaction/body-response scripts with one conversational policy: character-specific voice, context-aware replies, optional narration, varied openings, and questions only when they serve the exchange.
- Instructed the model to preserve established facts and emotional continuity without inventing shared memories or deciding the user's actions.
- Higher tiers allow nuance without requiring drama or intimacy in ordinary conversation.
- Real-world inactivity no longer instructs the character to assume fictional time passed or that it waited for the user.
- Character reminders stay in system context. They are no longer appended to user speech or introduced as a fabricated user turn, including continuation and regeneration.
- Provider statistics timers no longer keep test processes alive after the work has finished.

## Verification and limits

`npm test` passed: TypeScript build plus 11 tests covering chat retry/storage behavior, concurrency, ownership, persona reminder placement, short-reply guidance across all engines, and elapsed-time handling. Provider calls in route tests are mocked. No live provider generations were evaluated in this environment; these tests verify prompt assembly and request behavior, not a measured improvement in perceived realism. Output quality still depends on the selected model, persona, and existing conversation.

## Quick dialogue review after deployment

Try these in new or existing chats across your available engines. Judge relevance, character consistency, pacing, and repeated wording over several turns; do not require a fixed scripted answer.

| Situation | What to check |
| --- | --- |
| Say “Hey, you busy?” to a reserved bookshop owner | A brief answer in that persona's voice; no mandatory setting paragraph |
| Ask “Did I leave my blue umbrella here?” after establishing it earlier | Correct continuity without inventing unrelated shared history |
| Say “Actually, I meant tomorrow” | Acknowledge the correction rather than repeating the misunderstanding |
| Make a small joke, then reply “fair enough” | Natural shifts in reply length; no question forced onto every ending |
| Ask to stay in the same quiet scene | No sudden plot twist or escalating emotional intensity |
| Return after a long gap without advancing the scene | Resume the scene without guilt or invented waiting |
| Write a short Hindi-English message to a compatible persona | Appropriate language/register without a caricatured accent |
| Ask to stop an action or change direction | Respect the choice and leave the user's next action open |
| Use Continue or Regenerate | Character guidance remains active without invented user speech |
