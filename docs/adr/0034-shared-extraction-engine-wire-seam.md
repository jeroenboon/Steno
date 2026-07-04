# ADR 0034 — Shared extraction engine behind an `ExtractionWire` seam

**Status:** accepted (2026-07-04)  
**Relates to:** ADR 0007 (ports & adapters), ADR 0010 (Anthropic extraction, forced tool use), ADR 0012/0027 (OpenAI-compatible extraction + protocol discrimination), ADR 0026/0029 (context inference), ADR 0032 (the same move for ASR: `RealtimeSpanStream`); 2026-07 architecture review item 3

## Problem statement

The OpenAI-compatible family (`OpenAICompatibleExtractionProvider`, `AzureOpenAIExtractionProvider`) already shared its extraction contract through `ChatExtractionEngine` (`openaiChatExtraction.ts`): prompt building, JSON parsing, per-item Zod coercion, the one-retry-then-degrade strategy, and `devlog`. Those adapters are ~30-line shims that supply only a URL + auth header.

`AnthropicExtractionProvider` carried a near-identical copy of the same contract, coupled to a different transport. What genuinely differs between the two families is small:

- **Transport.** Anthropic uses the SDK `messages.create` with forced tool use (`tool_choice`), returning `toolBlock.input` — an _already-parsed object_. OpenAI/Azure use raw `fetch` with `response_format: json_object`, returning a _string_ that needs tolerant parsing (fences/prose).
- **The one prompt sentence** that names the output mechanism ("Gebruik de `extract_meeting_notes` tool" vs "Stuur je antwoord als JSON-object").
- **Prompt caching.** Anthropic marks the system block `cache_control: ephemeral`; OpenAI derives a `prompt_cache_key` from a hash of the system prompt.

Everything else — the agenda/participant/language prompt body, the coercion, the retry-degrade, the `inferContext` flow — was duplicated. The deletion test made it plain: remove the contract from one family and it reappears in the other.

## Decision

Introduce a vendor-neutral `ExtractionEngine` (`extractionEngine.ts`) that owns the whole extraction contract, parameterised by a small `ExtractionWire` seam. `AnthropicExtractionProvider` becomes a thin transport adapter over the same engine, exactly as the OpenAI-compatible adapters already are.

`ExtractionWire` is everything a vendor supplies beyond the generic contract:

- `callStructured(call, system, user): Promise<unknown>` — send the prompts and return a _parsed candidate object_, or `null` on transport/HTTP/shape failure (`unknown` already includes `null`). `call` is a small union — `{ kind: 'extract'; isFinalPass }` or `{ kind: 'infer' }` — carrying exactly what a wire needs to route: `kind` tells the Anthropic wire which tool + `input_schema` to force (the OpenAI wire ignores it, always `json_object`), and `isFinalPass` lets the Anthropic wire pick a model per pass (haiku rolling, sonnet final).
- `extractInstruction` / `inferInstruction` — the per-vendor "how to hand the result back" sentence the engine appends to the shared prompt body.

The seam sits at the one point where both families become identical: **a parsed candidate object.** `parseJsonLoose` stays in the OpenAI wire (tool use already returns an object); the SDK tool-use decode stays in the Anthropic wire. The engine runs coercion, retry-degrade, and `devlog` on the `unknown` it gets back.

`summarise` and `query` (Anthropic-only, plain-text, no structured output) stay vendor-specific in `AnthropicExtractionProvider`, outside the engine.

### File layout

| File                   | Owns                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `extractionEngine.ts`  | `ExtractionEngine` core, the `ExtractionWire` interface, the shared prompt builders, and the coercion helpers. |
| `openAiJsonWire.ts`    | OpenAI/Azure transport: `fetch`, `json_object`, `parseJsonLoose`, `prompt_cache_key`, `ChatCompletionsTarget`. |
| `anthropicToolWire.ts` | Anthropic SDK transport: `messages.create`, tool definitions + `input_schema`s, `cache_control`.               |

The rename from `ChatExtractionEngine` is deliberate: the core is no longer chat/completions-specific, so a "Chat" name would mislead the Anthropic path.

## Trade-offs

- **Anthropic adopts the lenient coercion — a behaviour change.** Anthropic previously validated the tool input with a strict, all-or-nothing `ExtractionResponseSchema.safeParse`: one malformed item failed the whole turn, which then retried and degraded to empty. Under the shared engine it uses `coerceExtractionResponse`: valid items are kept, malformed ones dropped, and the retry fires only when the response is not a JSON object at all. This is strictly better for Proposed items (the note-taker reviews them anyway), and forced tool use with an `input_schema` makes malformed output rare, so the blast radius is small. Two Anthropic tests that encoded the old strict-then-retry behaviour were rewritten. We chose the unified, more resilient behaviour over strict behaviour-preservation.
- **The two prompts converge — a behaviour change for both vendors.** Sharing the prompt body means one canonical body, the union of what each family had: the explicit "give all text in the primary language" instruction (Anthropic had it, OpenAI gains it) and the inline schema description (OpenAI had it, Anthropic gains it — redundant with `input_schema`, harmless). Only the output-mechanism sentence stays per-vendor, on the wire. The net change to the live OpenAI prompt is an improvement (the language instruction); Anthropic gains harmless redundant schema text.
- **One more indirection.** A reader follows `Provider → ExtractionEngine → wire` instead of one flat class. Accepted: the alternative was two contracts kept in lockstep by hand, where a coercion or retry fix in one silently missed the other.
- **The wire seam is main-process, not a domain port.** It lives in `src/main/providers/`, not `src/shared/`, because it is transport infrastructure (SDK / `fetch` lifecycle), not domain vocabulary. It imports zero vendor SDKs into the shared core, so ports-and-adapters (ADR 0007) is intact.

## Implementation notes

- `inferContext` moves into the engine too (same wire seam, `kind: 'infer'`). Unlike `extract`, inference keeps strict `InferredContextSchema` validation in both families — that was already symmetric, so no behaviour change there.
- Anthropic gains `devlog` under the shared engine (opt-in `--debug`, metadata-first, privacy-safe) and a `[Anthropic]` log tag, matching the OpenAI-compatible adapters.
- Prompt caching stays wire-side: the engine passes the full system string to `callStructured`, so the OpenAI wire hashes it for `prompt_cache_key` and the Anthropic wire wraps it in `cache_control: ephemeral`.
- Devlog fidelity narrowed slightly, by design. Because the seam returns a parsed candidate (not the raw response string), the old three failure events (`post-failed` / `parse-failed` / `not-an-object`) collapse into one `call-failed` event, and the turn logs the re-serialised candidate instead of the raw model string. A raw response string is an OpenAI-ism the Anthropic tool-use path has no equivalent for, so it does not belong in the vendor-neutral seam. This is a dev-only opt-in log; no test asserts the lost fidelity.
- `FakeExtractionProvider` is untouched: it implements the port directly, not through the engine, so deterministic tests stay deterministic.
- Privacy (principle #12) is preserved: the API key lives inside the wire (`target.headers` / the SDK client) and is never seen by the engine; only non-sensitive metadata is logged.
