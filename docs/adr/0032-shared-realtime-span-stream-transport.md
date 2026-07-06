# ADR 0032 — Shared realtime ASR transport: `RealtimeSpanStream`

**Status:** accepted (implemented 2026-07-04)  
**Relates to:** ADR 0007 (ports & adapters), ADR 0011 (Deepgram streaming), ADR 0027 (extraction protocol discrimination + `ChatExtractionEngine`), ADR 0028 (no shared realtime _wire_), ADR 0031 (resample in the adapter); 2026-07 architecture review item 2

## Problem statement

Every streaming ASR adapter — `DeepgramAsrProvider`, `OpenAIRealtimeAsrProvider` (shared by Azure), `MistralVoxtralRealtimeAsrProvider` — carried a near-identical copy of the same realtime transport plumbing:

- the `_queue` / `_waiters` async-iterator behind `spans()`, and `stop()` draining the waiters so the iterator completes;
- the `_connect` + `_reconnectAfterDelay` exponential-backoff loop (1s → 2s → … → `maxBackoffMs`), with the socket lifecycle handlers;
- the `string | ArrayBuffer | Uint8Array → JSON` frame decoder;
- the emit-to-waiter-or-queue push.

The deletion test made it plain: delete the plumbing from any one adapter and it reappears identically in the other two. What actually varies per vendor is small: the connection (URL + auth), the session-config message on open, the audio-frame encoding, and the event → `TranscriptSpan` parse. The extraction side already had the deep-module answer for exactly this shape — `ChatExtractionEngine` lets the OpenAI-compatible and Azure adapters be ~30-line transport shims. ASR had no equivalent.

## Decision

Introduce `RealtimeSpanStream` (`src/main/providers/realtimeSpanStream.ts`): a deep module that owns _all_ the generic realtime transport, parameterised by a small `RealtimeAsrWire` seam.

`RealtimeAsrWire` is everything a vendor supplies beyond generic transport:

- `name` — for log lines;
- `connect()` — open a socket; URL + auth (subprotocol or headers) are the wire's concern;
- `reset?()` — per-session state reset on `start()` (e.g. clock-derived span timing);
- `onOpen?(socket)` — send session-config message(s) once open;
- `encodeFrame(chunk)` — encode a captured PCM frame for the wire;
- `parseMessage(message)` — map one decoded JSON message to zero or more spans.

Each provider keeps its public constructor and `ASRProvider` surface unchanged and delegates `start` / `stop` / `pushAudioFrame` / `spans` to an internal `RealtimeSpanStream`. Deepgram additionally keeps its `transcribeBatch` REST path, which is unrelated to the realtime wire.

The canonical `WebSocketLike` interface and `WS_OPEN` now live in `realtimeSpanStream.ts`; `DeepgramAsrProvider` re-exports `WebSocketLike` for existing importers.

## Reconciliation with ADR 0028 ("no shared realtime wire across vendors")

ADR 0028 rejected a "generic streaming ASR adapter" because the vendors share no **protocol**: session setup, event shapes, and interim/final semantics genuinely differ. That still holds — those differences live entirely in each wire's `onOpen` and `parseMessage`, per vendor.

This ADR shares only the **transport plumbing**, which is identical across all three. Protocol stays per-vendor; the queue/iterator/reconnect/decode machinery is shared. `RealtimeSpanStream` sharpens ADR 0028 rather than contradicting it: it draws the line 0028 gestured at (wire = protocol, per-vendor) more precisely by naming the part that was never vendor-specific.

## Trade-offs

- **One more indirection.** A reader now follows `Provider → RealtimeSpanStream → wire callbacks` instead of reading one flat class. Accepted: the alternative was three flat classes kept in lockstep by hand, where a reconnect or draining bug fixed in one silently persisted in the others.
- **The wire seam is main-process, not a domain port.** It lives in `src/main/providers/`, not `src/shared/`, because it is transport infrastructure (WebSocket lifecycle), not domain vocabulary. It imports zero vendor SDKs, so the ports-and-adapters rule is intact.
- **Timing state stays on the provider.** OpenAI/Voxtral keep `_startedAtMs` / `_lastEndMs` as instance fields and reset them via the wire's `reset()`; the stream owns no vendor timing.

## Implementation notes

- Behaviour is unchanged: every existing provider test (Deepgram, OpenAI Realtime, Azure realtime, Voxtral) passes with only a type-only widening of the test fakes' `onmessage` event `data` from `string` to `unknown` (the honest shape — `ws` delivers Buffers, and the shared decoder already normalised it).
- `RealtimeSpanStream` has its own test suite driving it through a fake wire + fake socket: span emission, the `reset`/`onOpen` seam, frame encoding + send-only-while-open, multi-span messages, malformed-JSON skip, reconnect-with-backoff, backoff cap, no-reconnect-after-stop, iterator completion, and content never logged (principle #12).
- Privacy (principle #12) is preserved: auth material lives inside the wire's `connect()` and is never seen by the stream; only non-sensitive lifecycle metadata is logged, prefixed with the wire's `name`.

## Update (2026-07-05) — bounded reconnect + terminal states (audit finding C4)

The original reconnect loop was unbounded and blind to permanent failures: a key revoked mid-meeting (or wrong from the start) reconnect-looped forever while the transcript silently stopped, with no signal to the user. The stream now terminates in two cases:

- **Permanent auth failure.** An auth close code (WebSocket policy-violation `1008`, plus Deepgram's private-range `4001` / `4008`) or a handshake error carrying HTTP `401` / `403` (`ws` surfaces `"Unexpected server response: 401"`) stops retrying immediately — reconnecting into a bad key can never succeed.
- **Consecutive-failure ceiling.** After `maxConsecutiveFailures` (default 8) closes with no successful open in between, the stream gives up. A successful open resets the tally, so a healthy-but-flaky link never drifts toward it.

On termination the stream stops reconnecting, completes the `spans()` iterator (so consumers don't hang), and fires an injected `onTerminal(state)` callback once with `{ reason: 'auth' | 'max-retries' }`. The callback is the contained seam an ASR provider / the runtime can observe. **Surfacing it to the renderer (the EgressIndicator rail) is deferred**: that needs a runtime-status channel distinct from the settings-derived `EgressState` — a wider IPC/egress change than this finding. Auth-close-code classification lives in the stream (not per-wire) because all three realtime wires cast a raw `ws` socket and share the same signals; if a vendor ever needs bespoke classification, promote it to an optional wire seam method.
