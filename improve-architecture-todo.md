# Architecture deepening — TODO

Refactors that turn shallow, scattered code into **deep modules** (a lot of behaviour behind a small interface), for testability and AI-navigability. Each task is standalone. Vocabulary: domain terms from `CONTEXT.md`; "module / interface / seam / deletion test" per the architecture skill.

**Rules for every task**
- TDD: write the failing test first (`/tdd`), then the code. Tests sit next to the code (`*.test.ts`).
- DoD gate before commit: `npm run typecheck` && `npm run lint` && `npm test` && `npm run test:native` && `npm run format:check` (run format check last).
- One task = one commit (Conventional Commits, `/git-commit`). Don't bundle tasks.
- Don't change provider/IPC/security contracts unless the task says so. Respect ADRs in `docs/adr/`.

Priority order: **1 → 2 → 3 → 4**. Tasks 1 and 2 are independent; do either first.

---

## Task 1 — Extract the live-session lifecycle out of `index.ts` into a testable module

**Priority:** High

**Files**
- Edit: `src/main/index.ts` (the `registerIpcHandlers` function, ~lines 236–406)
- New: `src/main/session/LiveSessionController.ts`
- New: `src/main/session/LiveSessionController.test.ts`

**Problem**
The lifecycle of one live meeting (build ASR provider, build `AudioCaptureBridge`, build `LiveExtractionRuntime`, wire spans, tear down, run the final pass on end) lives as closures and mutable vars (`currentBridge`, `activeRuntime`, `buildRuntime`) **inside** `registerIpcHandlers`. It pulls in Electron (`BrowserWindow`, `webContents`) so it cannot be unit-tested. This is exactly where the recent audio start/stop bugs hid: real behaviour with **no locality** and no test surface. Deletion test: removing this logic scatters start/stop/rebuild across callers → it concentrates complexity → it deserves to be its own module.

**What to do**
1. Create a `LiveSessionController` class. Constructor takes injected deps only (no Electron import):
   - `settingsStore: SettingsStore`, `secretStorage: SecretStorage`
   - `buildAsr = tryBuildAsrProvider`, `buildExtraction = tryBuildExtractionProvider` (inject the functions so tests pass fakes)
   - repos: `decisionRepo`, `actionRepo`, `transcriptSpanRepo`, `discussionSummaryRepo`, `meetingRepo` instances
   - `sender: IpcSender` (the interface already in `AudioCaptureBridge.ts`)
   - `clock: Clock`
2. Move into it, as methods, the logic currently in `index.ts`:
   - `start()` — what `onAudioStart` does now (stop existing, rebuild ASR provider from current settings, build runtime via `buildRuntime`, build `AudioCaptureBridge`, `bridge.start()`).
   - `stop()` — what `onAudioStop` does now.
   - `endMeeting(meetingId)` — what `onMeetingEnd` does now.
   - `querySummary(question)` — current `summaryQuery` closure.
   - `pushAudioFrame(frame)` — forward to the active bridge (replaces the `ipcMain.on('audio:frame')` body's `currentBridge?.pushAudioFrame`).
   - Hold `currentBridge` / `activeRuntime` as private fields.
3. In `index.ts`: instantiate one `LiveSessionController`, then wire the registry callbacks to it: `onAudioStart: () => controller.start()`, `onAudioStop: () => controller.stop()`, `onMeetingEnd: (id) => controller.endMeeting(id)`, `summaryQuery: (q) => controller.querySummary(q)`, and `ipcMain.on('audio:frame', (_e, f) => controller.pushAudioFrame(f))`. `index.ts` keeps only: app/window setup, DB open + `runMigrations`, repo construction, building the controller, and registry wiring.
4. Keep behaviour identical. Do **not** change IPC channels or the `IpcRegistryDependencies` shape.

**Tests** (`LiveSessionController.test.ts`, no Electron)
- `start()` builds a bridge and runtime; a frame pushed after `start()` reaches the ASR provider; spans flow to the injected `sender` on `'transcript:span'`.
- `start()` called twice tears down the first bridge/runtime before building the second (the "rebuild on start" behaviour).
- `stop()` tears down; a frame pushed after `stop()` is a no-op.
- `endMeeting(id)` runs the final pass when a runtime is active and is a safe no-op when none is.
- Missing ASR key → falls back to `FakeASRProvider` without throwing.

**DoD:** gate green. Net behaviour unchanged in the running app.

---

## Task 2 — Extract a `useLiveSession` hook from `LiveScreen.tsx`

**Priority:** High

**Files**
- Edit: `src/renderer/src/screens/LiveScreen.tsx` (the audio/IPC `useEffect`, ~lines 525–623; and `audioLevel` state ~501)
- New: `src/renderer/src/screens/useLiveSession.ts`
- New: `src/renderer/src/__tests__/useLiveSession.test.tsx`

**Problem**
`LiveScreen.tsx` is 1042 LOC. One `useEffect` owns the whole renderer-side session: create `AudioCaptureService`, subscribe to 5 push channels (`onTranscriptSpan`, `onItemsChanged`, `onNudgesChanged`, `onSummaryChanged`, `onItemsSummaries`), start capture, and tear all of it down. This orchestration is interleaved with ~900 lines of item-rendering JSX. The recent "mic never starts" bug (a missing `activeMeeting` dependency) hid because this logic has **no locality** and no isolated test surface — it could only be tested through the entire screen.

**What to do**
1. Create hook `useLiveSession(activeMeeting: string | null): { audioLevel: number }`. Move the entire `useEffect` (guard, service creation, the 5 subscriptions, `service.start(...)` with the audio-level throttle, cleanup) into it. Read store actions inside the hook via `useAppStore`. **Keep `activeMeeting` in the dependency array** (that is the fix that must not regress).
2. In `LiveScreen`, replace the effect + `audioLevel` state with `const { audioLevel } = useLiveSession(activeMeeting)`. Rendering stays in `LiveScreen`.
3. Pure move — no behaviour change.

**Tests** (`useLiveSession.test.tsx`, `renderHook` + mocked `window.api`)
- Mounting with `activeMeeting === null` does not call `window.api.audioStart` / `getUserMedia`.
- When `activeMeeting` changes from `null` to an id, capture starts (assert `getUserMedia` reached, as in the existing `LiveScreen` regression test).
- Unmount calls each unsubscribe and `service.stop()`.
- A pushed `transcript:span` that fails Zod validation is dropped (no store write).

**DoD:** gate green. The existing `LiveScreen.test.tsx` and `routing.test.tsx` still pass unchanged.

---

## Task 3 — Thread the real Meeting id through `audio:start` (remove the `'active-session'` placeholder)

**Priority:** Medium. **Check first:** this may be deferred to a future backlog item — confirm in `BACKLOG.md` (item 0024+) before starting. If it is staged, skip and leave this note.

**Files**
- Edit: `src/main/index.ts` (`PLACEHOLDER_MEETING_ID`, `buildRuntime`, `onMeetingEnd` — lines ~279–390)
- Edit: `src/shared/ipc.ts` (`AudioStartRequestSchema`)
- Edit: `src/main/ipc-registry.ts` (`makeHandleAudioStart`)
- Edit: `src/renderer/src/services/AudioCaptureService.ts` (`audioStart()` call) and its caller in the Task-2 hook
- If Task 1 is done: this logic now lives in `LiveSessionController` — edit there instead of `index.ts`.

**Problem**
Main always persists to a hardcoded meeting id `'active-session'`. The renderer's `meeting:create` returns a real UUID and `setActiveMeeting(uuid)`, and `meeting:end` sends that UUID — but `onMeetingEnd` looks up `PLACEHOLDER_MEETING_ID` instead. So there are **two meeting identities** and the renderer's id is silently ignored. Confusing to navigate and a latent correctness bug (end ends the wrong row).

**What to do**
1. Add `meetingId: string` to `AudioStartRequestSchema`.
2. Renderer: pass the active meeting id into `service.start(...)` → `window.api.audioStart({ meetingId })`.
3. Main: `handleAudioStart` forwards the id to `onAudioStart(meetingId)`; the controller/`buildRuntime` uses it instead of the placeholder (upsert that row, run the runtime against it).
4. `onMeetingEnd(meetingId)` already receives the id — make sure it ends that row.
5. Delete `PLACEHOLDER_MEETING_ID`.

**Tests**
- `audio:start` with a meeting id builds a runtime scoped to that id; spans persist under it.
- `meeting:end` with the same id runs the final pass on that row.
- (Task 1 controller test, extended.)

**DoD:** gate green. A meeting created in Draft is the same row that ends and exports.

---

## Task 4 — Collapse repeated IPC-subscribe + Zod-parse boilerplate

**Priority:** Low (do after Task 2; touches the same hook)

**Files**
- Edit: `src/renderer/src/screens/useLiveSession.ts` (from Task 2)
- New (optional): `src/renderer/src/ipc/onValidated.ts` + test

**Problem**
The subscribe pattern repeats 5×, identical except for schema + store action:
```ts
const unsub = window.api.onX((raw) => {
  const r = SomeSchema.safeParse(raw)
  if (r.success) doThing(r.data)
})
```
Shallow duplication; easy to forget the `.success` guard on a new channel.

**What to do**
1. Add helper `onValidated<T>(subscribe, schema, handler): UnsubscribeFn` that wraps a push-channel subscription, runs `safeParse`, and calls `handler` only on success (drops invalid payloads).
2. Replace the 5 inline subscriptions in the hook with `onValidated` calls.
3. Keep validation-drops-silently behaviour (matches current code).

**Tests**
- Valid payload → handler called with parsed data.
- Invalid payload → handler not called, returned unsubscribe still works.

**DoD:** gate green. Hook behaviour unchanged.

---

## Considered and deliberately skipped

- **`ipc-registry.ts` (601 LOC):** already a deep, flat dispatch table — small `dispatch` interface, all Zod validation behind it. Length is handler count, not shallowness. Leave it.
- **`IpcRegistryDependencies` (~20 optional fields):** a smell, but it is the composition seam and each optional field is intentional graceful-degradation. Not worth churning.
- **`appStore.ts` (398 LOC):** a monolithic Zustand store is idiomatic; slicing it adds indirection without leverage.
- **`AudioCaptureBridge`, `providerFactory`, `MeetingLifecycleService`:** already deep (small interface, real behaviour, injected seams, tested). No action.
