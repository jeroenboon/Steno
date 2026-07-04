# ADR 0033 — `ItemLifecycleService.onProposed` seam replaces the intercepting subclass

**Status:** accepted (implemented 2026-07-04)  
**Relates to:** ADR 0008 (live extraction runtime), ADR 0013 (IPC streaming events), ADR 0029 (`AgendaInferenceScheduler` onProposed idiom); 2026-07 architecture review item 4

## Problem statement

`LiveExtractionRuntime` needs to emit the `items:changed` IPC event whenever the extraction scheduler proposes items. But the scheduler calls `ItemLifecycleService.proposeItems()` deep inside a turn, and `ItemLifecycleService` exposed **no notify hook**. Because it is a concrete class with private members, composition could not reach in, so the runtime **subclassed** it as `InterceptingItemLifecycleService` purely to override `proposeItems` and fire a callback.

The 2026-07 architecture review (item 4) flagged this as a missing seam: the subclass is a workaround for the absent hook, and the class docstring even had to explain "extends (not wraps) because … `implements` cannot satisfy those." Meanwhile `AgendaInferenceScheduler` already had the right shape — an injected `onProposed` callback — for exactly the same need.

## Decision

Add an optional `onProposed?: (result: ProposeItemsResult) => void` constructor parameter to `ItemLifecycleService`. `proposeItems` fires it after persistence when the turn produced at least one item (same condition the subclass used). Delete `InterceptingItemLifecycleService`; the runtime now builds a plain `ItemLifecycleService(decisionsRepo, actionsRepo, callback)` and passes that one instance to the scheduler.

This puts the seam where the behaviour lives, matching the `AgendaInferenceScheduler` idiom, and removes a subclass that only existed to bolt a callback onto a concrete class.

## Trade-offs

- **Behaviour is unchanged.** The callback fires in exactly the same case (a non-empty proposal), so every existing runtime and service test passes untouched; three new service tests pin the seam (fires with the result on a non-empty proposal, silent on an empty one, works when no callback is supplied).
- **Scope is deliberately the structural half of review item 4.** The review also notes that `index.ts` builds a _second_ plain `ItemLifecycleService` for the note-taker IPC path, so the seam fires for agent proposals but not for IPC confirms. Now that the hook exists on the base class, wiring that second instance to fire on confirm is a follow-up — it is a behaviour change to when `items:changed` emits and wants manual UI validation, so it is intentionally left out of this refactor.
- **The renderer still re-derives Proposed → Confirmed optimistically** (`appStore.ts`); unifying that with one shared rule is the remaining part of review item 4, also deferred.
