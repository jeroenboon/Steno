# ADR 0035 — The final pass produces the authoritative, deduplicated per-agenda notes

**Status:** accepted (implemented 2026-07-04)  
**Relates to:** ADR 0008 (live extraction runtime), ADR 0009 (owner/agenda hint resolution), ADR 0029 (live agenda inference, Confirmed-only routing), ADR 0034 (shared extraction engine)

## Problem statement

Two defects made the per-agenda meeting notes unusable, and they share a root cause: the final extraction pass was treated as "just another turn" rather than as the authoritative producer of the deliverable.

**1. Discussion Summaries never rendered.** The final pass asks the provider for a `discussionSummaries` array, one per Agenda Item. But the provider only ever sees the agenda as a numbered list with **no domain IDs** (`1. Titel`, `2. Titel`). The DTO nonetheless required a real `agendaItemId`, so the model returned an invented string that matched no Agenda Item. The Review screen and the Markdown export both group by `agendaItemId === group.id`, so every summary silently fell out. The user saw only Decisions and Actions.

Decisions and Actions never had this problem: they carry an `agendaItemHint` (a title-ish string) that `resolveAgendaItem` (ADR 0009) matches against the real agenda, falling back to Off-agenda. Summaries skipped that step.

**2. The same item appeared twice — once under its Agenda Item, once under Off-agenda.** During Live, rolling turns route only to **Confirmed** Agenda Items (ADR 0029); until the note-taker confirms the agent's inferred agenda, everything lands in Off-agenda. On meeting end the final pass re-extracts the **whole** transcript against the now-inferred agenda and proposes a **fresh** set (new UUIDs) that routes correctly onto the Agenda Items. Nothing dedupes, so the meeting ends with the rolling copy under Off-agenda and the final copy under the Agenda Item.

## Decision

Make the final pass the single authoritative producer of the notes.

- **Summaries resolve by hint, like everything else.** The provider DTO field becomes `agendaItemHint` (optional). The scheduler resolves it via `resolveAgendaItem` against the real agenda when persisting each `DiscussionSummary` (unmatched/blank → Off-agenda). The prompt now asks for the exact agenda title, and to omit the hint for anything discussed outside the agenda. The stored domain `DiscussionSummary` keeps its real `agendaItemId` — only the boundary DTO changed.

- **The final pass supersedes still-Proposed rolling items.** New `ItemLifecycleService.retractAllProposed(meetingId)` deletes every still-**Proposed** Decision and Action for the meeting; `runFinalPass` calls it immediately before proposing the final set. **Confirmed** items — the ones the note-taker already curated live — are left untouched. The final pass re-extracts the whole transcript, so its output is at least as complete as the rolling turns it replaces, and it routes onto the correct Agenda Items.

## Trade-offs

- **A rolling proposal the note-taker never confirmed is replaced, not merged.** That is the point (the final-pass version is whole-transcript and correctly routed), and it is what the user chose over fragile content-matching dedup. Confirmed items are always safe.
- **`retractAllProposed` runs on any non-throwing final response, including an empty one.** If the provider degrades to an empty result (ExtractionEngine already retries once before that), the meeting keeps only its Confirmed items and gains nothing. Accepted: Confirmed items survive, and an empty whole-transcript extraction is rare. A provider _throw_ returns before the retract, so the rolling items are preserved on a hard failure.
- **Duplicate summaries for one Agenda Item are still possible** if the model emits two summaries whose hints resolve to the same item; the Review screen shows the first via `find`. Not worth pre-empting now — the prompt asks for one per item.
- **No migration.** The change is at the provider boundary and in runtime behaviour; stored rows are unaffected.

## Update — the agenda itself was doubling too (2026-07-04)

The same "final pass isn't grounded" root cause also duplicated the **agenda**. `_inferContextOnEnd` inferred the agenda over the whole transcript but passed **no** `knownAgendaItems`, so `excludeCoveredAgendaItems` had nothing to exclude and it re-persisted a second copy of everything live agenda inference (ADR 0029) had already proposed. It showed as every agenda item appearing twice in the Review screen. Two compounding reasons it slipped through: production seeds the runtime context with an empty agenda (`LiveSessionController`), so the in-memory `current().agendaItems.length > 0` guard never fired at end; and the guard checked the seed, not the repo.

Fix: `_inferContextOnEnd` now reads the existing agenda + participants from the repo, grounds the inference on them (`knownAgendaItems`), and — because the runtime must not depend on the provider for correctness — also filters the inferred agenda against the known titles itself (`isTitleCovered`, idempotent with the engine's own step) and drops already-present participants by name before persisting. It then enriches the context with **existing + newly inferred** so the final pass routes onto the real items. This realises ADR 0029's stated "the final pass re-infers cleanly" (which the missing grounding had quietly broken).
