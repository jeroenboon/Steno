# ADR 0038 — IPC registry dependencies as grouped role interfaces

**Status:** accepted (implemented 2026-07-06)
**Relates to:** audit finding A2 (`ipc-registry.ts` dependency surface); amends item 0012 (handler injection); ADR 0005 (process discipline)

## Problem statement

Item 0012 introduced handler injection: `createIpcRegistry(deps)` takes its stateful collaborators as dependencies so the registry stays a pure, Electron-free function that unit tests can drive. It modelled those dependencies as a **flat bag of ~30 optional callbacks** (`onAudioStart`, `onMeetingEnd`, `meetingList`, `meetingLoad`, `onCopyTranscript`, `inferContextFromText`, …).

Two costs grew out of that shape:

- **`index.ts` wired ~30 forwarder lambdas** — `onMeetingEnd: (id) => liveSession.endMeeting(id)`, `meetingList: () => meetingQuery.list()`, and so on — almost all of them one-line pass-throughs to a handful of collaborators (`LiveSessionController`, `MeetingQueryService`, `ImportSessionController`, `ItemLifecycleService`).
- **The dependency surface was unbounded and unnavigable.** Every new channel added another optional callback to one growing interface, and the audit flagged the file at 816 LOC.

## Decision

Group the callback dependencies into a handful of narrow **role interfaces** that the real collaborators already satisfy, so `index.ts` passes objects instead of lambdas:

- `SessionOps` (start / stop / endMeeting / pause / resume / querySummary) — satisfied by `LiveSessionController`, wired as `session: liveSession`.
- `ItemOps` — the note-taker action methods, `Pick`ed from `ItemLifecycleService` so the port can never drift from what the handlers call; wired as `items: itemService`.
- `HistoryOps` (list / load / delete) — satisfied by `MeetingQueryService`, wired as `history: meetingQuery`.
- `ImportOps` (start / finish / inferFromText), `ModelOps` (downloader + pushProgress), `ProviderOps` (testConnection).
- `PlatformOps` — the genuinely Electron-native side effects that cannot live in the pure registry (the save dialog, the clipboard, and copying a transcript), built in `index.ts` over `dialog` / `clipboard` / `MeetingQueryService`.
- `PrepDeps` — the Draft-prep repos backing `meeting:create`, `agendaItem:*`, `participant:*`.

`settingsStore`, `secretStorage` and `clock` stay **top-level** (they are needed almost everywhere, and keeping them there means the many tests that pass only a settings store don't churn).

Optionality is now **per group, not per method.** A whole domain object is present or absent; absent → that domain's channels degrade with exactly the "not available" error / no-op / empty-context fallback they had before. In production `index.ts` always wires a collaborator's full method set, so the old per-method optionality was only ever exercised by tests. (`PrepDeps` is the one exception: its repo members stay individually optional, because a caller genuinely can prepare an agenda without a participant repo — audit C1.)

The registry still depends only on these **ports**, never on the concrete controller classes: fakes implement the interfaces and the registry remains unit-testable without Electron (the item-0012 property is preserved). The Zod-parse-per-channel dispatch, the `IpcChannel` union coverage, and the completeness guard are unchanged.

## Follow-up: per-domain file split (audit A2b)

The role-interface reshape above (A2a) left every handler reading from its own dep group but still in one 799-LOC file. A2b completes the move: the handler factories, and the role interface each one consumes, now live in per-domain modules under `src/main/ipc/` — `sessionHandlers.ts` (+ `SessionOps`), `itemHandlers.ts` (+ `ItemOps`), `historyHandlers.ts` (+ `HistoryOps`), `prepHandlers.ts` (+ `PrepDeps`), `importHandlers.ts` (+ `ImportOps`), `modelHandlers.ts` (+ `ModelOps`), `platformHandlers.ts` (+ `PlatformOps`), `settingsHandlers.ts` (+ `ProviderOps`), plus a shared `handlerTypes.ts` for the `Handler` type.

Each module exports a factory returning a `Partial<Record<IpcChannel, Handler>>` for its channels and takes only its own dep slice (`SessionHandlerDeps`, etc.). `ipc-registry.ts` is now a thin **composer**: `IpcRegistryDependencies` is the aggregate of those slices, `createIpcRegistry` spreads the per-module maps into one `HANDLERS` map, and it still owns dispatch + the unknown-channel guard + the `IpcChannel` completeness property. The role interfaces are re-exported from `ipc-registry.ts` so `index.ts` and the tests keep a single import site and need no changes. Pure code movement — no behaviour change.

## Trade-offs

- **A role-shaped port vs. a flat callback bag.** The registry now knows a handful of domain-shaped interfaces instead of one undifferentiated list of callbacks. That is a little less "dumb", but it is what lets `index.ts` wire objects, and it is still fully decoupled and fake-able — the property that made the callback bag worth having in the first place.
- **Per-group degradation granularity.** We gave up the ability to, say, wire `meeting:load` while leaving `meeting:list` absent. Nothing in production ever did that; it was a test-only degree of freedom, and dropping it makes the contract simpler to reason about.
- **Amends item 0012.** The registry header comment there described the "bag of callbacks" as the design; that rationale is updated in place so a future reader is not surprised by the shift.
