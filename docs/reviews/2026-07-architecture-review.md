# Architecture review — deepening opportunities (2026-07)

A pass over the main-process orchestration looking for **deepening opportunities**: places
where a small interface should hide more behaviour, where complexity is duplicated across
callers, or where a module was extracted for testability but the real bugs hide in how it is
driven. Vocabulary follows the `improve-codebase-architecture` skill (Module / Interface /
Implementation / Depth / Seam / Adapter / Leverage / Locality) and the domain terms in
[CONTEXT.md](../../CONTEXT.md).

Method: direct reading of the main-process services, providers, session controllers, IPC
registry and factory, plus a fan-out Explore pass over the renderer, assignment and nudges.

The **deletion test** is the recurring tool: imagine deleting the module. If complexity
vanishes, it was a pass-through. If complexity reappears across N callers, it was earning
its keep.

---

## Ranked findings

### 1. `MeetingLifecycleService` is a fully-tested decoy; the real transitions run untested inline

**Files:** `src/main/services/meetingLifecycleService.ts` (193) + `meetingLifecycleService.test.ts`
(312); real transitions inline in `session/LiveSessionController.ts` (L193-209),
`session/ImportSessionController.ts` (L131-144, L227-231), `services/liveExtractionRuntime.ts`
(`endMeeting`, L445).

The service implements a typed `MeetingEnded` event bus (`on`/`off`/`emit`) and the
`Draft → Live → Ended` guards, and its test proves emits-once, multiple listeners, `off`, and
emit-while-paused exhaustively. In production **nothing subscribes** (`grep` for
`.on('MeetingEnded'` returns only the test) and `startMeeting` / `endMeeting` are never called
outside tests. The service is wired once in `index.ts` and used only for `pauseMeeting` /
`resumeMeeting`.

The real paths bypass it:

- **Draft → Live** is re-implemented inline in `LiveSessionController._buildRuntime` and again
  in `ImportSessionController.start`.
- **Live → Ended** for imports is inline in `ImportSessionController.finish`; for live meetings
  it is **not done at all**. The live end path (`meeting:end` → `LiveSessionController.endMeeting`
  → `runtime.endMeeting`) runs the final extraction pass but never sets `state: 'ended'`. A
  live meeting ended by the note-taker stays `state: 'live'` in the DB. Latent bug, masked by
  the decoy.

CONTEXT.md currently claims "`MeetingLifecycleService` is the single place that enforces
transitions and emits the `MeetingEnded` domain event that the extraction loop subscribes to."
That describes the intended design, not the running code.

**Deletion test:** deleting the service changes nothing in production today. The invariants it
encodes (guard wrong-state, set timestamps, no double-end) are real but currently unguarded on
the live path.

**Direction:** make the service the single enforcer and route the controllers through it,
which also fixes the missing Live → Ended transition. The unused `MeetingEnded` pub/sub is
speculative generality (one hypothetical subscriber is a hypothetical seam, not a real one) and
is a candidate for removal in favour of the existing direct call to the final pass.

---

### 2. The realtime ASR span stream is re-implemented in every streaming adapter

**Files:** `providers/DeepgramAsrProvider.ts` (455), `OpenAIRealtimeAsrProvider.ts` (384),
`MistralVoxtralRealtimeAsrProvider.ts` (329), `AzureOpenAIRealtimeAsrProvider.ts`.

Each streaming adapter carries a near-identical copy of the transport plumbing: the
`_queue` / `_waiters` async-iterator behind `spans()`, `stop()` draining waiters, the
`_connect` + `_reconnectAfterDelay` exponential-backoff loop, the `string | ArrayBuffer |
Uint8Array → JSON` message decoder, and the `_startedAtMs` / `_lastEndMs` span-timing
bookkeeping. What actually varies is small: the connection descriptor (URL + auth), the
session-config message on open, and the event → `TranscriptSpan` parse.

The extraction side already has the deep-module answer: `ChatExtractionEngine` lets
`OpenAICompatible` and `AzureOpenAI` be ~30-line adapters. There is no ASR equivalent.

**Deletion test:** delete the plumbing and it reappears identically in 3+ places.

**On ADR 0028** ("no shared realtime wire across vendors"): that ADR is about the _protocol_
(session config + event shapes stay per-vendor). This finding is about _transport plumbing_.
A shared realtime span-stream module sharpens 0028 rather than contradicting it.

---

### 3. `AnthropicExtractionProvider` re-implements the extraction contract `ChatExtractionEngine` already owns

**Files:** `providers/AnthropicExtractionProvider.ts` (426) vs `providers/openaiChatExtraction.ts`
`ChatExtractionEngine` (263); thin adapters `OpenAICompatibleExtractionProvider.ts` (88),
`AzureOpenAIExtractionProvider.ts` (89).

The OpenAI-family adapters are genuinely thin because the engine is deep. Anthropic is a
parallel universe: its own prompt/tool schema, its own one-retry-then-degrade, its own
agenda-exclusion and source-to-text handling. The extraction behaviour contract lives in two
unrelated files kept in lockstep by hand and tested twice (413 + 305 lines).

**Direction:** lift the contract into a shared extraction core; reduce Anthropic to a transport
adapter differing only in wire shape (tool-use vs chat JSON), the way Azure differs only in
URL + auth.

---

### 4. The item state machine has no observation seam and is duplicated across the IPC seam

**Files:** `services/itemLifecycleService.ts` (250), the `InterceptingItemLifecycleService`
subclass in `liveExtractionRuntime.ts` (L109-128), `renderer/store/appStore.ts` transitions.

Two symptoms of one missing seam:

- `LiveExtractionRuntime` **subclasses** `ItemLifecycleService` purely to learn "items were
  proposed," because the concrete class exposes no notify hook. `index.ts` then builds a
  _second_ plain instance over the same tables for the note-taker IPC path, so the interceptor
  fires for agent proposals but never for IPC confirms.
- The renderer re-implements Proposed → Confirmed transitions optimistically in `appStore.ts`,
  with `state: 'confirmed' as const` written on both sides of the wire. A rule change touches
  two modules that do not import each other.

**Direction:** put an on-propose/on-confirm seam where the behaviour lives (a scheduler/service
callback, as `AgendaInferenceScheduler` already does), delete the subclass, and derive the
renderer's optimistic transitions from one shared rule.

---

### 5. `LiveExtractionRuntime` is a 15-option hub; `MeetingContext` and session wiring have no owner

**Files:** `services/liveExtractionRuntime.ts` (549, 750-line test),
`session/LiveSessionController.ts` (245), `session/ImportSessionController.ts` (321),
`services/extractionLoopScheduler.ts` `MeetingContext` (L79-83).

The runtime carries six responsibilities (span filter, scheduler, agenda scheduler, running
summary, nudges, end-of-meeting context inference + title rewrite) and forks live-vs-import on
_which optional deps you pass_, so `_inferContextOnEnd` and the agenda scheduler are dead code
on the import path. `MeetingContext` is seeded empty, mutated in place, and re-derived
(`_liveRoutingContext`) with no single owner. The two session controllers duplicate
meeting-upsert and final-pass wiring, and `_inferContextOnEnd` /
`ImportSessionController._inferAndPersistContext` duplicate the "inferred items are Proposed"
persistence rule.

**Direction:** a cluster needing decomposition into smaller deep modules (a context owner, a
shared session core). Larger and best tackled after 1 and 4 clarify the seams.

---

### 6. `IpcRegistryDependencies` is the de-facto main-process surface

**Files:** `ipc-registry.ts` `IpcRegistryDependencies` (L150-301), `index.ts`
`registerIpcHandlers` (L210-438).

The registry takes ~30 mostly-optional callbacks. Many handlers are thin parse-then-delegate
wrappers whose real behaviour lives in `index.ts` closures that pull in Electron and cannot be
unit-tested. Two flavours are tangled: pass-throughs (`meetingList`, `meetingLoad`,
`meetingDelete`, `onCopyTranscript` forward straight to repos) and real coordination hiding in
an untestable spot (`onMeetingPause` = persist the flag _and_ halt the runtime).

**Direction:** group the read-only history calls behind a meeting-query module; lift the
pause/resume/end coordination into a session-coordinator so `index.ts` wires objects, not logic.

---

## Lower priority

- **Provider factory shallow wrappers.** `providerFactory.ts` (338): the three `tryBuild*`
  functions are pure try/catch pass-throughs, while the genuinely tricky `usage: 'live' |
'import'` fork that picks realtime-vs-batch per vendor is buried in a switch reachable only
  through a full `AppSettings`.
- **Repo naming asymmetry.** `actionRepo.listActionsByMeeting` breaks the `listByMeeting`
  convention every other repo follows; callers must remember which. Each repo also repeats the
  snake_case ↔ camelCase row-map + Zod re-parse with no shared helper.
- **Renderer screens.** `SettingsScreen.tsx` (1534, largest file) bundles config for 8+
  vendors, key entry, connection test and model download. `useLiveSession.ts` (188) fixes a
  known "mic never starts" bug with a hand-maintained 10-entry dep array behind a disabled
  `react-hooks/exhaustive-deps` lint rule. brittle seam.
- **Parallel Decision/Action methods** in `ItemLifecycleService` read shallow, but
  `exactOptionalPropertyTypes` plus genuinely different update shapes is a real counter-force.

---

## Suggested sequence

1. **Item 1** first. verified, contained, fixes a real bug, and is the cleanest example of the
   anti-pattern (tested pure module, untested real driver).
2. **Item 2** or **Item 3** next for leverage: both follow the proven `ChatExtractionEngine`
   shape and shrink the provider surface.
3. **Item 4** to remove the subclass hack and unify the item rule across the wire.
4. **Items 5 and 6** are the larger structural cluster; tackle once the seams above are clear.

Each item ships on its own branch and PR.
