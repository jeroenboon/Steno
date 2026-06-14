# LiveTranscriber Backlog

Sequential build plan. Each item is atomic, test-driven, and self-contained enough to hand to a subagent cold. Read [CONTEXT.md](CONTEXT.md) and [docs/adr/](docs/adr/) before starting any item.

---

## Engineering principles (rules of engagement)

These apply to **every** backlog item. They are the standard, not suggestions.

**Given (from the brief):**

1. **TDD always.** Use the `/tdd` skill. Red → green → refactor. No production code without a failing test first, except pure scaffolding/config where there is nothing to assert (then add a smoke test).
2. **Strictly atomic changes.** One item = one coherent change = one commit. Don't smuggle unrelated edits in.
3. **Definition of Done gate (all four):** build succeeds, all tests pass, zero lint errors, Prettier has run. An item is not done until the gate is green.
4. **Commit per item** with the `/git-commit` skill (Conventional Commits).
5. **Reflect after each item.** Inspect the core choices you made. Decide whether [CONTEXT.md](CONTEXT.md) needs new/changed terms and whether a decision was hard-to-reverse + surprising + a real trade-off (then add an ADR). Record it in the same commit.

**Added (recommended, and why):** 6. **Ports & Adapters.** The domain core imports zero vendor SDKs. `ASRProvider` and `ExtractionProvider` are interfaces; Deepgram/Anthropic/etc. live behind them as adapters. _Why:_ the whole product rests on swapping providers (local vs cloud ASR, cloud LLM). If a vendor type leaks into the core, that promise breaks. → ADR. 7. **Strict TypeScript.** `strict: true`, `noUncheckedIndexedAccess`, `noImplicitOverride`, no `any` (lint-enforced). _Why:_ this app is full of nullable provider output and state machines; the compiler should catch the foot-guns. 8. **Validate at every boundary with Zod.** LLM JSON, IPC payloads, settings on disk, provider responses are parsed through Zod schemas before entering the domain. _Why:_ LLM output is untrusted text; never `JSON.parse` it straight into a typed object and hope. 9. **Electron security baseline is non-negotiable.** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, all main↔renderer traffic through a typed preload bridge, strict CSP. _Why:_ this app handles meeting audio and API keys; a compromised renderer must not reach Node or secrets. → ADR. 10. **Process discipline.** Renderer is UI only. All I/O, the DB, secrets, and every provider call live in the main process. _Why:_ keeps secrets out of the renderer and makes the heavy work testable in Node without a browser. → ADR (folded into #9's ADR). 11. **Deterministic tests.** Inject the clock (no real timers) and use fake providers (no network) in unit tests. Adapter tests mock HTTP. _Why:_ the rolling cadence and state machines are timing-driven; flaky time-based tests are worse than none. 12. **Privacy is provider-dependent; consent and transparency are the real invariants.** What leaves the device depends on the chosen providers, and the user must always know which: - **Local Parakeet ASR:** audio never leaves the device. - **Cloud ASR (Deepgram etc.):** the audio stream _does_ leave the device, going only to the configured ASR provider. - **Cloud extraction (the V1 default):** transcript text _does_ leave the device, going only to the configured LLM provider. - **Always true regardless of providers:** data is sent _only_ to the provider the user explicitly configured and to nowhere else; transcript content and API keys are never logged or persisted outside their intended store; the app makes the current data-egress situation visible (e.g. an indicator: "audio local, notes via Anthropic"); and the most-private viable option is the default where there's a choice.
_Why:_ a blanket "nothing leaves the device" promise is false with cloud providers and would erode trust the moment someone inspects network traffic. The honest, enforceable promise is no surprise egress and no logging of content/secrets. 13. **Data safety.** Autosave to SQLite every extraction turn; a crash mid-meeting loses at most the last turn. DB migrations are versioned and forward-only from item 1 of persistence. _Why:_ losing a live meeting is the unforgivable failure. 14. **CI mirrors the DoD gate.** A pipeline runs build + lint + format-check + test on every push, identical to the local gate. _Why:_ the gate only protects you if it can't be skipped. 15. **Dependency hygiene.** Commit the lockfile, pin versions, keep deps minimal. 16. **i18n + keyboard-first.** UI strings externalized, Dutch default. The live note-taker works at speed: every confirm/dismiss/edit has a keyboard path. _Why:_ "monitor on the fly" only works if approving is faster than the meeting.

---

## Per-item workflow (do this for every item)

1. Read [CONTEXT.md](CONTEXT.md) + relevant ADRs.
2. `/tdd` — write the failing test(s) for the item's acceptance criteria.
3. Implement the minimum to pass. Refactor.
4. Run the DoD gate: `npm run build && npm test && npm run lint && npm run format`. All green.
5. Reflect: update [CONTEXT.md](CONTEXT.md) and/or add an ADR if warranted (principle #5).
6. `/git-commit`.

---

## Phase 0 — Foundation

### 0001 — Project scaffolding, linter, formatter, test harness, CI

**Depends on:** nothing. **This is the first item.**

**Goal:** A buildable, lintable, formatted, testable empty Electron + TS + React app with the DoD gate wired and a CI pipeline that runs it.

**What & how:**

- `git init` (the repo is not yet under version control).
- Scaffold with **electron-vite** (Vite-based, TS + React template). Structure: `src/main/`, `src/preload/`, `src/renderer/`, `src/shared/` (domain code shared by main + tests).
- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `exactOptionalPropertyTypes: true`. Path alias `@shared/*`.
- **ESLint** (flat config): `@typescript-eslint` with type-checked rules, `eslint-plugin-react`, `eslint-plugin-react-hooks`, import ordering. Ban `any` (`@typescript-eslint/no-explicit-any: error`).
- **Prettier:** no semicolons-or-whatever, just pick a config and commit it; wire `eslint-config-prettier` so they don't fight.
- **Vitest** for unit tests + `@testing-library/react` + jsdom for component tests later.
- **Scripts:** `build`, `test`, `test:watch`, `lint`, `format` (writes), `format:check`, `typecheck`.
- **CI:** GitHub Actions workflow running `typecheck + lint + format:check + test + build` on push/PR (Windows runner, since this is a Windows app).
- Add `.gitignore`, `.editorconfig`, `README.md` stub.

**TDD note:** Scaffolding has little to assert. Add one trivial pure function in `src/shared/` (e.g. a version/string util) with a passing Vitest test, to prove the harness runs. The "red" here is "test command exists and fails on a wrong assertion, then passes."

**DoD:** `npm run build` produces an app that launches to a blank window; `npm test` runs the smoke test green; `lint`, `format:check`, `typecheck` all clean; CI workflow committed.

**Reflect:** Record the stack choices. Likely ADR: "Build tooling = electron-vite + Vitest" only if you consider it lock-in worth noting (probably yes, light ADR).

---

### 0002 — Electron security baseline + typed IPC bridge

**Depends on:** 0001.

**Goal:** Locked-down Electron config and a typed, minimal main↔renderer IPC channel.

**What & how:**

- `BrowserWindow` `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `preload` pointing at the compiled preload.
- Strict **CSP** on the renderer (no remote code; `default-src 'self'`).
- Preload exposes a single typed API object via `contextBridge.exposeInMainWorld`. Define the IPC contract as a TS type in `src/shared/ipc.ts`: channel names, request and response types. No raw `ipcRenderer` in the renderer.
- A tiny typed `invoke` wrapper with Zod validation of payloads on the main side.
- First channel: `ping` → `pong`, used to prove the bridge.

**TDD note:** Unit-test the IPC payload Zod schemas (valid/invalid). Unit-test a pure `createIpcHandler` registry (handlers map, unknown channel rejected). The Electron wiring itself is asserted by a config test: import the window-options factory and assert the security flags are set (factor `webPreferences` into a pure function so it's testable without launching Electron).

**DoD:** gate green; renderer can call `window.api.ping()` and get `pong`; config test asserts all four security flags.

**Reflect:** **Add ADR** for the Electron security + process-discipline model (principles #9/#10). Hard to reverse, surprising to a newcomer, real trade-off (renderer can't touch Node).

---

### 0003 — Domain model: types & enums

**Depends on:** 0001.

**Goal:** Pure TypeScript domain types in `src/shared/domain/`, no behavior yet, matching [CONTEXT.md](CONTEXT.md) exactly.

**What & how:** Define `Meeting`, `MeetingState` (`'draft' | 'live' | 'ended'`), `AgendaItem` (+ the special off-agenda sentinel), `Participant`, `Decision`, `Action`, `ItemState` (`'proposed' | 'confirmed'`), `ActionStatus` (`'open' | 'done'`), `TranscriptSpan`, `DiscussionSummary`, `RunningSummary`, `Nudge`, IDs as branded types (`MeetingId`, etc.). Each entity carries the fields CONTEXT specifies (Action → owner, dueDate, status, agendaItemId, sourceSpan; Decision → rationale, agendaItemId, sourceSpan; etc.). Provide Zod schemas alongside each type (single source of truth: derive TS types from Zod via `z.infer`).

**TDD note:** Test the Zod schemas: a valid Action parses; an Action with a confirmed state but no owner is still valid (owner optional until confirmed — confirm the rule with CONTEXT); off-agenda sentinel resolves. Test branded-ID constructors reject empties.

**DoD:** gate green; types compile and are exported from `@shared/domain`.

**Reflect:** If modeling forces a vocabulary decision (e.g. what exactly the off-agenda sentinel is called), update [CONTEXT.md](CONTEXT.md).

---

### 0004 — Persistence: SQLite schema + migration runner + repositories

**Depends on:** 0003.

**Goal:** Durable local storage with versioned migrations and typed repository functions.

**What & how:**

- `better-sqlite3` in the main process. DB file in `app.getPath('userData')`; tests use a temp-file or `:memory:` DB.
- A forward-only **migration runner**: numbered SQL migrations in `src/main/db/migrations/`, a `schema_migrations` table, applied on startup in a transaction.
- Migration 0001 creates tables for meetings, agenda_items, participants, decisions, actions, transcript_spans, discussion_summaries. Design columns so cross-meeting queries are possible (owner, due_date, status as real columns) per the "(B)-ready" decision.
- Repository modules (`meetingRepo`, `actionRepo`, …) with typed CRUD + the queries we know we need (e.g. `listActionsByMeeting`, and a `listOpenActionsByOwner` even though no UI uses it yet — it proves the schema supports Phase 3).
- Map rows ↔ domain types through the Zod schemas from 0003.

**TDD note:** Repository tests against a temp DB: insert/read round-trips; migration runner is idempotent (running twice is a no-op); foreign-key cascade on meeting delete; `listOpenActionsByOwner` returns across meetings.

**DoD:** gate green; migrations apply cleanly; repos tested.

**Reflect:** **Likely ADR:** "SQLite + hand-rolled forward-only migrations" (rejecting an ORM) if you want to stop someone adding Prisma later.

---

### 0005 — Provider ports + fakes

**Depends on:** 0003.

**Goal:** The two provider interfaces and in-memory fakes used by all later tests.

**What & how:**

- In `src/shared/providers/`: `ASRProvider` interface (streaming: feed audio chunks, emit transcript spans with optional speaker labels and confidence) and `ExtractionProvider` interface (given transcript + agenda + participants + language, return Proposed Decisions/Actions + optional per-item agenda assignment + optional discussion summaries on final pass).
- Define the request/response DTOs as Zod schemas (these are the boundary contracts).
- `FakeASRProvider` (emits scripted spans on command) and `FakeExtractionProvider` (returns scripted items) for deterministic tests.
- An injectable `Clock` abstraction here too (real + fake), since cadence logic will need it.

**TDD note:** Test that the fakes satisfy the interfaces and that the Zod DTO schemas round-trip. Test the fake clock advances deterministically.

**DoD:** gate green.

**Reflect:** **Add ADR:** Ports & Adapters provider architecture + deterministic-testing strategy (principles #6/#11). Update [CONTEXT.md](CONTEXT.md) if "provider" gains precise sub-terms.

---

## Phase 1 — Core engine (headless, fully testable)

### 0006 — Meeting lifecycle service (state machine)

**Depends on:** 0004.
**Goal:** Pure `Draft → Live → (pause/resume) → Ended` transitions with persistence.
**What & how:** A service enforcing legal transitions (can't go Live without leaving Draft, pause/resume only within Live, Ended is terminal except for editing). Persists state changes via repos. Emits domain events (`MeetingEnded`) the extraction loop will subscribe to for the final pass.
**TDD:** illegal transitions rejected; pause/resume keeps the same transcript; reaching Ended emits the event once.
**DoD:** gate green. **Reflect:** update CONTEXT if state names shift.

### 0007 — Item lifecycle service (Proposed/Confirmed)

**Depends on:** 0004, 0003.
**Goal:** Create/revise/retract Proposed items; confirm/edit/dismiss; protect Confirmed items.
**What & how:** Service methods: `proposeItems`, `reviseProposed`, `retractProposed`, `confirm`, `editAndConfirm`, `dismiss`, plus manual `createConfirmed` (live manual add). Rule: the agent may only touch Proposed items; Confirmed items change only via explicit user edit. All persisted.
**TDD:** agent revise on a Confirmed item is rejected; retract removes only Proposed; edit-then-confirm transitions state; manual create yields Confirmed.
**DoD:** gate green. **Reflect:** confirm rules match CONTEXT "Proposed/Confirmed".

### 0008 — Extraction loop with rolling cadence

**Depends on:** 0005, 0006, 0007.
**Goal:** Drive `ExtractionProvider` on a debounced ~15–30s cadence over accumulating transcript, feeding the item lifecycle service; run the final pass on `MeetingEnded`.
**What & how:** A scheduler using the injected `Clock`: accumulate spans, fire extraction when (a) N seconds of new transcript or (b) a pause is detected, whichever first. Pass agenda + participants + language as context. On `MeetingEnded`, run a final full-transcript pass that also produces per-Agenda-Item Discussion Summaries. Map results into `proposeItems`. Autosave each turn (principle #13).
**TDD:** with FakeExtractionProvider + fake clock: cadence fires at the boundary, not per-span; overlapping calls don't double-propose; final pass triggers exactly once and yields discussion summaries; a provider error skips the turn without crashing or losing prior items.
**DoD:** gate green. **Reflect:** this is the heart; recheck cadence wording in CONTEXT.

### 0009 — Owner & agenda-item assignment logic

**Depends on:** 0008.
**Goal:** Turn the provider's owner/agenda hints into validated assignments against the Participant list and agenda (with off-agenda fallback).
**What & how:** Pure mapping: provider suggests an owner name → fuzzy-match to a Participant → set `Action.owner` (or leave unset for the note-taker). Provider suggests a topic → match to an Agenda Item or assign Off-agenda. Never invent participants.
**TDD:** unknown owner name → owner unset, not invented; ambiguous match → unset; topic with no agenda match → Off-agenda.
**DoD:** gate green. **Reflect:** —

### 0010 — Anthropic ExtractionProvider adapter

**Depends on:** 0005.
**Goal:** Real cloud extraction via the Anthropic SDK behind `ExtractionProvider`.
**What & how:** `@anthropic-ai/sdk`. Use a structured-output prompt returning JSON validated by the 0005 Zod DTO; reject/repair invalid JSON (one retry, then skip turn). Default model for rolling extraction: a fast model (`claude-haiku-4-5`); final pass uses a stronger model (`claude-sonnet-4-6`) for quality — make both configurable. System prompt instructs output in the meeting's primary language (default Dutch). **Consult the `claude-api` skill before writing this item** for current model ids, params, and structured-output guidance.
**TDD:** mock the HTTP layer; assert prompt includes agenda/participants/language; valid JSON → items; malformed JSON → one retry → skip; verify no transcript content is logged.
**DoD:** gate green. **Reflect:** **ADR** for model selection (haiku rolling / sonnet final) and the structured-output-with-repair strategy.

### 0011 — Deepgram (cloud) ASRProvider adapter

**Depends on:** 0005.
**Goal:** Real streaming cloud ASR behind `ASRProvider` — the dependable v1 default per [ADR 0001](docs/adr/0001-electron-shell-with-onnx-local-asr.md).
**What & how:** Deepgram streaming WebSocket; Dutch language config; emit interim + final spans with timestamps, confidence, and speaker labels when diarization is on. Reconnect/backoff on socket drop without losing the session.
**TDD:** mock the socket; partial→final span emission; reconnect resumes; confidence + speaker labels surfaced when present.
**DoD:** gate green. **Reflect:** if "interim vs final span" becomes load-bearing vocabulary, add it to CONTEXT.

### 0012 — Settings + secrets + provider selection

**Depends on:** 0002, 0010, 0011.
**Goal:** Persisted settings (selected ASR/extraction provider, models, primary language) and secure API-key storage.
**What & how:** Settings JSON in userData (validated by Zod). API keys via Electron **`safeStorage`** (DPAPI), never in the settings JSON or the meeting DB. Provider factory resolves the configured provider (curated preset or custom OpenAI-compatible endpoint: base URL + model + key). Keys live only in main. Per [ADR 0003](docs/adr/0003-privacy-is-provider-dependent-with-explicit-egress.md), selecting a cloud ASR or cloud extraction provider must show **disclosure copy at the point of choice** stating exactly what data is transmitted and to which named vendor (including custom endpoints). Expose a derived `egressState` (what currently leaves the device and to whom) for the UI to render.
**TDD:** settings round-trip + schema rejection of bad config; key set/get via a mocked safeStorage; factory returns the right adapter for a given config; custom endpoint config validates; `egressState` is computed correctly for each provider combination (local ASR + cloud LLM, cloud ASR + cloud LLM, etc.).
**DoD:** gate green. **Reflect:** **ADR** for the BYO provider model (presets + OpenAI-compatible custom) if not already covered.

---

## Phase 2 — Application & UI

### 0013 — App shell, routing, state container, design tokens

**Depends on:** 0002.
**Goal:** Renderer skeleton: routing (Draft / Live / Review screens), a Zustand store, Tailwind + Framer Motion + design tokens, i18n scaffolding (Dutch default), and the persistent **egress indicator**. Use the `frontend-design` skill for the visual language.
**What & how:** Build a always-visible **`EgressIndicator`** component (badge, e.g. "audio lokaal · notulen via Anthropic") fed by the `egressState` from 0012, rendered in the app chrome on every screen that can be active while data flows (Draft, Live, Review). Per [ADR 0003](docs/adr/0003-privacy-is-provider-dependent-with-explicit-egress.md) this is a standing UI obligation, not a one-off.
**TDD:** component tests for routing and an empty store; i18n returns Dutch strings; `EgressIndicator` renders the correct text for each `egressState` (all-local, cloud-ASR, cloud-LLM, both) and is present on Draft/Live/Review.
**DoD:** gate green. **Reflect:** —

### 0014 — Draft screen: agenda, participants, language

**Depends on:** 0013, 0004, 0006.
**Goal:** Create a Meeting, add/edit Agenda Items and Participants, pick primary language, then "Start" (→ Live).
**TDD:** component tests: add/remove agenda item & participant; start disabled until valid; start transitions to Live via the IPC contract (mocked).
**DoD:** gate green. **Reflect:** —

### 0015 — Audio capture: microphone

**Depends on:** 0011, 0006.
**Goal:** Capture mic audio in the renderer, stream PCM chunks over IPC to the main-side ASRProvider.
**What & how:** Web Audio / `getUserMedia` + an `AudioWorklet` producing fixed-size PCM frames; transfer to main; main feeds the ASRProvider; spans flow back to the renderer. Handle permission denial gracefully.
**TDD:** the framing/resampling logic is pure → unit-test it (correct frame size, sample rate). IPC streaming tested with a fake audio source; permission-denied path tested.
**DoD:** gate green; live transcript spans appear from mic in a manual smoke check. **Reflect:** —

### 0016 — Audio capture: system loopback + mixing

**Depends on:** 0015.
**Goal:** Add WASAPI system-audio loopback (`getDisplayMedia` with audio on Windows), mix with the mic into one stream feeding ASR. Per [ADR 0002](docs/adr/0002-dual-stream-audio-capture.md).
**What & how:** Capture loopback, mix with mic in an AudioWorklet (sum + clamp/normalize), single stream to ASR. In-person mic-only is the no-loopback degenerate case (toggle).
**TDD:** the mixing function is pure → unit-test (two signals sum/clamp correctly; mono path when loopback absent). Capture wiring smoke-checked manually.
**DoD:** gate green. **Reflect:** note any platform caveat discovered (could amend ADR 0002).

### 0017 — Live screen: proposed items, agenda grouping, source spans, keyboard flow

**Depends on:** 0008, 0009, 0014.
**Goal:** The core live UI. Proposed Decisions/Actions stream in, grouped by Agenda Item, each showing its source span; note-taker confirms/edits/dismisses with keyboard-first flow; manual add; collapsed read-only transcript pane.
**What & how:** Subscribe to item events over IPC; render Proposed (visually distinct) vs Confirmed; inline edit; owner picker from Participants; "current agenda item" indicator (agent-guessed, user-correctable); collapsible transcript with soft low-confidence flags. Framer Motion for arrivals/retractions.
**TDD:** component tests with mocked IPC: proposed item renders with source span; confirm/dismiss/edit dispatch the right calls; retraction animates out; keyboard shortcuts work; transcript collapsed by default.
**DoD:** gate green. **Reflect:** UI may reveal a missing term (e.g. "current agenda item") → update CONTEXT.

### 0018 — Nudges

**Depends on:** 0017.
**Goal:** Reactive, dismissible nudges (Action without owner, contradicting Decisions, empty agenda item).
**What & how:** Pure nudge-derivation functions over current meeting state; render as dismissible prompts; never mutate on their own.
**TDD:** each nudge rule unit-tested (fires/doesn't); dismiss hides without changing data.
**DoD:** gate green. **Reflect:** confirm "Nudge" usage matches CONTEXT.

### 0019 — Running Summary / "ask the meeting" panel (L3)

**Depends on:** 0010, 0017.
**Goal:** Live updating whole-meeting summary + a query box answered from the transcript.
**What & how:** Periodic summary via the extraction/LLM provider (separate from item extraction); a Q&A call grounded in transcript so far. Clearly non-authoritative over Decisions/Actions.
**TDD:** with fake provider: summary refreshes on cadence; a query returns a grounded answer; failures degrade gracefully.
**DoD:** gate green. **Reflect:** confirm Running Summary vs Discussion Summary boundary still holds in CONTEXT.

### 0020 — End meeting, final pass, review & edit, Discussion Summaries

**Depends on:** 0008, 0017.
**Goal:** Stop → final extraction pass → review screen showing per-Agenda-Item Discussion Summary + Decisions + Actions, all editable.
**TDD:** ending triggers the final pass once (uses 0008); review screen renders summaries + items; edits persist; Ended meeting remains fully editable.
**DoD:** gate green. **Reflect:** —

### 0021 — Export: Markdown (primary) + JSON

**Depends on:** 0020.
**Goal:** Export a meeting to Markdown (agenda headings, Discussion Summary + Decisions + Actions per item, owners/due dates inline, off-agenda last) and to JSON. "Copy as Markdown" too.
**What & how:** Pure serializers domain → Markdown / JSON. Plain text only, no Office formats (per user preference).
**TDD:** golden-file tests for Markdown structure; JSON validates against a Zod schema; off-agenda placement; empty-meeting edge case.
**DoD:** gate green. **Reflect:** —

### 0022 — Meeting history / home

**Depends on:** 0004, 0013.
**Goal:** Home screen: "New meeting" + list of past meetings to reopen. Single-meeting v1; no cross-meeting dashboard (data model already supports it).
**TDD:** list renders from repo; reopen navigates; new meeting → Draft.
**DoD:** gate green. **Reflect:** —

---

## Phase 3 — Upgrades (deferred, post-core)

### 0023 — Local Parakeet V3 via ONNX + DirectML (spike → adapter)

**Depends on:** 0011 (proves the ASR seam).
**Goal:** Bring up local streaming Parakeet behind `ASRProvider` as an upgrade to the cloud default. Per [ADR 0001](docs/adr/0001-electron-shell-with-onnx-local-asr.md), this is the deferred high-risk path.
**What & how:** Time-boxed spike first: sherpa-onnx Node bindings + DirectML execution provider on the target AMD iGPU, streaming a Parakeet transducer export. Measure real-time factor and latency. If viable, wrap as `ParakeetAsrProvider`; if not, document the result and keep cloud default (sidecar remains the fallback per ADR 0001). Model downloaded on first selection with a progress UI; cached in userData.
**TDD:** adapter conforms to ASRProvider against recorded fixtures; download/cache logic tested with a mocked fetch.
**DoD:** gate green (the spike's go/no-go is recorded even if the adapter doesn't ship). **Reflect:** **amend ADR 0001** with the spike outcome.

### 0024 — Speaker-label mapping UI (cloud diarizer only)

**Depends on:** 0011, 0017.
**Goal:** When a diarizing ASR is active, let the note-taker map raw speaker labels to Participants; hidden on the local path.
**TDD:** mapping persists; transcript re-renders with real names; UI hidden when provider gives no labels.
**DoD:** gate green. **Reflect:** confirm "Speaker label" term in CONTEXT still accurate.

---

## Notes on sequencing

- **0001 → 0005 are the foundation**; nothing user-visible until 0013+, but the engine (0006–0012) is fully testable headless first. This is deliberate: the risky, logic-heavy parts get TDD'd without UI noise.
- **Cloud-first:** 0010/0011 give a working product before any local-model risk (0023).
- Each phase ends in something demonstrable: Phase 1 = a headless meeting you can drive in tests; Phase 2 = the full app; Phase 3 = local + diarization upgrades.
