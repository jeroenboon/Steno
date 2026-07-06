# ADR 0036 — ASR terminal state surfaced end-to-end to the EgressIndicator

**Status:** accepted (implemented 2026-07-06)  
**Relates to:** ADR 0003 (privacy / egress, the always-visible EgressIndicator), ADR 0005 (process discipline, typed preload bridge), ADR 0007 (ports & adapters), ADR 0013 (IPC streaming events), ADR 0032 (shared realtime transport + `onTerminal` seam); audit finding C4

## Problem statement

ADR 0032 gave `RealtimeSpanStream` a bounded reconnect loop that terminates on a permanent auth failure (revoked/invalid key) or the consecutive-failure ceiling (endpoint unreachable), firing an injected `onTerminal({ reason })` callback. But that callback died inside the stream: nothing told the note-taker. A key revoked mid-meeting stopped the transcript with **no signal** — the exact silent-failure C4 warned about. Surfacing it needed a runtime-status channel distinct from the settings-derived `EgressState`, which ADR 0032 deferred as a wider IPC/egress change.

## Decision

Thread the terminal state all the way to the always-visible EgressIndicator (the audit-named home), layer by layer, as Jeroen's explicit full-wire choice over a minimal hack:

1. **Shared DTO** (`src/shared/providers/asrTerminalState.ts`): `AsrTerminalStateSchema` / `AsrTerminalReasonSchema` (`'auth' | 'max-retries'`) is the single source of truth. `RealtimeTerminalState` in the stream is now a type alias of it.
2. **Port event** (`ASRProvider.onTerminal?(cb)`): an optional observer registration on the port. Realtime adapters (Deepgram, OpenAI Realtime — reused by Azure, Mistral Voxtral) implement it by relaying their `RealtimeSpanStream`'s `onTerminal` out through a mutable field. Batch/local providers (`transcribeBatch`, on-device) have no socket and simply omit it.
3. **Runtime** (`LiveExtractionRuntime`): `handleAsrTerminal(state)` pushes the reason on a new IPC channel; the `LiveSessionController` wires the ASR provider's `onTerminal` to it alongside the span wiring. A fresh runtime (= a new session) pushes `reason: null` on construction, clearing any stale error from a prior meeting.
4. **IPC push channel** `asr:terminal` (`AsrTerminalPayloadSchema = { reason: enum | null }`), modelled on `transcript:span` / `items:changed`: sent via `webContents.send` from the runtime, exposed as `window.api.onAsrTerminal(cb)` through the preload `subscribe()` helper, and Zod-validated renderer-side via `onValidated`.
5. **Renderer**: the Zustand store holds `asrTerminalReason`; `App` subscribes and the **EgressIndicator** renders the stop reason additively (Dutch, i18n keys `egress.asr.stopped.auth` / `egress.asr.stopped.max-retries`) as an assertive live region, keeping the normal egress badge intact.

## Why a separate push channel (not `EgressState`)

`EgressState` is derived from persisted settings (which providers the user chose) and is fetched once. The terminal state is a **runtime** signal about a live socket that died — orthogonal to configuration, and it must arrive as an event, not a poll. Folding it into `EgressState` would conflate "what the user configured" with "what just broke", and force the settings-derived value to carry transient session state. A dedicated event channel keeps each concern in its own lane; the EgressIndicator is simply the shared render surface for both.

## Privacy (principle #11 / #12)

The payload and every log line carry **only the reason enum** — never a key, a URL with credentials, or transcript content. The stream already classifies auth vs. max-retries from non-sensitive close codes / handshake status; nothing sensitive crosses the port, the IPC boundary, or the devlog.

## Trade-offs

- **`reason: null` doubles as the reset.** Rather than a second "clear" channel, a new session pushes `null`. Simple, and the store maps it straight to "healthy". The runtime constructor is the reset point, so `LiveSessionController.start()` (which builds a fresh runtime) clears a stale banner for free; `resume()` reuses the runtime and deliberately does not re-clear.
- **The wire is controller-driven, not runtime-owned.** The `LiveExtractionRuntime` does not hold the ASR provider (the `LiveSessionController` owns that lifecycle and the span wiring), so the controller connects `asrProvider.onTerminal → runtime.handleAsrTerminal`, mirroring how it already connects spans. No `index.ts` `sendX` was added: like every other push channel (`nudges:changed`, `agenda:changed`, `summary:changed`), the event originates in a service and goes straight out via the injected sender.
- **`role="status"` + `aria-live="assertive"`.** A stopped transcript is time-sensitive, so the region announces assertively; ink-red (`--color-live`) stays reserved for the live-recording signal per the design tokens, so the notice uses ink emphasis + a separating rule, not colour.

## Tests

- **Adapter** (`DeepgramAsrProvider.test.ts`): a fake socket auth-code close makes the adapter emit the port terminal event `{ reason: 'auth' }`; a transient close does not.
- **Runtime** (`liveExtractionRuntime.test.ts`): `handleAsrTerminal` pushes `asr:terminal` with the reason; constructing a runtime pushes the `reason: null` reset.
- **IPC/preload** (`preload/index.test.ts`): `onAsrTerminal` registers on `asr:terminal`, forwards the payload, and unsubscribes.
- **Renderer** (`EgressIndicator.test.tsx`): the Dutch message renders per reason, as a `role="status"` assertive live region, additively with the normal badge, and disappears when the reason clears.
