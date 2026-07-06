# ADR 0039 — Shared `ExtractionSession` core composed by both session controllers

**Status:** accepted (implemented 2026-07-06)  
**Relates to:** ADR 0008/0015 (live extraction runtime), ADR 0033 (item-lifecycle onProposed seam), ADR 0035 (final pass authoritative notes), ADR 0029 (live agenda inference); closes the remainder of the 2026-07 architecture review's item 5.

## Problem statement

`LiveExtractionRuntime` owned the whole extraction lifecycle for a live meeting **and** doubled as the import path's final-pass engine. `ImportSessionController._runFinalPass` built the entire ~560-line live runtime just to call `endMeeting()`, then relied on the runtime's guards to skip every live-only concern it didn't want: the rolling cadence, the slow agenda-inference scheduler, the running summary, the ASR-terminal reset, the `MeetingContextOwner`. The import path was paying for — and dead-coding around — machinery it never used, and the runtime carried a scatter of `agendaItemRepo?` / `source !== 'live'` / `meetingStartedAt?` optionals whose only job was to make that reuse type-check.

Two paths genuinely share one thing: the final extraction pass and the events it produces. Everything else differs.

## Decision

Extract a shared **`ExtractionSession`** core that both session controllers compose.

**The core owns** the parts both paths share: the `ExtractionLoopScheduler` and the `ItemLifecycleService` (with its `onItemsChanged` seam, ADR 0033), plus the emit-plumbing — `items:changed` (via `sendItemsChanged`), `items:summaries` after the final pass, and `nudges:changed` after every item mutation and the final pass. It exposes `addSpan`, `tick(context)`, and `runFinalPass(meeting, context)`.

**`LiveExtractionRuntime` keeps the live-only layer** and composes the core: span filtering, the `MeetingContextOwner`, the agenda-inference scheduler, the running summary, ASR-terminal forwarding, pause/resume, and the end-of-meeting inference. **`ImportSessionController` composes the core directly** — no runtime — after doing its own inference.

Three deliberate boundary choices:

- **Inference stays forked, not unified.** The live path (`_inferContextOnEnd`) only infers when the agenda is empty, grounds on the repo agenda to avoid the "agenda 2x" bug, filters covered titles, enriches the in-memory context so the final pass routes correctly, and rewrites an auto-generated title. The import path (`_inferAndPersistContext`) is unconditional, persists straight to the repo, and does neither enrich nor title work. These are genuinely different flows; merging them would trade a small dedup for real coupling and risk. The core takes no part in inference.

- **The core reads context through a `getContext()` getter, not by owning it.** Live owns context in a `MeetingContextOwner` that is enriched mid-`endMeeting`; import holds a static snapshot. Rather than own either shape, the core calls back for the current context at emit time — live passes `() => contextOwner.current()`, import a closure over its snapshot. So nudges and the final pass always see the caller's latest context without the core knowing how it's stored.

- **`agenda:changed` on meeting end is gated on an optional `agendaItemRepo`.** Live pushes the authoritative agenda so Review can group the routed final items; import omits it and leans on `meeting:load`. This is a real per-path difference, so the optionality lives in the core, and the (now live-only) runtime makes its own repos required.

## Trade-offs

- **Two inference implementations remain.** Accepted per above: they differ in conditions, persistence, enrich, and title handling. The shared rule (inferred agenda items are Proposed) already lives in `persistInferredContext`; that is the right level of sharing.
- **The core reaches for context via a callback rather than a value.** Slightly less obvious than a plain parameter, but it is what lets one core serve a mutating live context and a static import snapshot without branching. Documented at the seam.
- **Nudge emission stays in the core**, so the import path keeps emitting `nudges:changed` once at its final pass exactly as before — behaviour-preserving, at the cost of the core knowing about nudges. Moving it to the live layer would have silently dropped import's nudges.
- **No behaviour change and no migration.** This is a structural refactor; the live and import paths behave identically. The only visible difference is the degraded "no extraction provider" log now attributed to `ImportSessionController` instead of the runtime it no longer builds.
