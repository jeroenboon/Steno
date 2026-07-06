# Repo audit — raw scan notes

Scope: C:\repos\LiveTranscriber. Read-only pass, no source modified.
Written incrementally, one section per area.

---

## 1. src/shared (domain, ports, DSP, assignment, nudges, export, settings, ipc)

Files scanned: agenda/agendaTitle.ts, assignment/index.ts, audio/{pcmFramer,pcmMixer,pcmResampler}.ts,
domain/{types,index}.ts, export/meetingExporter.ts, ipc.ts, nudges/deriveNudges.ts,
providers/{ASRProvider,ExtractionProvider,FakeASRProvider,FakeExtractionProvider,clock,dtos,
extractionPresets,index,providerKeyHelp}.ts, settings/{egressState,keyRefs,settingsSchema}.ts,
utils/format.ts.

Overall: this is the cleanest area of the codebase so far. Pure functions, well documented,
no vendor SDK imports, Zod-first types throughout. Grep for `any`/`@ts-expect-error`/non-null
assertions/eslint-disable turned up almost nothing in non-test files.

### Findings

- **MEDIUM — settingsSchema.ts:180-436, 15-way hand-written union.** `AppSettingsSchema` is a
  literal cartesian product (3 extraction providers × 5 ASR providers = 15 near-identical
  `z.object` blocks), each repeating the same 6 "undefined" sibling fields
  (`openaiCompatible: z.undefined().optional()` etc.) with only the two provider literals and
  two config schemas varying. Adding a 4th extraction provider or 6th ASR provider means hand
  writing 5–6 more near-duplicate blocks and remembering to update all of them consistently —
  easy to drift (e.g. forget to null out a new sibling field in one of the 15). Could be
  generated programmatically (loop over the two provider-id arrays) or restructured as two
  independent discriminated unions merged with `.and()`/refinement. Not a correctness bug today
  (tests presumably cover it) but a maintenance trap baked into the type system.

- **LOW — ipc.ts:268-294 and 432-447, inline Decision/Action re-declaration.**
  `ItemsChangedPayloadSchema` and `NewDecisionItemSchema`/`NewActionItemSchema` redeclare the
  shape of `Decision`/`Action` field-by-field instead of reusing `DecisionSchema`/`ActionSchema`
  (which are imported and used elsewhere in the same file, e.g. `ItemConfirmResponseSchema`).
  If a field is added to the domain `ActionSchema` (as happened historically — `owner`,
  `dueDate`, `status` were added over time per CONTEXT.md), these three call sites must be
  remembered and updated by hand or the IPC payload silently drops the new field. Low severity
  because it's currently consistent, but it's a drift risk sitting directly on a Zod boundary
  that the project's own rule #8 is designed to protect against.

- **LOW — pcmFramer.ts and pcmResampler.ts implement the same linear-interpolation resampling
  algorithm twice** (pcmFramer.ts:116-139 `_resample`, pcmResampler.ts:32-57 `resamplePcm16`).
  One operates on Float32 in [-1,1], the other on Int16 PCM bytes, so they aren't a drop-in
  merge, but the interpolation math (`floor(pos)`, `frac`, lerp, clamp) is duplicated logic that
  could drift if one gets a quality/edge-case fix and the other doesn't (e.g. the `hi`/`i1`
  clamp-to-`length-1` boundary handling is written independently in both). Worth a shared
  low-level `lerp` helper if this file is ever touched again.

- **NIT — clock.ts, dtos.ts, ASRProvider.ts, ExtractionProvider.ts, FakeASRProvider.ts,
  FakeExtractionProvider.ts, agendaTitle.ts, assignment/index.ts, pcmMixer.ts, egressState.ts,
  keyRefs.ts, format.ts, deriveNudges.ts, meetingExporter.ts** — no smells found; genuinely
  clean, small, single-purpose, well-commented modules. No boundary-validation gaps: all
  external-shaped data here is either a Zod schema or pure in-memory transformation.

- **NIT — ipc.ts is 1060 lines** but it is a flat catalogue of channel schemas (one section per
  channel, consistently structured: RequestSchema/ResponseSchema/types). Long by line count but
  not a "god object" in the smell sense — no shared mutable state, each block is independent and
  easy to grep. Not flagging as a real problem, just noting size for the record.

---

## 2. src/main/providers (adapters + extractionEngine, realtimeSpanStream, wires, sherpa/)

Files scanned: all ~19 non-test files (12 ASR/extraction adapters + the 3 shared substrates —
`extractionEngine.ts`, `realtimeSpanStream.ts`, `openAiJsonWire.ts`, `anthropicToolWire.ts`,
`batchAsrSupport.ts` — + `wavEncoder.ts` + `sherpa/*`).

Overall: this is a genuinely well-executed ports-and-adapters area. ADR 0034's "thin adapter over
a shared engine/wire" design is followed consistently — the OpenAI-compatible, Azure OpenAI, and
Anthropic extraction adapters are each ~80-95 lines of pure wiring; the three batch ASR adapters
(OpenAI/Mistral/Azure Whisper) and two realtime families (Deepgram standalone, OpenAI Realtime
reused by Azure) show the same discipline. Zod validates every vendor response at the boundary.
No dead code, no commented-out code found.

### Findings

- **MEDIUM — sherpa/ModelDownloader.ts:57-61, hash verification is currently a no-op.**
  `ModelDownloader.EXPECTED_FILES` ships all three `sha256` values as `''`, and `verify()`
  explicitly skips the check when `sha256 === ''` (line 92: `if (expected.sha256 === '') continue`).
  The docstring says this is "pending the spike," but the code as it stands today downloads a
  ~357 MB model from HuggingFace over HTTPS and loads it straight into a native ONNX runtime with
  zero integrity verification — the exact case the `verify()` machinery exists to prevent. Worth
  confirming whether the spike ever landed real hashes; if not, this is a live gap between the
  documented design and the shipped behaviour.

- **MEDIUM — realtimeSpanStream.ts:197-238, unbounded reconnect on permanent failure.**
  `_connect`/`_reconnectAfterDelay` retry forever with exponential backoff capped at
  `maxBackoffMs` (default 30s) — there is no attempt ceiling and no way for the wire to signal
  "this is not transient" (e.g. an auth failure closing the socket with code 4001/1008 vs. a
  network blip). A wrong/expired API key therefore causes silent, permanent reconnect-every-30s
  behaviour with nothing surfaced to the user beyond a `console.error`/`console.info` line in the
  main-process log — the UI has no way to learn the ASR session is dead. Shared by every realtime
  adapter (Deepgram, OpenAI Realtime, Azure OpenAI Realtime, Voxtral Realtime) since they all sit
  on this one stream. Not verified end-to-end whether a higher layer (liveExtractionRuntime) ever
  surfaces socket health to the renderer — worth checking in the services pass.

- **LOW — AnthropicExtractionProvider.ts:103-163, `summarise`/`query` are near-duplicate.**
  Both methods build a spanLines string the same way, call `this._client.messages.create` with
  the same `max_tokens`/model, and pull the first text block out of `response.content` with
  identical logic (`response.content.find((block) => block.type === 'text')`). Only the system
  prompt and the user message text differ. A shared private helper (`_ask(system, user): Promise<string>`)
  would remove ~30 lines of duplication. Low severity — it's correct and consistent, just
  copy-pasted.

- **LOW — Direct SDK/fetch calls with no local try/catch in the wires.**
  `AnthropicToolWire.callStructured` (anthropicToolWire.ts:149-188) calls
  `this._client.messages.create(...)` with no try/catch; `OpenAiJsonWire._post`
  (openAiJsonWire.ts:107-111) calls `this._fetch(...)` with no try/catch around the fetch call
  itself (only the `!response.ok` case after a successful round-trip is handled). A thrown
  network error (DNS failure, connection reset, SDK-level exception) propagates out of
  `ExtractionWire.callStructured` and hence out of `ExtractionEngine.extract()`/`inferContext()`,
  which contradicts the `ExtractionProvider.extract()` docstring's contract
  (`@shared/providers/ExtractionProvider.ts:56-61`: "Never rejects under normal conditions; the
  extraction loop handles provider errors"). In practice this is partly mitigated — the rolling
  and final-pass call sites in `extractionLoopScheduler.ts` do wrap `provider.extract()` in
  try/catch — but `AnthropicExtractionProvider.summarise()`/`query()` and the `inferContext()` call
  inside `liveExtractionRuntime.ts` are not uniformly guarded (see area 3 for the concrete call
  sites). Flagging here at the source: the wire is the place a `try/catch → null` would make the
  "never rejects" contract actually true, rather than relying on every caller remembering to guard.

- **NIT — batch adapters (OpenAIBatchAsrProvider, MistralVoxtralBatchAsrProvider,
  AzureWhisperBatchAsrProvider) and the three extraction adapters over OpenAiJsonWire
  (OpenAICompatibleExtractionProvider, AzureOpenAIExtractionProvider) are exemplary DRY** — each
  is a ~90-110 line file supplying only a URL/header/response-schema difference over a shared
  substrate. No smells found.

- **NIT — DeepgramAsrProvider.ts:264 `body: pcm as unknown as BodyInit`** — a documented,
  narrowly-scoped cast to bridge `Uint8Array` and the DOM `BodyInit` type for `fetch`; reasonable
  and commented. Not flagging as a real type-safety escape.

- **NIT — sherpa/DefaultSherpaSessionFactory.ts** has ~10 `eslint-disable` comments for
  `no-unsafe-*`/`no-explicit-any` around the untyped native `sherpa-onnx` module. This is exactly
  the kind of narrow, contained boundary where suppressing the lint makes sense (the alternative
  is hand-rolling a full type declaration for a module with no types) — it is the _only_ file in
  the whole providers/ tree with this pattern, and `LocalAsrProvider.ts`, which consumes it, stays
  fully typed via the `SherpaSession`/`SherpaSessionFactory` interfaces. Good containment.

- **NIT — LocalAsrProvider.ts** — the `_pendingWork` counter + `_maybeFinalize()` pattern for
  "iterator completes only once stopped AND all in-flight inference is done" is a bit fiddly but
  is correctly reasoned through (constructor resets all fields on `start()`, `_workDone()` always
  runs in a `finally`, `_drainWaiters()` frees the native session exactly once). No leak found on
  a careful read.

---

## 3. src/main/services + src/main/session + src/main/db

Files scanned: all repos (`meetingRepo`, `decisionRepo`, `actionRepo`, `agendaItemRepo`,
`participantRepo`, `transcriptSpanRepo`, `discussionSummaryRepo`), `database.ts`, `migrate.ts`,
`mapRow.ts`, `db/index.ts`; all of `src/main/services/*.ts`; both session controllers
(`LiveSessionController.ts`, `ImportSessionController.ts`) and `finalizeMeetingEnd.ts`.

Overall: the DB layer is textbook — one `parseRow` helper shared by every repo, Zod validation on
every read, `meetingRepo` correctly kept out of that helper because it needs boolean coercion. The
services layer is the strongest area of the whole codebase so far: small single-purpose classes
(`MeetingContextOwner`, `AgendaProposalService`, `itemsChangedNotifier`, `persistInferredContext`)
each solving exactly one previously-duplicated problem, with docblocks that explicitly name what
they replaced (`InterceptingItemLifecycleService`, the old inline `_context`/`_liveRoutingContext`
pair) — real evidence of the "reflect after each change" principle being followed over time.
That said, this pass found the single most concrete bug candidate of the audit so far, described
first below.

### Findings

- **HIGH — a provider failure during meeting finalisation can permanently strand a meeting/import
  in a non-terminal state, silently skipping the final extraction pass.**
  Two call sites — `LiveExtractionRuntime._inferContextOnEnd`
  (`src/main/services/liveExtractionRuntime.ts:459`, `await this._provider.inferContext(...)`) and
  `ImportSessionController._inferAndPersistContext`
  (`src/main/session/ImportSessionController.ts:271`, `await provider.inferContext({ source: { spans } })`)
  — call the extraction provider with **no try/catch**, unlike every sibling call site in the same
  files (`_runSummary` at `liveExtractionRuntime.ts:349-361` explicitly catches and documents
  "Failures are caught and logged... degrade, never crash"; `runFinalPass` in
  `extractionLoopScheduler.ts:215-226` catches `provider.extract()`; `AgendaInferenceScheduler.tick`
  at `agendaInferenceScheduler.ts:92-111` catches `provider.inferContext()` for the _live_ cadence).
  Only the finalisation-time inferContext call is unguarded.

  Traced the full failure path for the live case:
  1. `LiveSessionController.endMeeting()` (`LiveSessionController.ts:178-188`) awaits
     `this._activeRuntime.endMeeting(meeting)` (line 182) with no try/catch, then runs
     `finalizeMeetingEnd(...)` (line 185, which is what actually flips the DB row to `state: 'ended'`
     via `MeetingLifecycleService.endMeeting`) and finally nulls `_activeRuntime` (line 187).
  2. Inside the runtime, `endMeeting()` (`liveExtractionRuntime.ts:390-428`) sets
     `this._endMeetingCalled = true` **first** (line 392, guards a second call), then calls
     `await this._inferContextOnEnd(meeting)` (line 404) — this only runs for an un-prepared live
     meeting (quick-start / agenda never set — `meeting.source === 'live'` and
     `agendaItems.length === 0`, `liveExtractionRuntime.ts:439-440`) with an extraction provider
     that supports `inferContext`.
  3. If that call throws (a transient network error, a rate limit, anything the wire doesn't turn
     into `null` — see area 2's wire finding), the exception propagates out of `endMeeting()` before
     `runFinalPass()` ever runs and before returning to the controller.
  4. Back in `LiveSessionController.endMeeting()`, the `await` on line 182 rejects, so
     `finalizeMeetingEnd` (line 185) and `_activeRuntime = null` (line 187) never execute. The
     meeting row is still `state: 'live'`. `_activeRuntime` still points at the same runtime
     instance, whose `_endMeetingCalled` flag is now permanently `true`.
  5. The rejection propagates through `ipc-registry.ts`'s `dispatch()` (the `try/catch` there,
     `ipc-registry.ts:809-813`, only guards the _synchronous_ call to the async handler — an async
     rejection is not caught) to the renderer's `meetingEnd()` invoke call as a rejected promise.
  6. If the note-taker retries "end meeting": `LiveSessionController.endMeeting()` runs again,
     `this._activeRuntime.endMeeting(meeting)` now hits the `_endMeetingCalled` guard and resolves
     immediately as a no-op (never re-runs `_inferContextOnEnd` or `runFinalPass`) — control then
     reaches `finalizeMeetingEnd`, which _does_ flip the meeting to `Ended` this time (the DB row
     was still `live`). Net effect: the meeting silently ends on the second attempt with **no
     Discussion Summaries, no final-pass supersession of rolling Proposed items, and (for a
     quick-start meeting) no inferred agenda/participants/title** — a materially thinner result
     than a normal ended meeting, with nothing telling the note-taker why.
  7. The import path is worse: `ImportSessionController.finish()` (`ImportSessionController.ts:193-244`)
     has no equivalent of `_endMeetingCalled`, but it does clear `this._asrProvider = null` and
     `this._pcmChunks = []` before reaching the unguarded `_inferAndPersistContext` call (lines
     196, 209). If that call throws, `finish()` rejects, `finalizeMeetingEnd` (line 240) never
     runs, and the import is stuck `state: 'live'` with no transcript/provider state left to retry
     with — a second `import:finish` call would see `asrProvider === null` (line 199) and return
     immediately without ever running extraction or ending the meeting. There is no recovery path
     short of restarting the app.

  This is exactly the class of bug the last few commits on this branch have been fixing (a stale
  finalising overlay, a stale paused flag, an ASR socket not restarting on resume — all
  interrupted-lifecycle bugs around pause/resume/end). The fix is small and localized: wrap both
  unguarded `inferContext()` calls in a try/catch that logs and continues (mirroring
  `_runSummary`'s pattern), so a transient provider failure degrades to "no inferred context" rather
  than stranding the meeting.

- **NIT — repos call `db.prepare(sql)` fresh on every method invocation** (all 7 repo files) rather
  than preparing each statement once (e.g. in a module-level object or the repo factory closure).
  better-sqlite3's `prepare()` is not free — it compiles the SQL each time — though for this app's
  access pattern (interactive, not a hot loop) it is very unlikely to matter in practice. Flagging
  only because it is a one-line-per-repo change if it ever does; not a correctness issue.

- **NIT — MeetingLifecycleService, ItemLifecycleService, MeetingContextOwner, AgendaProposalService,
  itemsChangedNotifier, persistInferredContext, meetingQueryService, extractionLoopScheduler,
  agendaInferenceScheduler** — no smells found. Consistent constructor-injection style throughout,
  clear single responsibilities, guard clauses instead of nested conditionals, no dead code, no
  `any`/unsafe casts. `ItemLifecycleService`'s `guardProposed`/`guardConfirmed` pair is a good
  example of the Proposed/Confirmed invariant being enforced in exactly one place rather than at
  every call site.

---

## 4. src/main/index.ts, ipc-registry.ts, settings/, csp.ts, window-options.ts, devlog.ts, audio/

Files scanned: `index.ts`, `ipc-registry.ts`, `csp.ts`, `window-options.ts`, `devlog.ts`,
`audio/AudioCaptureBridge.ts`, `settings/{SecretStorage,SettingsStore,connectionTest,
migrationUtils,providerFactory,egressState}.ts`.

Overall: the Electron security baseline (contextIsolation/sandbox/nodeIntegration/CSP) is
correctly locked down and well-commented on _why_, not just _what_ (`window-options.ts:9-11`
explicitly tells future editors to redesign the feature rather than loosen the flags).
`providerFactory.ts`, `SecretStorage.ts`, `connectionTest.ts` are exemplary — no key ever logged,
every fallible path returns a typed result instead of an uncaught throw. Two real findings below.

### Findings

- **HIGH — AudioCaptureBridge's span-forwarding loop has no error handling; one thrown error can
  silently and permanently kill live transcription, or crash the app.**
  `AudioCaptureBridge.start()` (`src/main/audio/AudioCaptureBridge.ts:76-81`) calls
  `void this._forwardSpans()` — fire-and-forget, no `.catch`. Inside, `_forwardSpans()`
  (`AudioCaptureBridge.ts:103-111`) is a `for await (const span of this._asr.spans())` loop that
  calls `this._onSpan?.(span)` with **no try/catch**. `onSpan` is wired (in
  `LiveSessionController.ts:151-158`) directly to `runtime.handleSpan(span)`, which calls
  `this._scheduler.addSpan(span, this._meetingId)`
  (`extractionLoopScheduler.ts:156-159`) → `this._spanRepo.insert(span, meetingId)` — a synchronous
  `better-sqlite3` call. If that insert throws for any reason (a `SQLITE_BUSY` from WAL
  contention, a disk-full, a foreign-key violation on a stale meeting id), the exception
  propagates synchronously out of `handleSpan`, out of the for-await loop, and rejects the
  `_forwardSpans()` promise — which nothing awaits or catches. This becomes an **unhandled
  promise rejection** in the Electron main process. There is no `process.on('unhandledRejection')`
  handler anywhere in `index.ts` (grepped, none found), and Node's default `unhandledRejection`
  mode (`throw`, the default since Node 15) terminates the process on an unhandled rejection —
  meaning a single failed span insert during a live meeting can crash the entire app mid-meeting.
  At minimum (if the runtime happens to tolerate it) it silently kills span forwarding for the
  rest of the session with zero user-facing signal. Fix: wrap the loop body (or at least
  `onSpan?.()`) in a try/catch that logs and continues, matching the "degrade, never crash"
  pattern used everywhere else in this codebase (e.g. `liveExtractionRuntime._runSummary`).

- **MEDIUM — `ipc-registry.ts:412-434`, the `meeting:start` handler is a stub that does not
  transition anything.** `makeHandleMeetingStart` ignores every dependency (no
  `meetingLifecycle`/`meetingRepo` access) and fabricates a hardcoded response:
  `title: 'Meeting'`, `primaryLanguage: 'nl'`, always `state: 'live'`, regardless of the meeting's
  real title, language, or even whether it exists. The inline comment (line 418-419) reads "For
  now, return a live meeting. When integrated with the DB + service, this will load the meeting,
  validate it, and persist the transition" — an unaddressed TODO in prose form. The actual
  Draft→Live transition happens elsewhere: `LiveSessionController._buildRuntime()`
  (`LiveSessionController.ts:254-256`) calls `this._meetingLifecycle.startMeeting(meetingId)` when
  it sees a still-`draft` row, triggered from the `audio:start` handler. Today this is harmless in
  practice — `DraftScreen.tsx:233` calls `await window.api.meetingStart(...)` and discards the
  result entirely, relying on `meetingCreate`'s response and the later `audio:start` call for the
  real transition — but the handler's name, its doc comment in `shared/ipc.ts` ("meeting:start —
  transition a draft meeting to live"), and its Zod-validated `MeetingSchema` response all actively
  mislead a reader into thinking this channel does the transition. A second real implementation
  layered on top of the existing `audio:start`-triggered one would double-apply the transition (the
  service guards against re-starting a non-draft meeting, so it would likely just throw); a
  developer debugging "meeting won't start" would naturally check this handler first and be
  misled. Worth either wiring it to the real `MeetingLifecycleService` or deleting the stub and
  the unused response fields.

- **NIT — no `process.on('unhandledRejection'/'uncaughtException')` global safety net anywhere in
  `index.ts`.** The top-level `app.whenReady().then(...).catch(console.error)` only covers the
  startup chain; nothing backstops a rejection from elsewhere in the app's lifetime (this is what
  makes the AudioCaptureBridge finding above app-fatal rather than merely a swallowed error).

- **NIT — no explicit DB shutdown.** `index.ts:289` opens the SQLite connection once at startup;
  there is no `app.on('before-quit', ...)` (or similar) that calls `db.close()` / checkpoints the
  WAL file before the process exits. WAL-mode SQLite tolerates an abrupt process exit, so this is
  unlikely to cause corruption, but it means the app never gets a clean "flush and close" moment —
  worth a one-line hook if this is ever revisited.

- **NIT — SecretStorage, SettingsStore, connectionTest, migrationUtils, providerFactory, csp.ts,
  window-options.ts, devlog.ts** — no smells found. `ElectronSecretStorage._ensureLoaded` correctly
  treats a corrupt/missing secrets file as "start fresh" rather than crashing;
  `testProviderConnection` never surfaces the raw fetch error (could echo a URL/key) and instead
  maps every failure to a short non-sensitive code (`'network'`, `'no-key'`, `'HTTP 401'`); `devlog`
  correctly no-ops until explicitly initialised and strips the `content` bucket entirely unless the
  `--debug` opt-in is set.

---

## 5. src/preload/index.ts

Overall: correctly follows the ADR 0005 rule that the renderer never touches `ipcRenderer` — every
channel is wrapped, `contextBridge.exposeInMainWorld('api', api)` is the sole exposure, and there is
no other Node/Electron API surfaced. Listener wiring for every push channel
(`onTranscriptSpan`/`onItemsChanged`/`onNudgesChanged`/etc.) consistently returns an `UnsubscribeFn`
that calls `ipcRenderer.removeListener`, so there is no listener-leak pattern baked into the bridge
itself (whether callers actually call the returned unsubscribe is a renderer-side question — see
area 6).

### Findings

- **MEDIUM — every `invoke()` wrapper casts the response with `as Promise<X>` instead of validating
  it.** All ~30 request/response methods follow the pattern
  `ipcRenderer.invoke('channel', req) as Promise<XResponse>` (e.g. `index.ts:100-101`,
  `:189-190`, `:247-252`) — a raw type assertion, not a runtime check. `preload/index.ts` imports
  only `type`-only symbols from `@shared/ipc` (no schema value is imported or used anywhere in the
  file). This means the boundary that principle #8 calls out by name ("IPC payloads... are all
  parsed through Zod before entering the domain") is, for the request/response half of the IPC
  surface, enforced only on the way _in_ (`ipc-registry.ts` validates every request payload with
  `RequestSchema.parse`) and not on the way _out_ — main's response is trusted as-is. Grepping the
  renderer confirms this isn't compensated for downstream either: only `meetingLoad`
  (`appStore.ts:425`, `MeetingLoadResponseSchema.parse(raw)`) and the four push-event channels
  (via the shared `onValidated` helper, `src/renderer/src/ipc/onValidated.ts`) actually re-validate;
  the other ~29 invoke responses (settingsGet, egressState, itemConfirm, meetingCreate, etc.) are
  consumed straight off the wire with only the compile-time cast as protection. Practically
  low-risk today — main is the same trust domain as the renderer, not an adversarial network peer —
  but it is a real, consistent gap against the codebase's own stated Zod-at-every-boundary rule, and
  a schema drift between an IPC response's Zod definition and what a handler actually returns (both
  live in `ipc.ts`/`ipc-registry.ts` today, but could diverge) would surface as a runtime type
  mismatch in the renderer with no validation error to point at the cause.

- **NIT — `preload/index.ts:322-326`, `agendaItemEditAndConfirm`'s invoke call is wrapped across
  three lines** while every sibling one-liner call fits on one or two — purely cosmetic, Prettier
  presumably chose this wrap for line length; not a real inconsistency.

---

## 6. src/renderer (screens, appStore, useLiveSession, i18n, components, services)

Files read in full or in depth: `LiveScreen.tsx` (1179 lines), `ReviewScreen.tsx`, `DraftScreen.tsx`,
`useLiveSession.ts`, `appStore.ts`, `App.tsx`, `i18n/index.ts`, `AudioCaptureService.ts`;
`ipc-registry.ts` cross-referenced for the agenda/participant-add handlers. Sampled:
`onValidated.ts`, `preview.tsx` (confirmed gitignored dev-only harness, out of scope).

The renderer discipline rule holds: grepped the whole tree for `ipcRenderer`/`require(`/`node:fs`/
`node:path`/raw `electron` imports — the only hit was a docblock comment in `App.tsx` reminding the
reader of the rule. Every screen goes through `window.api`. `i18n/index.ts` is exactly what
CLAUDE.md describes: a flat, type-checked Dutch dictionary, `t()` never throws. This pass surfaced
one very significant, well-evidenced finding (below) plus the LiveScreen-size / duplication items
the brief specifically asked about.

### Findings

- **CRITICAL — a normally-prepared Draft meeting's agenda items and participants are never
  persisted to the database; only quick-start/inferred/imported agendas ever reach storage.**
  Traced end to end:
  1. `DraftScreen.tsx:150-165` (`handleAddAgendaItem`) and `:187-201` (`handleAddParticipant`) call
     `window.api.agendaItemAdd({ meetingId: 'temp', ... })` / `participantAdd(...)` while the user
     is still in Draft (no real meeting exists yet — note the literal `meetingId: 'temp'` with the
     comment "Will be replaced when meeting is created").
  2. Their IPC handlers, `makeHandleAgendaItemAdd()` and `makeHandleParticipantAdd()`
     (`src/main/ipc-registry.ts:370-383` and `:392-403`), take **zero dependencies** — structurally
     they cannot reach a repo. Each just fabricates `{ id: randomUUID(), title, topic, state:
'confirmed' }` / `{ id: randomUUID(), name }` and returns it. Nothing is written to
     `agenda_items` or `participants`.
  3. `DraftScreen.createAndStart()` (`DraftScreen.tsx:223-250`) then calls `meetingCreate` (real
     meeting id) and `meetingStart` (also a stub — see the `ipc-registry.ts:412-434` finding above)
     and pushes the locally-accumulated `agendaItems`/`participants` arrays into the Zustand store
     via `setStoreAgendaItems`/`setStoreParticipants` — **a renderer-only state update, no IPC call
     carries this data to main under the real meeting id.**
  4. `LiveSessionController._buildRuntime()` (`src/main/session/LiveSessionController.ts:286-292`)
     constructs the `LiveExtractionRuntime`'s seed `context` as
     `{ agendaItems: [], participants: [], primaryLanguage: ... }` — hardcoded empty, not read from
     any repo or passed in from the renderer.
  5. Grepping every production call site of `agendaItemRepo.insert`/`participantRepo.insert`
     confirms only three paths ever write these tables: `ImportSessionController.ts:160/166` (the
     file-import flow, using its own `opts.agendaItems`/`opts.participants`), `agendaProposalService.ts:52`
     (live agent-inferred proposals), and `inferredContextPersistence.ts:45` (final-pass/live
     inference). **There is no path from "user typed an agenda item in Draft" to a database row.**

  Consequence: for a meeting where the note-taker does the intended thing — prepare a real agenda
  and participant list before starting — `MeetingContextOwner.routingContext()`
  (`src/main/services/meetingContextOwner.ts:53-59`) reads `agendaItemRepo.listByMeeting(meetingId)`,
  which is empty, so every live rolling extraction turn routes every Decision/Action to Off-agenda
  regardless of the prepared agenda, and the owner-assignment resolvers in `@shared/assignment`
  have no Participant list to match hints against (owner hints can never resolve). The problem is
  invisible in the renderer because the Draft screen's own agenda/participant lists (fabricated ids,
  never round-tripped) are what LiveScreen reads back from the store — everything _looks_ right
  until Review is reopened after an app restart or the routing/owner-matching behavior is compared
  against what the note-taker actually prepared. This also explains why `ipc-registry.test.ts:71-90`
  (the only test touching `agendaItem:add`) only asserts the response shape
  (`toHaveProperty('id')`/`toHaveProperty('title', ...)`) — nothing in the suite asserts the item is
  retrievable via `meeting:load` afterward, so this gap has no failing test to catch it. Quick-start
  meetings, imports, and any meeting relying purely on live/final-pass inference are unaffected
  (those paths all go through the three real insert call sites above) — this is specifically the
  "I prepared an agenda and participant list up front" path, arguably the primary intended workflow.

- **MEDIUM — `App.tsx:105-116`, the no-key banner reimplements key-requirement logic that already
  exists correctly in `@shared/settings/keyRefs.ts`, and misses most providers.** The inline check
  only pushes a required key for `asrProvider === 'deepgram'` and
  `extractionProvider === 'anthropic' | 'openai-compatible'`. It never checks `openai-audio`,
  `mistral-voxtral`, `azure-speech` (ASR) or `azure-openai` (extraction) — 4 of the 8 provider
  options a user can pick in Settings. A user who selects e.g. Mistral Voxtral for ASR and never
  sets its key gets no "configure your key" banner at all; the app just silently falls back to
  `FakeASRProvider` at `audio:start` (per `LiveSessionController._startBridge`'s documented
  graceful-degradation path) with only a `console.warn` the user never sees. `resolveAsrKeyRef` /
  `resolveExtractionKeyRef` (`src/shared/settings/keyRefs.ts:18-46`) already implement this mapping
  completely and correctly (including `local-parakeet → null`) and are used elsewhere
  (`connectionTest.ts`, `providerFactory.ts`) — `App.tsx` should call those instead of re-deriving a
  partial copy of the same switch.

- **MEDIUM — LiveScreen.tsx (1179 lines) duplicates the same try/catch/console.error boilerplate
  roughly eight times** (`handleConfirm`, `handleDismiss`, `handleEditSave`, `handleAgendaConfirm`,
  `handleAgendaDismiss`, `handleAgendaEditSave`, `handleTogglePause`, `handleEndMeeting`,
  `handleManualAdd` — `LiveScreen.tsx:544-698`), each wrapping one `await window.api.X(...)` call in
  `try { ... } catch (err) { console.error('[LiveScreen] X failed:', err) }`. `ReviewScreen.tsx`
  repeats the identical pattern for its own four handlers (`:414-525`). A small shared helper (e.g.
  `callApi(label, fn)`) would collapse ~9 near-identical blocks per screen into one utility and one
  call site each — pure duplication, no behavior difference between call sites. Not a bug (every
  call site is individually correct), just the kind of oversized-component duplication the file's
  size invites.

- **LOW — no dedicated unit test for `AudioCaptureService.ts`; `App.tsx`'s no-key-banner logic is
  tested only against the default provider combo.** `AudioCaptureService` (341 lines: PCM
  mixing/framing wiring, the `_acquireLoopback` 3s-timeout race, the RMS audio-level calculation) is
  exercised only indirectly through `useLiveSession.test.tsx`, which mocks the whole service rather
  than testing its internals — the timeout race and the RMS math have no direct test.
  (`appStore.ts` is fine — `store.test.ts`/`audioStore.test.ts` do directly test `reconcileItems`
  and its stale-meetingId guard, correcting an earlier pass of this note.) `App.tsx` itself is
  covered by `routing.test.tsx` and `no-key-graceful.test.tsx`, but the latter only exercises
  `DEFAULT_SETTINGS` (Deepgram + Anthropic) — it asserts a banner/nav appears when
  `secretHas` returns `false` for everything, but never configures the store with
  `mistral-voxtral`/`azure-speech`/`openai-audio`/`azure-openai` selected, so the coverage gap in
  the finding above (`App.tsx:105-116` missing 4 of 8 providers) has no test that would have
  caught it.

- **NIT — the "manual add" flow in `LiveScreen.tsx:667-698` uses `sourceSpanId: 'manual'`** as a
  sentinel string rather than a typed/branded marker — consistent with `DecisionSchema`/`ActionSchema`
  requiring a non-empty `sourceSpanId` (`TranscriptSpanIdSchema.min(1)`), and there is no
  transcript span with id `'manual'` to accidentally collide with (spans are UUIDs) — a reasonable,
  low-risk convention, just worth knowing it exists if `sourceSpanId` is ever used to look up a real
  span (`transcriptSpanMap.get('manual')` correctly returns `undefined`, handled everywhere).

---

## 7. Test quality skim

Sampled across areas (not exhaustive): `extractionLoopScheduler.test.ts`, `realtimeSpanStream.test.ts`,
`liveExtractionRuntime.test.ts`, `LiveSessionController.test.ts`, `ImportSessionController.test.ts`,
`ipc-registry.test.ts`, all seven `db/repos/*.test.ts`, `deriveNudges.test.ts`, `pcmFramer.test.ts`,
`store.test.ts`, `audioStore.test.ts`, `no-key-graceful.test.tsx`, `SettingsScreen.test.tsx`,
`useLiveSession.test.tsx`, `routing.test.tsx`. Grepped the full suite for shallow-assertion markers
(`.not.toThrow()`, `toBeDefined()`, `toBeTruthy()`) and for real-timer/network usage.

### Findings

- **Determinism: excellent.** Every main-process test sampled builds its harness from `FakeClock`,
  `FakeExtractionProvider`/`FakeASRProvider`, a `FakeWebSocket` (`realtimeSpanStream.test.ts:27-67`),
  or an `instantSleep = () => Promise.resolve()` in place of real timers
  (`realtimeSpanStream.test.ts:80`). Repo tests use a real `better-sqlite3(':memory:')` with
  migrations run — real SQL, no mocking of the DB layer, which is the right call (a mocked DB would
  hide the exact FK-cascade/parseRow bugs this layer cares about). No `setTimeout`-based real waits
  or live network calls found anywhere in the sampled main-process tests.

- **Assertion quality: strong in main, mixed-but-acceptable in renderer.** Main-process tests
  assert on actual behavior — call counts (`provider.callCount()`), persisted row state read back
  through the same repos, specific error-swallowing outcomes ("prior items intact" after a
  provider error, per `extractionLoopScheduler.test.ts:20-21`'s own acceptance-criteria docblock).
  Renderer tests lean on `expect(screen.getByTestId(...)).toBeDefined()` a lot (`SettingsScreen.test.tsx`
  alone has ~30 instances) — this isn't as vacuous as a bare "doesn't throw" because Testing
  Library's `getByTestId` already throws if the element is absent (so the assertion is redundant,
  not blind), but it is weaker than `toBeInTheDocument()`/checking rendered text, and doesn't verify
  disabled/visible/content state beyond presence in most of these call sites. Stylistic, not a real
  coverage gap.

- **Coverage gap, confirmed: the meeting-finalisation `inferContext()` failure path (the CRITICAL
  finding in area 3/6) has no test anywhere.** Grepped `liveExtractionRuntime.test.ts`,
  `LiveSessionController.test.ts`, and `ImportSessionController.test.ts` for any scripted rejection
  of `inferContext` during `endMeeting`/`finish` — none found. This is exactly the kind of case a
  `FakeExtractionProvider` variant that can be told to reject once would catch (the fakes currently
  only support scripting _return values_, not failures — `FakeExtractionProvider` has no
  `rejectNextCall()`-style hook), and its absence is consistent with the bug shipping unnoticed.

- **Coverage gap, confirmed: `agendaItem:add`/`participant:add` persistence (the CRITICAL finding in
  area 6) is asserted only at the response-shape level.** `ipc-registry.test.ts:71-90` is the only
  test touching `agendaItem:add`; it checks `toHaveProperty('id')`/`toHaveProperty('title', ...)`
  and never calls `meeting:load` afterward to confirm the item is actually retrievable — which it
  isn't. A single added assertion (`load the meeting and expect the agenda item in the result`)
  would have caught this immediately.

- **NIT — `db/repos/*.test.ts` (all seven) are consistently structured**: open an in-memory DB, run
  migrations, insert via the repo under test, read back via the same repo, assert on the domain
  object — a good, uniform pattern with no smells.

---

## Top findings

Ranked by severity, then by how much practical damage the bug/gap can do. File:line references
point to the exact call site described in the fuller write-up above.

1. **CRITICAL — `DraftScreen.tsx:150-201` / `ipc-registry.ts:370-403`.** Agenda items and
   participants typed in the Draft screen for a normally-prepared meeting are never persisted to
   the database — `agendaItemAdd`/`participantAdd` handlers take no repo dependency and only
   fabricate a response. Live routing (`meetingContextOwner.ts:53-59`) and owner-hint matching see
   an empty agenda/participant list for every such meeting, so everything routes to Off-agenda and
   owners never resolve. Only quick-start, import, and inference-only meetings are unaffected.

2. **CRITICAL/HIGH — `liveExtractionRuntime.ts:459` and `ImportSessionController.ts:271`.** The
   `inferContext()` call during meeting finalisation has no try/catch, unlike every sibling call
   site in the same files. A transient provider failure here permanently strands a live meeting in
   `state: 'live'` (first attempt throws; a retry succeeds but silently skips the entire final
   pass — no summaries, no final-pass item supersession) or permanently strands an import (no retry
   path at all, since `_asrProvider`/`_pcmChunks` are already cleared).

3. **HIGH — `AudioCaptureBridge.ts:76-111`.** The span-forwarding loop (`void this._forwardSpans()`)
   has no try/catch and nothing awaits it. A thrown error from the `onSpan` callback (e.g. a
   `better-sqlite3` insert failure) becomes an unhandled promise rejection with no
   `process.on('unhandledRejection')` handler anywhere in `index.ts` — Node's default behavior is to
   crash the process, so one failed span write can kill the app mid-meeting.

4. **HIGH — `realtimeSpanStream.ts:197-238`.** Reconnect-with-backoff retries forever with no
   attempt ceiling and no way to distinguish an auth failure (dead key) from a network blip. A
   wrong/expired API key causes silent, permanent reconnect-every-30s with nothing surfaced to the
   user beyond a console log — shared by every realtime ASR adapter.

5. **MEDIUM — `ipc-registry.ts:412-434`.** `meeting:start` is an unwired stub (fabricates
   `title: 'Meeting'`, `primaryLanguage: 'nl'`, ignores every dependency) with a stale "for now..."
   comment. Harmless today because the renderer discards its response, but its name and the
   `shared/ipc.ts` doc both actively mislead a reader into thinking it performs the Draft→Live
   transition, which actually happens inside `LiveSessionController._buildRuntime()`.

6. **MEDIUM — `App.tsx:105-116`.** The no-key banner's required-key check covers only 2 of the 6
   key-requiring provider combinations (misses `openai-audio`, `mistral-voxtral`, `azure-speech`,
   `azure-openai`), duplicating and under-implementing logic that already exists correctly in
   `@shared/settings/keyRefs.ts` (`resolveAsrKeyRef`/`resolveExtractionKeyRef`).

7. **MEDIUM — `sherpa/ModelDownloader.ts:57-61`.** All three `sha256` values in
   `EXPECTED_FILES` are placeholder empty strings, so `verify()`'s hash check is a documented no-op
   today — the local Whisper model downloads from HuggingFace with zero integrity verification.

8. **MEDIUM — `preload/index.ts` (whole file).** Every `invoke()` response is cast with
   `as Promise<X>`, never validated; only `meetingLoad` and the four push-event channels are
   re-validated on the renderer side (via `onValidated`/direct `.parse`). ~29 of ~33 invoke channels
   cross the IPC boundary with no Zod check on the way out, against the codebase's own stated rule.

9. **MEDIUM — `settingsSchema.ts:180-436`.** `AppSettingsSchema` is a hand-written 15-way cartesian
   product (3 extraction × 5 ASR providers), each block repeating the same six "undefined" sibling
   fields. Adding a provider means hand-writing 5-6 more near-duplicate blocks with real drift risk.

10. **LOW/MEDIUM — `ipc.ts:268-294`, `:432-447`.** `ItemsChangedPayloadSchema` and the
    `item:createConfirmed` request schemas redeclare `Decision`/`Action` field-by-field instead of
    reusing `DecisionSchema`/`ActionSchema` (used elsewhere in the same file) — a drift risk sitting
    directly on a Zod validation boundary.

11. **LOW — `AnthropicExtractionProvider.ts:103-163`.** `summarise()`/`query()` are ~30 lines of
    copy-pasted request/response plumbing differing only in the prompt strings — a shared `_ask()`
    helper would remove the duplication.

12. **LOW — `pcmFramer.ts:116-139` / `pcmResampler.ts:32-57`.** The same linear-interpolation
    resampling algorithm is implemented twice (Float32 vs. Int16 PCM) with independently
    hand-written boundary-clamping logic that could drift on a future fix to one but not the other.

13. **LOW — `LiveScreen.tsx:544-698` / `ReviewScreen.tsx:414-525`.** ~13 near-identical
    `try { await window.api.X(...) } catch (err) { console.error(...) }` blocks across the two
    largest screens — a shared `callApi` helper would collapse the boilerplate the 1179-line
    LiveScreen's size otherwise invites.

14. **LOW — no repo test asserts `agendaItem:add`/`participant:add` persistence** and no fake
    provider supports scripting a rejection — both gaps directly explain how findings #1 and #2
    shipped without a failing test.

15. **NIT — no `process.on('unhandledRejection'/'uncaughtException')` global handler, and no
    explicit `db.close()` on app quit** in `index.ts` — two cheap safety nets absent from an
    otherwise carefully-hardened main process entry point.
