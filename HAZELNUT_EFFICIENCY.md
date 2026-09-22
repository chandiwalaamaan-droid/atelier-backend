> Current reply pacing and narration behavior: see [CONCISE_NARRATION_FIX.md](CONCISE_NARRATION_FIX.md). Its budgets supersede the older reply-length guidance below.

# Hazelnut: premium continuity with less repeated input

## Deployment

Redeploy this backend with your existing environment and normal build/start commands. Use the frontend from the previous engine-replies fix. This update requires no frontend changes, new dependencies, database migrations, or new API keys. It takes effect for new turns in existing chats.

The optimization is enabled by default. The selected model, provider fallback order, sampling settings, and automatic completion recovery remain configured as before. This is an application-level context/memory improvement, not a newly trained model or an untested model substitution.

## What changed

- A compact Hazelnut prompt expresses voice, subtext, continuity, user agency, and boundaries once. Character name, personality, backstory, creator notes, story settings, and existing memory are retained. Up to two voice examples replace the old eight-example maximum. Current-turn length guidance is included once.
- A local selector keeps a chronological suffix of complete user turns and assistant replies. At least the last two user turns and their replies are preserved verbatim, even when they exceed the soft budget. Continue preserves the existing assistant tail; regeneration excludes the reply being replaced.
- Older source excerpts are ranked by the current question and explicit preferences/boundaries/promises, deduplicated, attributed to their speaker, and included within the remaining budget. They are historical evidence, not fresh user turns. Recent corrections take precedence.
- When meaningful terms are available, the backend also searches older saved dialogue for up to 16 matching messages, scoped to the signed-in owner and character. Selection uses exact source text and lexical matching, without a model call or an embedding service. Ordinary greetings do not trigger that lookup. An optional lookup failure cannot block the main reply.
- Periodic Hazelnut summaries use five headings: Facts, Boundaries, Scene, Relationship, Open threads. They aim for 220 words, with headroom to preserve important details, and a 640-token output ceiling. The most recent 10 messages stay outside the summary; updates normally trigger at 26 unsummarized messages. That is about one update per eight new user/assistant exchanges in steady state, rather than a memory call for every reply.
- Summary work is deduplicated per character within a server process. A backlog is folded in contiguous chunks of at most 24 messages and roughly 6,000 estimated input tokens; a single oversized source message may exceed the soft limit. Trailing user questions are kept with recent context where possible. Only actually processed messages advance the summary cursor.
- Failed, empty, or provider-reported incomplete summaries cannot advance the cursor. The previous summary and source messages remain available for a later attempt.
- One request-local usage record includes reported input, output, and cached tokens across main generation, fallbacks, and automatic continuations. Separate memory records make summary overhead visible. Missing provider usage is flagged explicitly.

## Runtime controls

| Variable | Default | Purpose |
| --- | --- | --- |
| `HAZELNUT_COMPACT_CONTEXT` | enabled | Set `false` to restore the previous Hazelnut prompt and 20/36 history settings. Memory-failure fixes and accounting remain active. |
| `HAZELNUT_INPUT_TARGET_TOKENS` | `2800` | Soft total input estimate; accepted values are 1600–8000. Persona, story boundaries, memory, and the protected recent turns can exceed it. |

The input estimate is a conservative character-based heuristic with extra allowance for non-ASCII text, not the deployed model's tokenizer. Actual API usage is the billing authority. No response is cut to meet this input target, and the previous completion-recovery behavior is retained.

## Observability

`[hazelnut-context]` reports source message count, selected recent messages, excerpt count, estimated input size, target, and protected overflow. It does not log conversation contents.

`[turn-usage]` reports `engine`, `kind` (`reply` or `memory`), attempted API calls, calls reporting usage, prompt/completion/cached tokens, and available completion reason/continuation count. `usageComplete: false` means some usage is unknown; zero reported tokens must not be read as zero cost. `succeeded` means the operation returned without an exception, not that an interrupted reply is complete. Inspect `finishReason` too.

Existing provider/model usage logs remain available. For operational cost per delivered reply, aggregate reply usage plus amortized memory usage, broken down by actual provider/model prices. Continuations resend context and are included in reply totals. API requests that fail before reporting usage can still have unknown cost.

## Validation from the preceding release

These results describe the previous archive. The latest 59-test validation and revised synthetic estimates are in CONCISE_NARRATION_FIX.md.

Backend TypeScript build and all 48 automated tests passed. Tests cover:

- Long-chat input selection, preserved recent text, exact old facts, boundaries, promises, chronology, Unicode, and oversized current turns.
- Owner/conversation isolation for older-history retrieval and graceful handling of lookup failures.
- Engine switches, Continue, regeneration, idempotent retries, and existing completion recovery.
- Failed summaries preserving the cursor, single in-process background update, and bounded backlog folds.
- Actual hosted/Ollama adapter plumbing with mocked responses, including truncated summaries and aggregate continuation usage.
- Usage isolation across concurrent requests and the rollback setting.

Three synthetic histories were compared against the previous prompt/history construction with the SAME local estimator:

| History messages | Previous estimated input | Updated estimated input | Reduction |
| --- | ---: | ---: | ---: |
| 12 | 3,393 | 2,221 | 35% |
| 24 | 4,809 | 2,367 | 51% |
| 36 | 6,225 | 2,367 | 62% |

These fixtures demonstrate smaller constructed prompts, not measured API billing reductions or live-model quality. They contain repeated scene descriptions to exercise the original failure pattern. Savings vary with persona size, language, conversation content, summaries, and recovery calls. The benchmark is reproducible in `tests/hazelnutContext.test.cjs`.

No production model calls or deployment were performed. Lexical recall can miss paraphrases or older details omitted from a summary; the prompt explicitly asks for uncertainty instead of fabricated recall. Retaining less verbatim history is a quality/cost tradeoff, so evaluate memory accuracy, voice consistency, repetition, and completion rate on representative live conversations. Raise the input target or use the rollback control if the default is too compact for a particular workload. The summary concurrency guard is process-local; multiple backend instances still rely on the existing conditional database write to reject stale summary commits.
