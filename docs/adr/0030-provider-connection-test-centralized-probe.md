# ADR 0030 — Provider "Test connection" is a centralized probe, not a per-adapter method

**Status:** accepted (implemented 2026-06-24)  
**Relates to:** ADR 0005 (process discipline), ADR 0007 (ports & adapters), ADR 0014 (write-only secrets), Multi-provider expansion plan (Phase 5.1)

## Problem statement

A user can mistype an API key, base URL, Azure endpoint or deployment in Settings and only discover it mid-meeting, when ASR or extraction silently fails. Phase 5.1 asks for a "Test connection" affordance per provider so the mistake surfaces at config time.

Two questions had non-obvious answers:

1. **Where does the probe live?** The plan text implied a per-provider check ("models list for chat, a tiny transcription for ASR"). The obvious reading is a `testConnection()` method on each adapter.
2. **What round-trip?** A literal "tiny transcription" for ASR, or something cheaper.

## Decisions

### 1. One centralized `testProviderConnection`, not a method on every adapter

The probe is a single function in `src/main/settings/connectionTest.ts` that switches on the provider type, assembles the cheap request (URL + auth header), looks up the key, and does one `GET`. It does **not** add a `testConnection()` method to the `ASRProvider` / `ExtractionProvider` ports.

Why:

- **The live/import adapter split makes a port method awkward.** A cloud-ASR vendor uses a realtime adapter live and a batch adapter for import (ADR 0028), but one key serves both. A `testConnection()` method would have to be implemented on ~8 adapter classes including the realtime ones, and the caller would have to decide which adapter variant to build just to test a key. The probe is a config-time concern that cuts across that split.
- **Centralizing keeps the URL/auth assembly for the check in one easily tested place.** All branches are covered by one spec with a mocked `fetch`, asserting the exact URL + auth header per provider and that the key never leaks into logs.

The trade-off: a small amount of URL/auth knowledge is duplicated between the adapters and the probe (e.g. the `/models` path, the `api-key` vs `Bearer` choice). That duplication is shallow and stable, and worth it to avoid threading a method through the realtime/batch hierarchy.

### 2. Auth/reachability check, not a "tiny transcription"

Every probe is a `GET` against the vendor's models/projects listing:

- OpenAI / Mistral / OpenAI-compatible → `${baseUrl}/models`, `Authorization: Bearer`
- Anthropic → `https://api.anthropic.com/v1/models`, `x-api-key` + `anthropic-version`
- Azure OpenAI / Azure Speech → `${endpoint}/openai/models?api-version=…`, `api-key`
- Deepgram → `https://api.deepgram.com/v1/projects`, `Authorization: Token …`
- local-parakeet → no probe (on-device; nothing to reach)

This validates the same things a tiny transcription would (the key is accepted, the endpoint resolves) at near-zero cost and without synthesising per-vendor silent audio. The cost of being slightly less end-to-end than a real transcription is acceptable for a config-time smoke check.

### 3. The key never crosses back; the result is a short code

`provider:testConnection` (an invoke channel) takes `{ role }`, and main returns `{ ok: true }` or `{ ok: false, error }` where `error` is a short code: `HTTP 401`, `no-key`, `network`, `unavailable`. The key only ever travels inside the outbound request headers — never returned to the renderer (consistent with ADR 0014's write-only secrets), never logged, never echoed in the error. On a transport throw the result degrades to a generic `network` so the underlying error object can't leak the URL or key.

The registry takes the probe as an injected `testConnection` dependency (like `meetingLoad`, `onExportFile`), so `ipc-registry.ts` stays pure and the channel is unit-tested with a fake; `main/index.ts` wires it to `testProviderConnection` over the live settings + secrets.

## Consequences

- Adding a new vendor means adding one branch to `resolveExtractionProbe` / `resolveAsrProbe`, not a new adapter method.
- The renderer's `TestConnectionButton` maps the short error code to a Dutch line and is reused in every cloud provider config panel.
- If a future need arises for a genuine end-to-end test (real transcription / real completion), it can layer on top without moving the cheap probe.
