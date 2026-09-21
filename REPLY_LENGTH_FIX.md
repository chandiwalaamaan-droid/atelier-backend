> Latest Hazelnut optimization and deployment notes: see [HAZELNUT_EFFICIENCY.md](HAZELNUT_EFFICIENCY.md).

# Engine-aware, complete replies

## Deploy

Replace the backend source with this backend project, then redeploy it using your existing build/start commands. Deploy the accompanying frontend project too so completion notices and final-text reconciliation are enabled. Keep your existing environment variables and database. No new packages, database migration, or API keys are required. These archives contain source projects, not a static Netlify Drop build.

The changes affect new replies and regenerations in existing chats. Already-truncated saved replies cannot be reconstructed automatically; use Regenerate when appropriate.

## What was wrong

- Normal output budgets were only 96 / 192 / 256 / 320 tokens for the four named engines.
- Prompt reminders imposed fixed sentence counts.
- Live sentence and action-count checks aborted generation. Cleanup also cut everything after excess action beats and discarded some unpunctuated endings.
- Provider finish reasons were read but not passed back to chat handling, so a normal stop and a token-limit cutoff were treated alike.
- Hazelnut uses the existing Groq-first provider order; the other engines use NVIDIA first. This is a plausible contributor to the observed difference, not a live-provider diagnosis.

## New behavior

| Engine | Intended pacing | Ordinary substantive turn guidance | Normal token ceiling |
| --- | --- | --- | --- |
| Vanilla | Quick, direct dialogue | Roughly 15–60 words | 512 |
| Strawberry | Attentive conversation | Roughly 40–130 words | 896 |
| Chocolate | Developed scenes | Roughly 90–220 words | 1536 |
| Hazelnut | Immersive, nuanced scenes | Roughly 120–320 words | 2048 |

Word ranges are soft guidance, never enforced quotas. A greeting may still be one line on any engine. Explicit detail requests receive 1.5 times the normal token ceiling; explicit brevity requests receive at most 512 tokens. The manual/default mode has its own balanced profile. Content length alone does not classify a request as complex.

Fresh pacing guidance is applied to every turn, including regeneration and engine switches. Existing history remains intact, with explicit instructions to use it for continuity rather than copying its length. No sentence or action-count truncation remains in the chat path. Natural stop responses preserve quoted endings, action-only replies, Unicode, and punctuation-free dialogue.

If a provider explicitly reports a token-limit stop, the backend attempts at most two continuations on that same provider/model, preserving sampling settings. Each continuation gets 512–1024 tokens, plus the existing model-specific reasoning allowance where applicable. It repeats an exact tail anchor so the backend can join even a split word without duplication. Unanchored/failed recovery is not guessed or substituted. User Stop cancels recovery. Normal stops, unknown endings, and content filtering do not trigger automatic continuation.

The frontend receives the authoritative saved text. If recovery fails, exhausts its limit, or termination is unknown, it shows an incomplete-reply notice with Continue/Regenerate guidance. Provider/model names remain server-side.

## Validation and limits

Backend: TypeScript build and 25 automated tests passed. Frontend: 4 automated tests, TypeScript checking, and the full Next.js production build passed (21 static pages generated). Coverage includes engine switching in an existing chat, complete saved/streamed text, mid-word recovery, quoted and punctuation-free endings, bounded retries, Stop behavior, recovery failure, SSE/NDJSON final lines without a newline, and real adapter/fallback plumbing against mocked provider responses.

No live model calls were made with production credentials. These checks establish application behavior, not a guarantee of how a model will phrase or finish every answer. Provider outages, model noncompliance, filtering, and user cancellation can still leave a reply incomplete; the app now reports that instead of silently deleting its tail. Longer ceilings and occasional recovery requests can increase token consumption and latency. Provider order, model IDs, membership controls, and database schema were not changed.
