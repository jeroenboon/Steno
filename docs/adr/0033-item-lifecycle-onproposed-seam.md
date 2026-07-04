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

## Update — behavioural half shipped (2026-07-04): main is authoritative for item state

The two deferred follow-ups above are now done, so item 4 is complete.

- **The seam is generalised** from `onProposed(result)` to `onItemsChanged(meetingId)`, fired after _every_ mutating method (`proposeItems`, `confirm`, `dismiss`, `editAndConfirm`, `revise/retractProposed`, `createConfirmed`, `editConfirmed`). Methods that carry only `kind + id` resolve the meeting via the new `decisionRepo/actionRepo.findMeetingId` (dismiss/retract resolve it _before_ the delete). New service tests pin the confirm / dismiss / create cases.
- **Both `ItemLifecycleService` instances** (the runtime's agent path and `index.ts`'s note-taker IPC path) wire the seam to `sendItemsChanged(sender, meetingId, decisions, actions)` — one helper that emits the **full current item set for the meeting (both states)**. So a note-taker confirm/dismiss/edit/create now broadcasts `items:changed` exactly like an agent turn.
- **The `items:changed` payload gains `meetingId`** and now means "the authoritative full set for this meeting", not "the proposed items from this turn".
- **The renderer stops re-deriving transitions.** `appStore` drops `mergeProposedItems` / `confirmItem` / `removeProposedItem` / `addConfirmedItem` for a single `reconcileItems(payload)` that splits the payload by state into the four lanes — the same `splitItemsByState` helper `loadMeeting` uses — applied only when `payload.meetingId` matches the focused `activeMeeting`. One app-level subscription in `App.tsx` covers both Live and Review; `useLiveSession` and the screens no longer subscribe or update optimistically. The transition rule now lives only in main.

**Trade-off:** a note-taker action now round-trips through main (a local IPC, sub-ms) before the UI reflects it, instead of updating optimistically. Accepted for a single source of truth and to kill the two-implementations-in-lockstep smell; the perceived responsiveness of confirm/dismiss is worth a manual check.
