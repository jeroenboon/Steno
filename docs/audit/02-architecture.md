# Audit 02 — Architecture

## Verdict

The architecture is coherent, documented, and — unusually — the code actually matches the documentation. The three load-bearing decisions (process discipline, ports & adapters, Zod at every boundary) are enforced by structure, not convention. The July 2026 internal architecture review's findings have been systematically worked off; what remains are the two structural hotspots that review already flagged as "later" (the runtime hub and the IPC registry surface) plus renderer-side growth.

## The shape

```
renderer (React, UI only)
   │  window.api (typed preload bridge; Zod-validated push payloads)
   ▼
shared/ipc.ts (single source of truth: channels + request/response schemas)
   ▼
main: ipc-registry → services (lifecycle, extraction runtime, query)
              │            │
              ▼            ▼
        db/repos (SQLite, hand-rolled forward-only migrations)
        providers (adapters behind ASRProvider / ExtractionProvider ports)
```

- **Process discipline (ADR 0005)** holds: no `ipcRenderer` outside preload, no Node/vendor imports in renderer, all I/O and secrets in main. `src/shared/` imports zero vendor SDKs — verified by structure (ports + Zod DTOs only).
- **Ports & adapters (ADR 0007)** is the real thing, not aspiration: 12+ provider adapters (Deepgram, local sherpa-onnx, OpenAI/Azure/Mistral realtime + batch ASR; Anthropic/OpenAI-compatible/Azure extraction) sit behind two ports, with `FakeASRProvider`/`FakeExtractionProvider` + injectable `Clock` backing every timing test.
- **Two shared substrates keep adapters thin** (the biggest architectural win since the review): `RealtimeSpanStream` owns realtime transport (queue/iterator, reconnect+backoff, decode) behind `RealtimeAsrWire` (ADR 0032); `ExtractionEngine` owns the whole extraction contract (prompt, coercion, retry-degrade) behind `ExtractionWire` (ADR 0034), leaving OpenAI-family and Anthropic adapters as wire shims.
- **Graceful degradation is designed in:** `tryBuildAsrProvider` / `tryBuildExtractionProvider` return result objects, built independently, so a missing key degrades (Fake ASR / extraction off) instead of crashing.

## Follow-through on the 2026-07 review (docs/reviews/2026-07-architecture-review.md)

| Review finding                                                                | Status now                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `MeetingLifecycleService` was a decoy; live end never set `state: 'ended'` | **Fixed.** Service is the single enforcer, shared by both session controllers and the pause/resume IPC path (`src/main/index.ts:348-351`); the dead `MeetingEnded` pub/sub is gone.                                                 |
| 2. Realtime transport duplicated across 4 streaming adapters                  | **Fixed** — `realtimeSpanStream.ts` + ADR 0032.                                                                                                                                                                                     |
| 3. Anthropic re-implemented the extraction contract                           | **Fixed** — `extractionEngine.ts` + `anthropicToolWire.ts`/`openAiJsonWire.ts`, ADR 0034.                                                                                                                                           |
| 4. Item state machine had no observation seam; subclass hack                  | **Fixed** — `onItemsChanged` seam + `itemsChangedNotifier.ts`, authoritative-full-set push, ADR 0033.                                                                                                                               |
| 5. `LiveExtractionRuntime` 15-option hub, `MeetingContext` unowned            | **Partially fixed.** `MeetingContextOwner` (`meetingContextOwner.ts`) now owns context; `finalizeMeetingEnd.ts` extracts shared end-of-meeting logic. The runtime is still ~516 lines with live-vs-import forking by optional deps. |
| 6. IPC registry = 30 optional callbacks; logic hiding in `index.ts` closures  | **Partially fixed.** `MeetingQueryService` extracted (history reads); pause/resume routed through the lifecycle service. `ipc-registry.ts` is still 816 lines and `IpcRegistryDependencies` remains a wide bag of callbacks.        |
| Lower: `SettingsScreen.tsx` 1534 LOC                                          | **Improved** — now 757 LOC with provider cards extracted to components (`AudioAsrCard`, `AzureExtractionCard`, `OpenAICompatibleCard`, `ProviderKeyCard`, …).                                                                       |

This follow-through discipline (each finding → branch → PR → ADR) is worth calling out as a process strength.

## Remaining structural findings

### A1 — `LiveScreen.tsx` is the new biggest file (1,179 LOC) (MEDIUM)

The live note-taker screen now holds the title for size. Screens this central attract features (nudges, running summary, pause/resume, finalising overlay — all recent). Recommend the same treatment SettingsScreen got: extract panels (transcript pane, item list, summary/nudge rail) into components with their own tests before the next feature lands there.

### A2 — `ipc-registry.ts` dependency surface (MEDIUM, known)

816 LOC and a wide `IpcRegistryDependencies`. The review's direction stands: group callbacks per domain (session ops, item ops, history, model management, export) into a handful of interfaces so `index.ts` wires objects, not ~30 lambdas. This is a mechanical refactor; the Zod parse-per-channel dispatch itself is sound and should not change.

### A3 — `liveExtractionRuntime.ts` still forks live-vs-import via optional deps (MEDIUM, known)

Review item 5's remainder. With `MeetingContextOwner` and `finalizeMeetingEnd` extracted, the next contained step is a shared "session core" that both controllers compose, making the import path stop paying for (and dead-coding around) live-only concerns.

### A4 — `shared/ipc.ts` at 1,060 LOC (LOW, watch)

As the single source of truth for ~36 channels it is _supposed_ to be big, and one file beats scattered contracts. But it is nearing the point where per-domain modules re-exported from `ipc.ts` (meeting, items, settings/secrets, import, model) would keep it navigable without giving up the single-registry property (`IpcChannel` union + `RendererApi` stay in one place).

### A5 — Preload is 335 lines of hand-written repetition (LOW)

Every invoke method is the same `(req) => ipcRenderer.invoke('channel', req) as Promise<Resp>` shape and every subscription the same listener/unsubscribe dance. One generic `invoke<C extends IpcChannel>` helper + a `subscribe(channel)` helper would collapse ~200 lines and remove the per-method `as` casts. Low priority; the current form is at least dead-obvious to audit.

### A6 — Persistence layer (GOOD, minor notes)

Forward-only SQL migrations applied in a transaction, WAL mode, `foreign_keys = ON`, repos mapping rows through Zod. Schema is cross-meeting-ready by design. Note only: repo naming asymmetry flagged in the review (`listActionsByMeeting` vs `listByMeeting`) — verify it was normalised; and `mapRow.ts` exists, suggesting the shared row-map helper landed.

## Documentation ↔ code alignment

CONTEXT.md terms (Meeting, Decision/Action, Proposed/Confirmed, interim/final span, Egress State, paused-is-a-flag-not-a-state) match identifiers in code. ADRs are current through 0035 and reference the code they govern. CLAUDE.md's architecture section was checked against the source during this audit and no drift was found. This is rare and valuable; keep rule #4 (reflect after each change) alive.
