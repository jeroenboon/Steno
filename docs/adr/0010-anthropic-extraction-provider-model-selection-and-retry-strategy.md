# ADR 0010 — Anthropic ExtractionProvider: model selection and structured-output retry strategy

**Status:** Accepted
**Date:** 2026-06-14
**Item:** 0010

## Context

Item 0010 delivers the first real cloud ExtractionProvider adapter. It sits behind the `ExtractionProvider` port (ADR 0007) and is the only component that makes calls to the Anthropic API. Three design questions needed answers before writing code:

1. **Which model per turn type?** Rolling turns fire every 15-30 seconds during a live meeting; they need low latency and low cost. The final pass runs once at meeting end; quality matters more than speed there.
2. **How to get structured JSON out of the model reliably?** Free-text parsing is fragile. We need a shape that matches `ExtractionResponseSchema` without post-processing heroics.
3. **What happens when the model output doesn't match the schema?** The scheduler must keep running even if one turn fails. Throwing on every bad response would be too disruptive.

Privacy principle #12 is non-negotiable: transcript text, prompts, API responses, and the API key must never appear in any log.

## Decision

### Model selection

| Turn type    | Default model       | Rationale                                                           |
| ------------ | ------------------- | ------------------------------------------------------------------- |
| Rolling turn | `claude-haiku-4-5`  | 200K context, $1/$5 per MTok, low latency — fits a 15-30s cadence  |
| Final pass   | `claude-sonnet-4-6` | 1M context, $3/$15 per MTok, stronger reasoning for full transcript |

Both models are injectable via constructor params (`rollingModel`, `finalPassModel`), so they can be overridden without subclassing. No date suffixes — model strings are exact and stable.

### Structured output via forced tool use

The adapter defines a single Anthropic tool called `extract_meeting_notes` whose `input_schema` mirrors `ExtractionResponseSchema`. It passes `tool_choice: { type: "tool", name: "extract_meeting_notes" }` on every call, which forces the model to respond via the tool-input mechanism rather than free text. The tool-input block is always a valid JSON object — no string parsing needed.

The response content is then validated with `ExtractionResponseSchema.safeParse()`. Zod is the single source of truth for what shape is acceptable; the JSON schema in the tool definition is a structural hint for the model, not an authority.

We chose forced tool use over `output_config.format` (structured output) because:
- Tool use is available on all model versions including Haiku 4.5
- The `tool_choice: { type: "tool" }` constraint is simpler and more predictable than output format negotiation
- The tool-input block is always parseable JSON, regardless of stop reason

### One-retry-then-skip strategy

If `safeParse` fails:

1. Log `[AnthropicExtractionProvider] Validation failed, retrying turn` (no content)
2. Repeat the exact same API call
3. If validation fails again: log `[AnthropicExtractionProvider] Retry failed, skipping turn` and return `{ proposedDecisions: [], proposedActions: [] }`

Returning an empty response (rather than throwing) means the scheduler's cadence continues uninterrupted and `_sentUpTo` advances normally. The spans are not retried on the next tick, which is the right trade-off: a transient model glitch should not block the meeting indefinitely.

The scheduler already catches throws from the provider (for network/auth errors), so the adapter can still throw on those paths — only Zod validation failures are handled with the empty-response pattern.

### Logging safety (principle #12)

- The `system` prompt and `messages` array are built locally and never logged
- `toolBlock.input` (raw model output) is never logged
- `request.spans`, `request.agendaItems`, `request.participants` are never logged
- The API key is injected at construction and never referenced after that
- Only the two metadata strings above are written to `console.error`

## Consequences

- The adapter is deterministically testable: the Anthropic SDK's `messages.create` is mocked via `vi.mock`, no real network calls, no real key in CI
- Changing the default model for either turn type requires only a constructor argument — no code change
- One extra API call per bad turn is acceptable: validation failures should be rare if the tool definition is correct, and the retry window is short (same parameters, second attempt)
- If the Anthropic API itself fails (network error, auth error, rate limit), the adapter throws and the scheduler swallows it per ADR 0007 — the span window is not advanced and will be retried on the next tick
- Secrets management (storing and injecting the API key) is a separate concern, deferred to item 0012
