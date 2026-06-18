# ADR 0011 — Deepgram ASR adapter: raw WebSocket, interim/final span model, bounded backoff

**Status:** Accepted
**Date:** 2026-06-14
**Item:** 0011

## Context

Item 0011 implements the Deepgram realtime ASR adapter behind the existing `ASRProvider` port.
Three design choices had real trade-offs and are recorded here.

## Amendment (2026-06-18, item 0016 verification)

The default `WebSocketFactory` originally used the global `WebSocket`. That global does
not exist in the Electron **main** process (Node), so the first real `audio:start`
threw `ReferenceError: WebSocket is not defined`. The adapter now depends on a minimal
structural `WebSocketLike` interface, defaults to the Node **`ws`** package, and uses a
local `WS_OPEN = 1` constant instead of referencing the global `WebSocket.OPEN`. Tests
still inject a fake of the `WebSocketLike` shape. `ws` is pinned in dependencies.

## Decision 1: raw WebSocket over the Deepgram SDK

`@deepgram/sdk` was not in the project at item start. The Deepgram realtime API is a
well-documented WebSocket protocol; the SDK is a thin wrapper over it.

**Chosen approach:** a raw WebSocket client with an injected `WebSocketFactory` dependency.

**Why this is better for this project:**

- The factory is the only seam tests need. Mocking the factory replaces the entire transport
  with a `FakeWebSocket` that has test helpers (`simulateOpen`, `simulateMessage`,
  `simulateClose`). No SDK object graph to fake, no `vi.mock()` of a package.
- Keeps deps minimal (principle #15). Adding the SDK would have introduced a significant
  transitive dep tree for functionality we use maybe 5% of.
- The reconnect/backoff logic (see Decision 3) lives in our code, fully tested, rather than
  relying on SDK internals we can't observe.

**What we'd gain from the SDK:** auto-reconnect, keepalive framing, typed events. We implement
reconnect ourselves (bounded, tested). Keepalive can be added later. Typed events are handled
by our own Zod schema.

**Hard to reverse:** if the Deepgram protocol changes significantly, we'd update our Zod schema
and URL builder. Migrating to the SDK later is mechanical, not risky.

## Decision 2: emit both interim and final spans; add optional `isFinal` to TranscriptSpan

Deepgram sends `is_final=false` results as text stabilises, then `is_final=true` once committed.
The existing `TranscriptSpan` schema had no way to express this.

**Options considered:**

1. Drop interim spans, emit finals only. Simple; no schema change. Downside: the live
   transcript pane (item 0017) can't show what's being said until the word is finalised —
   typically a 1–2s lag that feels broken on screen.
2. Add `isFinal?: boolean` to `TranscriptSpanSchema`. Costs a schema change; gains the
   ability to display live-updating text while protecting the extraction loop from unstable text.
3. Emit a separate `InterimSpan` type. Avoids changing the shared schema but introduces a
   second type for items that look identical.

**Chosen:** option 2 — add `isFinal?: boolean` as a clearly-optional field to `TranscriptSpanSchema`.

**Rationale:**

- `isFinal` is absent from the existing field set, unambiguous in name, and optional, so all
  existing providers (Fake, Parakeet when it arrives) work without changes — `isFinal` simply
  stays `undefined`, which consumers treat as final.
- The extraction loop (item 0008) already has the right filter point: it accumulates spans
  from `spans()`. It should only pass `isFinal !== false` spans to the extraction provider
  (a one-line filter that wasn't needed before, now documented here as the intended seam).
- All 299 existing tests remained green; the FakeASRProvider needed no changes.

**Consequence:** the extraction loop must filter spans by `isFinal !== false` before sending
them to the `ExtractionProvider`. This is explicitly deferred to item 0008's implementation
scope but documented here as the contract.

## Decision 3: bounded exponential backoff with injected sleep

On socket drop, the adapter reconnects. Backoff: 1 s → 2 s → 4 s → ... capped at `maxBackoffMs`
(default 30 s).

**Sleep injection:** `options.sleep: (ms: number) => Promise<void>` defaults to a real
`setTimeout`-based sleep and can be replaced with `() => Promise.resolve()` in tests. No fake
timers needed; tests run at full speed.

**Session continuity:** the `spans()` async iterator's queue and waiters survive across
reconnects. Consumers see a continuous stream of spans regardless of how many times the socket
drops and reconnects — the session is never lost.

**Backoff reset:** intentionally not implemented (would reset backoff on successful connection).
Left as a future refinement; the current bounded cap prevents runaway reconnects without
complexity.

## Consequences

- `DeepgramAsrProvider` lives in `src/main/` (network + secret; main process only — principle #10).
- The API key appears only in the WebSocket URL, never in logs (principle #12).
- Audio frames, transcript text, and raw payloads are never logged.
- `TranscriptSpanSchema` has a new optional `isFinal` field — see CONTEXT.md for the glossary entry.
- Future adapters (Parakeet) can simply omit `isFinal` (undefined = treat as final).
