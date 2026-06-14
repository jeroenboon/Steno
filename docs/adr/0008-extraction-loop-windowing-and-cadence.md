# ADR 0008 — Extraction loop: cadence, windowing, and pause-flush strategy

**Status:** Accepted
**Date:** 2026-06-14
**Item:** 0008

## Context

The extraction loop fires the `ExtractionProvider` repeatedly during a live meeting. Two questions required a concrete, non-obvious decision:

1. **What spans does each rolling turn send?** The provider is stateless — it only knows what we give it per call. We could send the full transcript every time ("full-window"), send only the spans since the last turn ("incremental"), or something in between.

2. **What constitutes a "pause" for flush purposes?** CONTEXT.md says "pause halts audio and the cadence". The meeting lifecycle models pause as a `paused: boolean` flag on the Meeting; the extraction loop can receive an explicit `notifyPaused()` call. An alternative would be to detect inactivity (a gap since the last span) in the scheduler itself.

## Decisions

### Rolling cadence: time-based, not event-based

A turn fires when **both** conditions hold:

- `cadenceMs` milliseconds have elapsed since the last successful turn (default: 20 s, within the CONTEXT.md "~15–30s" range)
- At least one span has arrived since the last turn

This is checked on `tick()`, which the app calls on each new ASR span or a periodic heartbeat. The scheduler never registers real timers — it reads `Clock.now()` so tests remain deterministic (principle #11).

### Windowing: incremental forward-only index

Each rolling turn sends only the **new spans since the last successful turn**, tracked by `_sentUpTo` — an index into an in-memory buffer of all spans added via `addSpan()`.

Alternatives considered:

| Approach                                    | Pro                                              | Con                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Full-window** (send all spans every turn) | Simpler; provider has full context               | Grows without bound; same content re-sent repeatedly; likely to confuse the provider into re-proposing the same items                |
| **Incremental (chosen)**                    | Bounded per turn; avoids redundant re-extraction | Provider has no prior-turn memory (but it doesn't need it: each proposed item carries `sourceSpanId` which ties it back to its span) |
| **Sliding window** (last N seconds)         | Handles very long meetings                       | Significantly more complex; adds a time-vs-bytes trade-off the domain doesn't need yet                                               |

The provider is called with the set of spans that have not yet been sent. Because the provider is stateless and returns `sourceSpanId` with every proposed item, the item lifecycle service can de-duplicate or revise across turns without the scheduler needing to track prior results.

**Failed turns do not advance `_sentUpTo`**: if the provider errors, the same spans are retried on the next tick. This is conservative — it risks re-proposing items the provider saw before the error, but that is safer than silently dropping spans (principle #13: autosave; prefer over-extraction to under-extraction).

### Final pass reads from the repository

`runFinalPass()` reads ALL spans via `transcriptSpanRepo.listByMeeting()` rather than from the in-memory buffer. This ensures spans persisted before this scheduler instance was attached (e.g. after a crash-and-restart) are included in the final extraction.

Rolling turns use the in-memory buffer only (spans added via `addSpan()` in the current session). The in-memory buffer is the authoritative window for rolling turns; the repository is the authoritative source for the final pass.

### Pause flush: explicit notification, not inactivity detection

The scheduler exposes `notifyPaused()`. The caller (the meeting lifecycle layer) calls this when the meeting transitions to paused. This immediately flushes any pending spans, regardless of elapsed time.

Alternative considered: detect inactivity by measuring time since the last `addSpan()` call. Rejected because:

- It requires a second threshold (pause-gap threshold vs cadence threshold), creating two tunables that interact.
- The lifecycle service already knows about pause; duplicating that logic in the scheduler violates single-responsibility.
- Tests would need to fake two different time thresholds.

The flush also resets the cadence timer so that after resume, a full `cadenceMs` elapses before the next automatic turn.

### Span persistence in addSpan

`addSpan()` persists the span to `transcriptSpanRepo` immediately (principle #13). This co-locates the autosave with span arrival rather than deferring it to extraction time. If the app crashes between turns, no spans are lost — only the extraction proposals are missing, and the final pass (or a re-run) can recover those.

## Consequences

- Each rolling turn's payload is bounded by the number of spans in the current cadence window, not the total transcript length.
- A provider error retries the same span window next turn; in practice this means the provider may see the same spans twice across turns, which is acceptable — the item lifecycle service handles duplicates via the Proposed/Confirmed model.
- The 0009 item must resolve `agendaItemHint` and `ownerHint` from the provider into real domain IDs; until 0009, these hints default to `OffAgenda.id` and `undefined` respectively (the seam is documented in `extractionLoopScheduler.ts`).
- Real-timer integration (driving `tick()` at sub-cadence intervals) is the caller's responsibility; the scheduler itself is fully synchronous except for the async provider call.
