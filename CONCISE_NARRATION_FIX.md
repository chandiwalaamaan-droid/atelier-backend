# Concise replies and unspoken narration

## Deploy

Redeploy this backend using the existing build/start commands and environment. Keep the frontend from the previous engine-replies update. No database migration, new dependency, or new API key is needed. New turns and regenerations use this fix; saved replies are not rewritten. Regenerate the last incorrect response after deploying if needed.

## Behavior

The earlier Hazelnut guidance of 120–320 words encouraged excessive length. All engines now favor one compact paragraph and typically 1–3 sentences for ordinary conversation, with no minimum length. Premium quality is expressed through character voice, relevant subtext, and continuity. Earlier lengthy replies are explicitly not a length template. Explicit requests for scene development receive more room and do not receive the ordinary sentence guidance.

| Engine | Ordinary word guidance | Ordinary reply token ceiling | Explicit detailed request ceiling |
| --- | ---: | ---: | ---: |
| Vanilla | Under 35 | 256 | 768 |
| Strawberry | Under 60 | 512 | 1280 |
| Chocolate | Under 100 | 640 | 1792 |
| Hazelnut | Under 120 | 768 | 2048 |

Word guidance applies to the entire reply, including dialogue and narration. It is a soft limit with no minimum length; simple exchanges can remain short. Chocolate and Hazelnut guidance was increased to 100 and 120 words respectively at the user’s request.

Short greetings and explicit brief requests use at most 256 tokens. These are output ceilings, not target lengths or guaranteed billed totals. Only an explicit provider token-limit finish triggers bounded completion recovery, up to two calls with 320 tokens each for ordinary/brief turns or 768 each for detailed turns. Recovery finishes the same thought; it does not start another scene. Normal stops and user Stop do not trigger recovery. Incomplete recovery remains visible through the existing frontend notice; no sentence-count cleanup discards generated text. Provider-specific reasoning configuration and fallback ordering are unchanged.

Before generation, user text is separated into spoken and narration segments. Original database/UI messages stay unchanged. Single and double asterisks mark narration; an unfinished narration span stays unspoken. Escaped literal stars and numeric multiplication are preserved. The structured labels are data, not additional instructions or new chat turns.

For `hey stupid *she is looking gorgeous*`, only `hey stupid` is spoken. The character must not acknowledge the unspoken compliment. Visible gestures such as `*I hand her a flower*` can be noticed. Private thoughts such as `*I think "I missed you"*` cannot be heard. Quoted dialogue inside narration is audible only when explicitly described as spoken aloud. These perception distinctions are model instructions, not a keyword filter that can guarantee a particular generated answer.

The distinction applies across engines and fallback providers, recent history, regeneration, Continue, archived excerpts, and future memory summaries. Excerpts preserve their original spoken/narration kind even after surrounding asterisks are removed. Input estimates account for the structured user payload. Existing memory is not erased, but the model is told that unattributed old memory does not prove a character heard a private thought.

## Validation

TypeScript build and all 59 automated tests passed. Regression coverage includes the reported input, multiple/double/unclosed markers, Unicode, escaped literals, visible versus private narration instructions, no escalation from an unspoken request for detail, per-turn budgets, all-engine prompts, persistence, regeneration, Continue, archived recall, summary-provider payloads, and bounded cutoff recovery.

Provider responses are mocked in these tests. Live model behavior and production deployment have not been verified. No extra classifier or per-message summarization call was introduced. Existing Hazelnut context selection, memory safety, and token accounting remain active.

A reproducible synthetic comparison of compact Hazelnut versus full-context rollback, using the same local estimator and exactly one pacing block in both, reports 3,582 → 2,259 estimated input tokens for 12 messages, 4,998 → 2,259 for 24, and 6,414 → 2,259 for 36. These repetitive fixtures show context construction savings, not measured billing savings or a live quality evaluation.
