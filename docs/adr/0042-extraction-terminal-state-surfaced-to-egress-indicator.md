# ADR 0042 — Extraction terminal state surfaced end-to-end to the EgressIndicator

**Status:** proposed
**Relates to:** ADR 0003 (privacy / egress, the always-visible EgressIndicator), ADR 0005 (process discipline, typed preload bridge), ADR 0007 (ports & adapters), ADR 0013 (IPC streaming events), ADR 0034 (shared extraction wire + engine), ADR 0036 (ASR terminal state — the sibling this mirrors), ADR 0039 (shared ExtractionSession core), ADR 0040 (local extraction provider — this reverses its decision 5)

## Problem statement

The first real local-extraction run (a Qwen3 reasoning model in LM Studio) produced **no notes** while the transcript kept flowing. The model spent its whole generation budget "thinking": `finish_reason: "length"`, `completion_tokens: 1968` of which `reasoning_tokens: 1967`, and `content: ""`. The answer never got written. Our engine treated the empty content as a failed parse, retried once (another ~38 s), skipped the turn, and did the same on every following turn — silently. Nothing told the note-taker the chosen model is unsuitable.

ADR 0040 decision 5 deliberately left this silent: "runtime extraction failure stays silent-no-items … a runtime 'extraction stopped' signal is explicitly out of scope." Jeroen's requirement reverses that: on a **truncated** response the app must **stop live LLM interpretation entirely and say so**, because a model that truncates once would otherwise keep dribbling unreliable fragments into the notes, and the invariant is **no wrong content in the report**. The transcript must keep recording so the meeting can be analysed later with a suitable model.

Truncation is not local-specific: OpenAI-compatible endpoints report `finish_reason: "length"` and Anthropic reports `stop_reason: "max_tokens"` whenever a model runs out of budget mid-answer. So this is a general Extraction Provider concern, not a local one.

## Decision

Introduce an **Extraction Terminal State**, the sibling of the ASR Terminal State (ADR 0036), threaded the same way, layer by layer, to the same always-visible EgressIndicator:

1. **Shared DTO** (`src/shared/providers/extractionTerminalState.ts`): `ExtractionTerminalStateSchema` / `ExtractionTerminalReasonSchema` (`'output-truncated'`) is the single source of truth. The reason names the **observation** (the model truncated), not the conclusion; the UI copy interprets it ("het gekozen model lijkt niet geschikt voor live-extractie"). An enum, not a boolean, leaves room for later reasons without a contract change.
2. **Wire detection.** The wire reads the stop signal and, on truncation, throws a typed `ExtractionTruncatedError` instead of returning the usual `null` candidate:
   - `OpenAiJsonWire` (the whole OpenAI-compatible family — cloud OpenAI/Mistral/Azure **and** local): `choices[0].finish_reason === 'length'`.
   - `AnthropicToolWire`: `stop_reason === 'max_tokens'`.
   A typed error (not the existing `null`) because the engine must tell truncation apart from an ordinary parse miss: only truncation skips the retry and fires the terminal.
3. **Engine.** `ExtractionEngine.extract()` / `inferContext()` catch `ExtractionTruncatedError`, fire an injected `onTerminal({ reason: 'output-truncated' })`, **skip the retry** (a truncation never improves on a second identical call), and return the normal empty "no items" response. The truncating turn simply yields nothing; the terminal ensures no further turn runs.
4. **Port event** (`ExtractionProvider.onTerminal?(cb)`): an optional observer registration, like `summarise` / `query` / `inferContext`, so existing fakes and adapters are untouched. `OpenAICompatibleExtractionProvider` / `AnthropicExtractionProvider` construct their engine with an `onTerminal` that re-emits to this seam.
5. **Runtime** (`LiveExtractionRuntime`): subscribes to `provider.onTerminal`. On fire it (a) halts the rolling cadence and the slow agenda scheduler, (b) latches a flag so `endMeeting()` **skips `runFinalPass()` and end-of-meeting inference** while still transitioning Live → Ended, and (c) pushes the reason on a new IPC channel. A fresh runtime (a new session) pushes `reason: null` on construction, clearing any stale notice.
6. **IPC push channel** `extraction:terminal` (`ExtractionTerminalPayloadSchema = { reason: enum | null }`), modelled on `asr:terminal`: `webContents.send` from the runtime, exposed as `window.api.onExtractionTerminal(cb)` through the preload `subscribe()` helper, Zod-validated renderer-side.
7. **Renderer**: the Zustand store holds `extractionTerminalReason`; `App` subscribes and the **EgressIndicator** renders it additively (Dutch, i18n) as an assertive live region, next to the ASR terminal notice, leaving the normal egress badge intact.
8. **Static settings hint.** The local extraction card carries an always-visible hint steering users to an instruct model with a roomy context window, since a reasoning model is the usual trigger and no_think cannot be forced over the API (see "Rejected alternatives").

## Scope of the stop

A **single** truncation from **any** live LLM call — rolling extraction, live agenda inference, or the running summary — trips the terminal. It is a property of the model, not of the particular call, so the first one anywhere is enough. Once tripped, **all** live LLM interpretation for the meeting stops, including the automatic final pass. Already-Proposed items and the full transcript remain; only future model calls are prevented.

## Why a separate push channel (not `EgressState`)

Same reasoning as ADR 0036: `EgressState` is derived from persisted settings and fetched once; the terminal state is a **runtime** event about a model that just failed, orthogonal to configuration. Folding it in would conflate "what the user configured" with "what just broke". The EgressIndicator is merely the shared render surface for both.

## Privacy (principle #11 / #12)

The payload and every log line carry **only the reason enum** — never a key, prompt, or transcript content. Truncation is classified from the non-sensitive `finish_reason` / `stop_reason` field alone.

## Trade-offs

- **Stop-on-first, not tolerate-and-skip.** Chosen deliberately (option A over "keep skipping turns" or "ask before the final pass"): it is the only behaviour consistent with "no wrong content in the report", and it is the simplest. Cost: one genuinely-transient truncation kills extraction for the rest of the meeting. Acceptable because the transcript survives for a later, deliberate re-analysis, and truncation is a model/config property that will recur, not a blip.
- **The final pass is skipped too.** A model that truncated the rolling turns would truncate the final pass just as badly, so running it would only inject the unreliable content we are trying to keep out.
- **Anthropic included now.** `stop_reason: "max_tokens"` is wired alongside the OpenAI-compatible path, even though forced tool use rarely truncates there, so the seam is honest for every provider from the start.
- **The wire is provider-driven, not runtime-owned.** Unlike ASR (where the `LiveSessionController` owns the socket and wires `onTerminal`), the `LiveExtractionRuntime` already holds the extraction provider, so it subscribes directly.

## Rejected alternatives

- **Enforce no_think over the API.** Tested against the running model: neither `chat_template_kwargs: { enable_thinking: false }` nor a `/no_think` prompt disabled reasoning (799 / 833 reasoning tokens still spent). Not reliable, so we hint in settings instead.
- **Poll the context window at "Test verbinding".** The portable `/v1/models` exposes no context length; only LM Studio's proprietary `/api/v0/models` does, and it reports the model **maximum** (e.g. 262144), not the **loaded** window, so it gives false comfort. It also would not have caught the actual failure, which was output-budget truncation from reasoning, not context overflow. A behavioural probe (a tiny real request that detects reasoning/truncation) would catch it but adds real latency to the test (a slow reasoning model makes the test slow); parked as a possible follow-up. The runtime Extraction Terminal State is the reliable, provider-agnostic catch.

## Tests

- **Wire** (`OpenAICompatibleExtractionProvider.test.ts`, `AnthropicExtractionProvider.test.ts`): a `finish_reason: 'length'` / `stop_reason: 'max_tokens'` response makes `extract()` fire the port `onTerminal` once, skip the retry (one fetch/SDK call, not two), and return an empty response.
- **Runtime** (`liveExtractionRuntime.test.ts`): an `onTerminal` fire pushes `extraction:terminal` with the reason, halts the schedulers, and makes a subsequent `endMeeting()` skip the final pass while still ending the meeting; constructing a runtime pushes the `reason: null` reset.
- **IPC/preload** (`preload/index.test.ts`): `onExtractionTerminal` registers on `extraction:terminal`, forwards the payload, and unsubscribes.
- **Renderer** (`EgressIndicator.test.tsx`): the Dutch message renders for `output-truncated`, as a `role="status"` assertive live region, additively with the normal badge, and disappears when the reason clears.
