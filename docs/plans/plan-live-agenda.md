# Plan: Paste agenda, quick-start, and live agenda inference

Status: ready to build. Owner: Jeroen. Decomposed into atomic TDD steps. Each step
is one `/tdd` red-green-refactor cycle and one `/git-commit` (Conventional Commits),
green against the full Definition of Done gate (build, `npm test`,
`npm run test:native`, zero lint, Prettier — run `format` **last**, after any new
ADR/migration files are added).

Design decisions are recorded in **ADR 0029 "Live agenda inference"** and the
glossary in **CONTEXT.md** (terms Agenda Item, Proposed / Confirmed, Inferred
Agenda / Participants, Discussion were updated during the grilling session). Read
both before starting.

## Goal

Three features on the Voorbereidingen (Draft) flow, sharing one engine
(`inferContext`) that runs at three moments: **paste-time** (Draft), **live** (slow
cadence), and the **final pass** (Ended).

1. **Paste an agenda.** A large text field in Draft: the user pastes an agenda from
   Word/Markdown/anything, the Extraction Provider structures it into the meeting
   title + agenda items + participants, which fill the existing editable Draft
   fields. Pasting is an input method, so the resulting items are **Confirmed**.
2. **Quick-start without preparation.** A "Direct starten" button creates a meeting
   with no title/agenda, using a date/time auto-title; the final pass later replaces
   that placeholder with an inferred title (only while it is still the placeholder).
3. **Live agenda inference.** When a meeting starts thin (agenda spoken at the top,
   or never written down), a slow-cadence scheduler infers new Agenda Items
   mid-meeting and proposes them. `AgendaItem` gains the Proposed/Confirmed
   lifecycle; the note-taker confirms/edits/dismisses them keyboard-first.

## Core insight: reuse `inferContext` and the existing lifecycle

`inferContext` already exists on the `ExtractionProvider` port and already derives
Agenda Items + Participants for imported meetings. We generalise it once (source =
free text or spans, optional grounding) and reuse it everywhere. `AgendaItem` adopts
the same `ItemStateSchema` (`proposed`/`confirmed`) Decisions and Actions already
use, so the mental model and much of the lifecycle machinery carry over.

The hard rules from ADR 0029 that shape every step:

- **Live routing is conservative**: Decisions/Actions route only to **Confirmed**
  agenda items + the Off-agenda bucket. A Proposed agenda item becomes a routing
  target only once the note-taker confirms it.
- **The final pass is complete**: it routes into the full agenda (Confirmed +
  Proposed/inferred) and regroups Off-agenda. It is the authority for the
  definitive grouping; items assigned live are never silently re-bucketed.
- **Live agenda inference is append-only with grounding**: each slow tick passes the
  current agenda as grounding and the provider returns only uncovered topics. The
  agent does **not** revise/retract its own live agenda items.
- **State on creation**: typed/pasted in Draft = `confirmed`; live- and
  import-inferred = `proposed`.
- **Live inference covers Agenda Items only**; participants are inferred at the
  final pass (and via paste/import), never on the live tick.

## Migration numbering

Migrations currently run to `0004_meeting_source.sql`. This plan adds two; use the
next free numbers at build time (the feature branch may land migrations first):
`NNNN_agenda_item_state.sql` and `NNNN_meeting_title_auto_generated.sql`.

---

## Slice 1 — Domain + port foundations (no UI)

Foundational; Slices 2-4 depend on it. Fully unit-testable, no Electron.

### Step 1.1 — `AgendaItem.state` field + migration + repo mapping ✅ done

**Context:** `AgendaItem` is currently `{ id, title, topic }` with no lifecycle.
Adding `state` is the spine of the whole feature. Default `confirmed` so existing
rows and manually typed Draft items are unaffected; the `OffAgenda` sentinel stays
outside the lifecycle.

`/tdd`:

- Red:
  - `src/shared/domain/domain.test.ts`: `AgendaItemSchema.parse` defaults `state` to
    `'confirmed'` when absent, accepts `'proposed'`, rejects other strings; `OffAgenda`
    still parses.
  - `src/main/db/repos/agendaItemRepo.test.ts`: an item inserted with
    `state: 'proposed'` round-trips via the list/find methods.
- Green:
  - `src/shared/domain/types.ts`: add `state: ItemStateSchema.default('confirmed')`
    to `AgendaItemSchema`.
  - New migration `NNNN_agenda_item_state.sql`:
    `ALTER TABLE agenda_items ADD COLUMN state TEXT NOT NULL DEFAULT 'confirmed';`
  - `src/main/db/repos/agendaItemRepo.ts`: map the `state` column in the row type,
    `rowToDomain`, `insert`, `update`.

**Files:** `src/shared/domain/types.ts`, `src/shared/domain/domain.test.ts`,
`src/main/db/migrations/NNNN_agenda_item_state.sql`,
`src/main/db/repos/agendaItemRepo.ts`, `src/main/db/repos/agendaItemRepo.test.ts`.

**DoD note:** new migration file → run `format:check` last.

Commit: `feat(agenda): add Proposed/Confirmed lifecycle state to AgendaItem`

---

### Step 1.2 — Generalise `inferContext` (source + grounding) + `InferredContext.title` ✅ done

> Note: keeping each commit green (DoD is per-commit) meant the breaking port
> change also had to adapt the three real adapters' `inferContext` signatures in
> this step. They now accept `InferContextInput` via a shared `inferSourceToText`
> helper, behaviour-preserving on the spans path; the text/title/grounding
> behaviour and its tests land in Steps 1.3/1.4 as planned.

**Context:** today `inferContext(spans)` returns `{ agendaItems, participants }`. We
generalise the input to a source (text or spans) plus optional grounding, and add an
optional inferred `title`. This is a breaking signature change, so the existing
import caller is updated in the same commit to stay green.

`/tdd`:

- Red:
  - `src/shared/providers/providers.test.ts`: `FakeExtractionProvider.inferContext`
    accepts `{ source: { text } | { spans }, knownAgendaItems? }` and resolves to a
    configurable `InferredContext`; `InferredContextSchema` parses an optional
    `title` and rejects a malformed one.
- Green:
  - `src/shared/providers/dtos.ts`: add `title: z.string().min(1).optional()` to
    `InferredContextSchema`.
  - `src/shared/providers/ExtractionProvider.ts`: change the optional method to
    `inferContext?(input: { source: { text: string } | { spans: TranscriptSpan[] }; knownAgendaItems?: { title: string; topic: string }[] }): Promise<InferredContext>`
    with a doc comment (grounding ⇒ return only uncovered topics; live ignores
    `title`/`participants`).
  - `src/shared/providers/FakeExtractionProvider.ts`: implement the new shape.
  - `src/main/session/ImportSessionController.ts`: update the call site to
    `inferContext({ source: { spans } })`; mark import-inferred agenda items
    `state: 'proposed'` on insert (per ADR 0029). Update
    `ImportSessionController.test.ts` accordingly.

**Files:** `src/shared/providers/dtos.ts`, `ExtractionProvider.ts`,
`FakeExtractionProvider.ts`, `providers.test.ts`,
`src/main/session/ImportSessionController.ts` + `.test.ts`.

Commit: `feat(extraction): generalise inferContext to text or spans with grounding and title`

---

### Step 1.3 — Anthropic `inferContext`: text source, title, grounding ✅ done

> Note: the normalised-title compare grounding needs (and Step 4.1's dedup will
> reuse) was extracted to `src/shared/agenda/agendaTitle.ts`
> (`normaliseAgendaTitle`, `isTitleCovered`) so both paths share one source of
> truth. The adapter both prompts for "only new topics" and post-filters the
> result, so append-only holds even if the model repeats a known topic.

**Context:** the real adapter must honour all three call shapes. When given
`knownAgendaItems`, the prompt instructs the model to return only topics not already
covered (append-only grounding). When inferring from whole text/transcript, it may
return a `title`.

`/tdd`:

- Red: `src/main/providers/AnthropicExtractionProvider.test.ts` (mock HTTP):
  inferring from `{ text }` returns parsed `InferredContext` incl. `title`; with
  `knownAgendaItems` the prompt carries them and a response repeating a known topic
  is excluded (assert via the request body / parsed result); the existing
  one-retry-repair still applies; a still-bad second response degrades to empty
  arrays (never throws).
- Green: implement the generalised `inferContext` reusing the JSON-with-one-retry
  helper and the final-pass model; prompt in `primaryLanguage`; never log content.

**Files:** `src/main/providers/AnthropicExtractionProvider.ts` + `.test.ts`.

Commit: `feat(extraction): support text source, title and grounding in Anthropic inferContext`

---

### Step 1.4 — OpenAI-compatible + Azure `inferContext`: parity ✅ done

> Note: behaviour lives in the shared `ChatExtractionEngine`, so OpenAI, Mistral
> and Azure get parity at once. The grounding filter was promoted to the shared
> `excludeCoveredAgendaItems` (in `agendaTitle.ts`) and the Anthropic adapter was
> refactored onto it too, so all three adapters enforce append-only identically.
> **Slice 1 complete.**

**Context:** same generalisation for the OpenAI-compatible family and Azure OpenAI
(Azure extends the OpenAI-compatible path).

`/tdd`:

- Red: `OpenAICompatibleExtractionProvider.test.ts` and
  `AzureOpenAIExtractionProvider.test.ts` (mock HTTP): the same cases as Step 1.3.
- Green: mirror Step 1.3 against the `chat/completions` shape; share the prompt
  builder via the existing `openaiChatExtraction` helper where possible.

**Files:** `src/main/providers/OpenAICompatibleExtractionProvider.ts`,
`AzureOpenAIExtractionProvider.ts`, `openaiChatExtraction.ts`, + their tests.

Commit: `feat(extraction): support text source, title and grounding in OpenAI-compatible and Azure inferContext`

---

## Slice 2 — Paste an agenda (Draft UI + IPC)

Depends on Slice 1 (generalised `inferContext` with a text source). Smallest
user-facing win.

### Step 2.1 — `context:inferFromText` IPC contract ✅ done

> Note: the `inferContextFromText` method on `RendererApi` was deferred to Step
> 2.3, where the preload implements it — adding it here would break the preload's
> typecheck (per-commit DoD). This step lands the request/response schemas and
> the `IpcChannel` union member only.

`/tdd`:

- Red: `src/shared/ipc.test.ts`: the new request/response schemas parse valid
  payloads and reject invalid ones; `IpcChannel` includes the new name.
- Green: `src/shared/ipc.ts`: add invoke channel `context:inferFromText`, request
  `{ text: string, primaryLanguage: string }`, response = `InferredContextSchema`;
  add to the `IpcChannel` union; add `inferContextFromText` to `RendererApi`.

**Files:** `src/shared/ipc.ts`, `src/shared/ipc.test.ts`.

Commit: `feat(draft): add context:inferFromText IPC channel`

---

### Step 2.2 — Wire the handler in main + ipc-registry ✅ done

> Note: kept the registry pure — the handler dispatches to an injected
> `inferContextFromText` dependency (the established pattern, like `onImportStart`
> / `summaryQuery`) rather than importing the provider factory. The real
> `tryBuildExtractionProvider` wiring lives in `main/index.ts`, rebuilt per call
> so a key set in Settings takes effect without restart. Absent dep ⇒ empty
> context.

`/tdd`:

- Red: `src/main/ipc-registry.test.ts`: `context:inferFromText` dispatches to the
  injected handler; the `IPC_CHANNELS` array stays in sync with `IpcChannel`.
- Green:
  - `src/main/ipc-registry.ts`: handler builds the extraction provider
    (`tryBuildExtractionProvider`), calls `inferContext({ source: { text } })`, and
    returns the result. No extraction provider configured ⇒ return an empty
    `InferredContext` (graceful degrade; the UI keeps manual entry working).
  - `src/main/index.ts`: add the channel to `IPC_CHANNELS`.

**Files:** `src/main/ipc-registry.ts`, `src/main/index.ts`,
`src/main/ipc-registry.test.ts`.

Commit: `feat(draft): wire context:inferFromText handler into main`

---

### Step 2.3 — Preload bridge for `inferContextFromText` ✅ done

> Note: there was no preload test before; added `src/preload/index.test.ts`
> (mocks `electron`, captures the exposed api, asserts the forward). The
> `RendererApi.inferContextFromText` method (deferred from Step 2.1) lands here
> together with its preload implementation.

`/tdd`:

- Red: preload/bridge test (follow the `audioSendFrame`/`onTranscriptSpan` pattern):
  `inferContextFromText` is exposed and forwards to the right channel.
- Green: implement in `src/preload/`; ensure `RendererApi` typing is satisfied.

**Files:** `src/preload/*`, `src/renderer/src/env.d.ts` (if applicable).

Commit: `feat(draft): expose inferContextFromText over the preload bridge`

---

### Step 2.4 — DraftScreen paste field + "Uitlezen" fill ✅ done **Slice 2 complete.**

> Note: inferred items get client-side ids (the manual flow's ids are throwaway
> `temp`-meeting ids anyway) and fill the existing editable lists, so they behave
> exactly like manually added Confirmed items. Empty result ⇒ a gentle hint and
> manual entry stays usable. Tightened the pre-existing render test's agenda
> heading matcher to `/agenda items/i` since "Agenda plakken" is a second heading.

**Context:** add a large textarea + "Uitlezen" button at the top of `DraftScreen`.
On click it calls `inferContextFromText` and fills the existing local-state title,
agenda, and participant lists (which remain editable, exactly the current add/remove
flow). Items land as the normal Confirmed Draft items. Degrade: button disabled on
empty text; if the result is empty (no extraction key), keep manual entry and show a
gentle hint.

`/tdd`:

- Red: `src/renderer/src/__tests__/DraftScreen.test.tsx` with a mocked `window.api`:
  textarea + "Uitlezen" render; clicking with text calls `inferContextFromText`;
  returned title fills the title input, agenda items and participants populate their
  lists and stay editable/removable; empty/whitespace text keeps the button
  disabled; a loading state shows while the call is in flight.
- Green: add the textarea + button + fill logic in `DraftScreen.tsx`; add i18n
  strings (Dutch default) in `src/renderer/src/i18n`.

**Files:** `src/renderer/src/screens/DraftScreen.tsx`, `src/renderer/src/i18n/index.ts`,
`src/renderer/src/__tests__/DraftScreen.test.tsx`.

Commit: `feat(draft): paste an agenda and auto-fill the Draft fields`

---

## Slice 3 — Quick-start + final-pass safety net (live)

Depends on Slice 1 (state + generalised `inferContext`). Lets a meeting start with
no prep and still produce a structured, agenda-grouped result.

### Step 3.1 — `Meeting.titleAutoGenerated` field + migration ✅ done

> Note: migration is `0006_meeting_title_auto_generated.sql`. Adding the required
> field rippled through every `Meeting` literal (2 production sites in
> ipc-registry + the session controllers, and ~10 test fixtures) — all set to
> `false` (existing/user-set titles are never auto-generated); the quick-start
> path that sets it `true` lands in Step 3.2.

**Context:** a flag so the final pass can replace a placeholder title without ever
overwriting a user-set one. Default `false`; the quick-start path sets `true`; any
user edit of the title flips it to `false`; the final pass reads it, replaces the
title, then clears it.

`/tdd`:

- Red: `src/shared/domain/domain.test.ts`: `MeetingSchema` defaults
  `titleAutoGenerated` to `false`, accepts `true`. `meetingRepo.test.ts`: round-trip.
- Green: add `titleAutoGenerated: z.boolean().default(false)` to `MeetingSchema`;
  migration `NNNN_meeting_title_auto_generated.sql`
  (`ALTER TABLE meetings ADD COLUMN title_auto_generated INTEGER NOT NULL DEFAULT 0;`);
  map it in `meetingRepo`.

**Files:** `src/shared/domain/types.ts` + test, migration,
`src/main/db/repos/meetingRepo.ts` + test.

Commit: `feat(meeting): add titleAutoGenerated flag for quick-start auto-titles`

---

### Step 3.2 — "Direct starten" quick-start in Draft ✅ done

> Note: "Direct starten" is always enabled. A typed title is used as-is
> (`titleAutoGenerated: false`); an empty title gets a `buildAutoTitle()`
> placeholder (`titleAutoGenerated: true`). Anchored the pre-existing Start-button
> test matchers to `/^starten$/i` since "Direct starten" also contains "starten".
> Persisting the flag to the live meeting row is deferred to Step 3.3 (the live
> row is created by LiveSessionController, not meeting:create — a pre-existing
> "Active Meeting" title gap noted there).

**Context:** a second button that creates and starts a meeting with no title/agenda.
The renderer builds a locale date/time auto-title (e.g. `"Vergadering 24 jun 2026
14:30"`, no em-dash) and passes `titleAutoGenerated: true`. The existing `isValid`
title gate does not apply to this path.

`/tdd`:

- Red: `DraftScreen.test.tsx`: "Direct starten" is always enabled; clicking it calls
  `meetingCreate` with a non-empty auto-title and `titleAutoGenerated: true`, then
  `meetingStart`, then navigates to `live`. Editing the title field before quick-start
  is reflected (and would carry `titleAutoGenerated: false`).
- Green:
  - `src/shared/ipc.ts`: `meetingCreate` request gains optional
    `titleAutoGenerated?: boolean` (default false); thread it through the repo insert.
  - `DraftScreen.tsx`: add the button + auto-title builder; i18n strings.

**Files:** `src/shared/ipc.ts` (+ test), `src/main/ipc-registry.ts` /
`meetingRepo.ts` as needed, `DraftScreen.tsx`, `i18n`, `DraftScreen.test.tsx`.

Commit: `feat(draft): add Direct starten quick-start with auto-title`

---

### Step 3.3 — Final pass infers context + replaces auto-title for live meetings

**Context:** when a live meeting reaches Ended with a thin/empty Confirmed agenda,
the final pass should infer the agenda + participants over all spans (mirroring
import) and, when `titleAutoGenerated` is set, derive and apply a title and clear the
flag. Inferred agenda items are persisted as `proposed`. The final pass already
routes Decisions/Actions to the full agenda (no Confirmed-only filter — that filter
is live-only, added in Slice 4), so the inferred spine is immediately usable.

`/tdd`:

- Red: `src/main/services/liveExtractionRuntime.test.ts` (fakes + injected Clock):
  on meeting end with no Confirmed agenda and `inferContext` available, inferred
  agenda items (state `proposed`) and participants are persisted; when
  `titleAutoGenerated` is true the inferred title is written and the flag cleared;
  when the user already set a title the flag is false and the title is untouched;
  the final pass groups items under the inferred agenda.
- Green: extend the final-pass orchestration (`LiveExtractionRuntime` end path /
  `MeetingEnded` handler) to call `inferContext({ source: { spans } })` before the
  final extraction when the agenda is thin, persist results as Proposed, and apply
  the title rule via `meetingRepo`.

**Files:** `src/main/services/liveExtractionRuntime.ts` + `.test.ts`,
`src/main/db/repos/meetingRepo.ts` (title update), possibly
`meetingLifecycleService.ts`.

Commit: `feat(live): infer agenda, participants and title on the final pass for un-prepared meetings`

---

## Slice 4 — Live agenda inference (the big one)

Depends on Slice 1. Implements ADR 0029's live behaviour. Build last.

### Step 4.1 — Agenda proposal service (propose Proposed items + dedup)

**Context:** a small service that inserts agent-proposed Agenda Items as `proposed`,
skipping near-duplicates of existing agenda items via a normalised-title compare
(case/whitespace-insensitive). It never touches Confirmed items and never
revises/retracts its own (append-only, per ADR 0029).

`/tdd`:

- Red: new `src/main/services/agendaProposalService.test.ts` with an in-memory
  `agendaItemRepo`: proposing two topics inserts two `proposed` items; proposing a
  topic whose normalised title matches an existing Confirmed or Proposed item is a
  no-op; the `OffAgenda` sentinel is ignored.
- Green: `src/main/services/agendaProposalService.ts`.

**Files:** `src/main/services/agendaProposalService.ts` + `.test.ts`.

Commit: `feat(live): add agenda proposal service with normalised-title dedup`

---

### Step 4.2 — Slow-cadence agenda scheduler

**Context:** a scheduler analogous to `ExtractionLoopScheduler` but on a slower
interval, driven by the injected `Clock` (deterministic, no real timers). On each
tick it calls `inferContext({ source: { spans }, knownAgendaItems })` with the
current agenda as grounding and feeds the result to the proposal service.

`/tdd`:

- Red: `src/main/services/agendaInferenceScheduler.test.ts` (fake Clock + fake
  provider): a tick fires only at/after the slow boundary; it passes the current
  agenda as `knownAgendaItems`; returned topics reach the proposal service; pause
  halts ticks and resume continues.
- Green: `src/main/services/agendaInferenceScheduler.ts`, mirroring the cadence
  shape of `extractionLoopScheduler.ts`. Interval is a constructor parameter
  (tunable; document the default).

**Files:** `src/main/services/agendaInferenceScheduler.ts` + `.test.ts`.

Commit: `feat(live): add slow-cadence agenda inference scheduler`

---

### Step 4.3 — Live routing filter: Confirmed agenda + Off-agenda only

**Context:** during Live, Decisions/Actions may only be routed to **Confirmed**
agenda items (plus Off-agenda). The owner/agenda assignment must therefore see only
Confirmed items as candidate buckets on the live path; Proposed items are not yet
buckets. The final pass keeps routing to all agenda items (do not change that path).

`/tdd`:

- Red: in the assignment tests (`src/shared/assignment/*.test.ts`) and/or
  `liveExtractionRuntime.test.ts`: given a mix of Confirmed and Proposed agenda
  items, live extraction routes a Decision/Action only into a Confirmed item or
  Off-agenda, never a Proposed one.
- Green: pass only `state === 'confirmed'` agenda items as live routing candidates
  where the runtime builds the extraction context / assignment input. Leave the
  final-pass context (all items) unchanged.

**Files:** `src/main/services/liveExtractionRuntime.ts`, `src/shared/assignment/*`,

- tests.

Commit: `feat(live): route live Decisions/Actions only to Confirmed agenda items`

---

### Step 4.4 — Wire the agenda scheduler into LiveExtractionRuntime

**Context:** start/stop the slow agenda scheduler alongside the extraction scheduler;
honour pause/resume; ensure it reads accumulating final spans. No second source of
truth — it shares the runtime's span store.

`/tdd`:

- Red: `liveExtractionRuntime.test.ts`: starting a live session arms the agenda
  scheduler; final spans accumulate and a slow tick proposes agenda items that get
  persisted as Proposed; pause halts it; meeting end stops it cleanly before the
  final pass runs.
- Green: construct and drive `agendaInferenceScheduler` from
  `liveExtractionRuntime.ts`.

**Files:** `src/main/services/liveExtractionRuntime.ts` + `.test.ts`.

Commit: `feat(live): drive the agenda inference scheduler from the live runtime`

---

### Step 4.5 — Push Proposed agenda items to the renderer + LiveScreen UI

**Context:** the note-taker needs to see Proposed agenda items and confirm/edit/
dismiss them, keyboard-first. Reuse the `InterceptingItemLifecycleService` pattern
(the runtime extends a concrete service to fire a callback) to emit agenda changes.
Decision left to build time: extend the existing `items:changed` event vs add a
dedicated `agenda:changed` event — pick the smaller diff and note it in the commit.

`/tdd`:

- Red:
  - IPC: schema test for the agenda change event payload.
  - `src/renderer/src/__tests__/LiveScreen.test.tsx`: Proposed agenda items render
    distinctly from Confirmed ones with confirm / edit / dismiss controls, each
    reachable by keyboard; confirming calls the agenda-confirm IPC; dismissing
    removes it.
- Green:
  - `src/shared/ipc.ts`: the agenda change push event + agenda confirm/edit/dismiss
    invoke channels (reuse the item-confirm shape where possible); preload bridge.
  - `src/main`: emit on agenda changes; handle confirm/edit/dismiss via the agenda
    repo (Confirmed agenda items become live routing buckets immediately for
    subsequent extraction).
  - `LiveScreen.tsx` + i18n: render and wire the controls.

**Files:** `src/shared/ipc.ts` (+ test), `src/preload/*`,
`src/main/ipc-registry.ts` / `index.ts`, `src/main/services/liveExtractionRuntime.ts`,
`src/renderer/src/screens/LiveScreen.tsx`, `i18n`, `LiveScreen.test.tsx`.

Commit: `feat(live): surface and groom Proposed agenda items in the Live screen`

---

### Step 4.6 — Reflect

**Context:** close the docs loop (principle #4).

- Re-read `CONTEXT.md` for term drift against what shipped (Agenda Item,
  Proposed/Confirmed, Inferred Agenda/Participants, Discussion).
- Confirm ADR 0029 matches the implementation (cadence default, event choice from
  Step 4.5, routing asymmetry). Amend if anything diverged.

Commit: `docs(live): reflect live agenda inference in CONTEXT and ADR 0029`

---

## Cross-cutting notes

- **Append-only, never self-revise.** The live agenda scheduler only ever adds
  Proposed items (deduped). It never edits or retracts its own. Rough guesses linger
  until the note-taker acts or the final pass re-infers. Do not add a reconciling
  matcher in V1 (ADR 0029, rejected option).
- **Routing asymmetry is the trap.** Live = Confirmed + Off-agenda only. Final pass =
  all agenda items. Keep these two paths distinct; a single shared "agenda context"
  helper must take the state filter as a parameter, not bake one in.
- **Privacy/egress.** Paste, live inference, and the final pass all use the already
  configured extraction provider; the existing `EgressIndicator` and disclosure copy
  cover them. Never log pasted text or transcript content (principles #11/#12).
- **Degraded paths.** No extraction provider ⇒ paste returns empty (manual entry
  still works), the live agenda scheduler is a no-op, and the final pass skips
  inference — none of these crash or block transcription.
- **Determinism.** Both schedulers run off the injected `Clock`; no real timers in
  tests. Reuse the `FakeExtractionProvider` and in-memory repos.

## Definition of Done (every step)

build succeeds, `npm test` passes, `npm run test:native` passes, zero lint errors,
Prettier has run (`format` last, after any new ADR/migration files are added). One
coherent commit per step via the `/git-commit` skill.
