# Live extraction runtime: lifecycle binding and IPC event design (item 0018)

## Context

Item 0018 wires the already-built extraction engine (ExtractionLoopScheduler,
ItemLifecycleService) into the live runtime in the main process. Two non-obvious
design decisions arose during implementation.

## Decision 1 — Runtime constructs the scheduler from deps, not vice-versa

**Problem:** The scheduler must use an `itemLifecycleService` whose `proposeItems`
emits an IPC event to the renderer. The only way to intercept `proposeItems` without
modifying `ItemLifecycleService` is to subclass it (`InterceptingItemLifecycleService`
overrides `proposeItems`, calls `super.proposeItems()`, then fires the callback).

The scheduler is constructed with this subclass. Because the scheduler is given the
item service at construction time and holds a private reference, the runtime must build
the scheduler itself rather than accept a pre-built scheduler from outside. The runtime
takes `schedulerDeps` (the scheduler's deps minus `itemLifecycleService`) and builds
both the intercepting service and the scheduler internally.

**Consequence:** callers (e.g. index.ts) cannot pre-build and share a scheduler.
For a single-meeting runtime this is correct; the runtime owns one session.

**Alternative considered:** inject a callback into `ExtractionLoopScheduler` that fires
after `proposeItems`. Rejected: it would add `items:changed` concerns to the scheduler,
breaking its single responsibility (drive the extraction cadence).

**Alternative considered:** composition + `implements ItemLifecycleService`. Rejected:
`ItemLifecycleService` is a concrete class with `private` members; TypeScript does not
allow implementing a class's private fields from outside. `extends` is the correct
TypeScript mechanism here.

## Decision 2 — Live extraction runtime lifecycle binds to audio:start / audio:stop

**Problem:** When should the `LiveExtractionRuntime` be created and torn down?

**Decision:** Runtime is created inside `audio:start` IPC handler and stopped in
`audio:stop`. Rationale: ASR and extraction are a single pipeline for one session.
Starting audio implies the meeting is Live; stopping audio implies the session is over
for the runtime's purposes (the meeting may be Ended or paused).

The runtime's `endMeeting()` (final extraction pass) is separate from `stop()`: the
caller (index.ts) may call `endMeeting()` before `stop()` when the meeting explicitly
transitions to Ended. For `audio:stop` (e.g. a pause), `stop()` halts span ingestion
without triggering the final pass.

**Trade-off accepted:** In the current wiring (item 0018), the final pass is not
automatically triggered when the meeting ends via the meeting lifecycle service.
That connection (MeetingLifecycleService.MeetingEnded → runtime.endMeeting()) will be
made in item 0021 when the full meeting persistence and review screen are integrated.
Until then, the final pass is not called from the live runtime automatically.

## Decision 3 — IPC event channel shape

Two new push channels follow the ADR 0013 streaming-event pattern:

- `items:changed` → `{ decisions: Decision[], actions: Action[] }`
  Emitted after every rolling turn or final pass that proposes ≥1 item.
  The renderer accumulates these events to build the full proposed-item list.
  NOT emitted when the provider returns zero items (no noise for empty turns).

- `items:summaries` → `{ summaries: DiscussionSummary[] }`
  Emitted exactly once, after `endMeeting()` / `runFinalPass()` completes.
  Always emitted (even if the array is empty) so the renderer can reliably
  detect that the final pass completed.

Both payloads are typed in `src/shared/ipc.ts` with Zod schemas and exposed in
`RendererApi` as `onItemsChanged(cb)` / `onItemsSummaries(cb)` subscription methods,
consistent with `onTranscriptSpan`.

## Status

Accepted (item 0018).
