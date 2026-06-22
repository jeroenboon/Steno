# Plan: Audio file import → meeting notes

Status: in progress. Owner: Jeroen. Target: a new "item 0026" feature, decomposed
into atomic TDD steps. Each step below is one `/tdd` red-green-refactor cycle and
one Conventional Commit. Do not start a step until the previous one is green
against the full Definition of Done gate (build, test, `test:native`, lint,
format).

**Progress (2026-06-22):** Steps 1-7 done and committed (the whole main side).
Step 8 (preload bridge) was folded into Step 6 so RendererApi never referenced an
unimplemented method. Remaining: Step 9 (renderer decode/stream service), Step 10
(Import screen + Home entry), Step 11 (Review label + reflect).

## Goal

Let the user import a recorded audio file (mp3, wav, m4a, flac, ogg) instead of
capturing live, optionally **upload** or **infer** the agenda + participants, and
produce the same structured notes (Discussion Summaries + Decisions + Actions)
we already produce for live meetings. The result lands in the existing Review
screen and exports unchanged.

## Core insight: reuse the whole downstream pipeline

The live pipeline is:

```
mic/loopback → PCM frames → AudioCaptureBridge → ASRProvider.pushAudioFrame()
  → spans() → persist spans → ExtractionLoopScheduler.runFinalPass()
  → Discussion Summaries + Decisions + Actions → Review screen + export
```

Everything from `ASRProvider.pushAudioFrame()` rightward is already vendor-neutral
and works on persisted spans. A file import only needs to replace the **source of
the PCM frames**: decode a file to 16 kHz mono 16-bit LE PCM and push it through
the same ASR port. The final pass (`runFinalPass`, which reads ALL spans from the
repo) then produces the notes with zero changes.

So the new surface is small:

1. Decode + resample a file to PCM in the renderer (same class of work
   `AudioCaptureService` already does with Web Audio).
2. A main-process `ImportSessionController` that runs frames through the ASR port,
   persists spans, optionally infers context, and runs the final pass.
3. Import IPC channels + a renderer Import screen.

## Design decisions (recorded in ADR 0026)

These are the hard-to-reverse choices, **confirmed by Jeroen on 2026-06-22**:
renderer-decode (decision 1) and reuse of the streaming ASR port (decision 2) are
both go. ADR 0026 is written in Step 1.

1. **Decode in the renderer via Web Audio `decodeAudioData`, stream PCM frames to
   main.** Chromium decodes mp3/wav/m4a/flac/ogg for free, so no `ffmpeg` binary
   and no new native dependency. Decoding is CPU work, not I/O / DB / secrets /
   provider calls, so it stays within the "renderer is UI only" rule the same way
   `AudioCaptureService` already runs Web Audio. The file is chosen with a sandbox
   safe `<input type="file">`; its bytes are decoded to PCM and streamed over IPC
   exactly like live audio, so they never need to reach main as a file.

   Alternative considered: decode in main with `ffmpeg-static`. Rejected for V1
   (new binary, packaging weight) but noted as the upgrade path if we hit a format
   Chromium cannot decode.

2. **Reuse the streaming `ASRProvider` port; do not add a Deepgram prerecorded
   adapter in V1.** The local Whisper provider (`LocalAsrProvider`, batch-per-chunk)
   is ideal for files and fully offline, which is the privacy-preferred path. The
   cloud streaming provider also works if we pace the frames (see Step 9 throttle),
   though a dedicated Deepgram prerecorded REST adapter is the correct long-term
   tool. Recorded as future work in ADR 0026.

3. **Imported meetings reuse the existing `draft → live → ended` state machine.**
   "Live" here is just the transcription phase the user waits on. We add a
   `source: 'live' | 'import'` field to Meeting for labelling, not a new state.

4. **Agenda/participants: upload OR infer.** If the user supplies them, they are
   used as context for the final pass. If the user picks "infer", a new optional
   `ExtractionProvider.inferContext(spans)` derives them from the transcript after
   transcription and before the final pass.

If you disagree with decision 1 or 2, stop and raise it before Step 1; the rest of
the steps assume both.

## New domain terms (added to CONTEXT.md in Step 1)

- **Recording Source**: where a Meeting's Transcript came from, `live` (captured)
  or `import` (uploaded audio file). Same downstream notes either way.
- **Imported Meeting**: a Meeting with `source: 'import'`.
- **Inferred Agenda / Inferred Participants**: agenda items and participants
  derived from the Transcript by the Extraction Provider when the user did not
  supply them. Distinct from the user-entered agenda/participants set in Draft.

---

## Steps

### Step 1 - Meeting.source field + migration + ADR + CONTEXT

**Goal:** add a `source` discriminator to Meeting and record the feature decision.

`/tdd`:

- Red:
  - `src/shared/domain/types.test.ts` (or wherever MeetingSchema is tested):
    `MeetingSchema.parse` defaults `source` to `'live'` when absent (back-compat),
    accepts `'import'`, rejects other strings.
  - `src/main/db/repos/meetingRepo.test.ts`: a meeting inserted with
    `source: 'import'` round-trips via `findById` and `list`.
- Green:
  - Add to `MeetingSchema` in `src/shared/domain/types.ts`:
    `source: z.enum(['live', 'import']).default('live')`.
  - New migration `src/main/db/migrations/0004_meeting_source.sql`:
    `ALTER TABLE meetings ADD COLUMN source TEXT NOT NULL DEFAULT 'live';`
  - Update `meetingRepo` `MeetingRow`, `rowToDomain`, `insert`, `update` to map
    the `source` column.
- Docs (same commit, per principle #4):
  - Write `docs/adr/0026-audio-file-import-renderer-decode-and-asr-port-reuse.md`
    capturing decisions 1-4 above and the future Deepgram-prerecorded path.
  - Add the three new terms to `CONTEXT.md`.

**DoD note:** run `format:check` last (the new ADR + migration are new files).

Commit: `feat(import): add Meeting.source field and import design ADR`

---

### Step 2 - InferredContext DTO + ExtractionProvider.inferContext port + Fake

**Goal:** define the boundary contract for inferring agenda/participants and add
the optional port method, backed by the fake used in tests.

`/tdd`:

- Red:
  - `src/shared/providers/providers.test.ts`: `FakeExtractionProvider.inferContext`
    resolves to a configurable `InferredContext`; `InferredContextSchema` parses a
    valid object and rejects malformed ones.
- Green:
  - In `src/shared/providers/dtos.ts` add:
    ```ts
    export const InferredContextSchema = z.object({
      agendaItems: z.array(z.object({ title: z.string().min(1), topic: z.string().min(1) })),
      participants: z.array(z.object({ name: z.string().min(1) })),
    })
    export type InferredContext = z.infer<typeof InferredContextSchema>
    ```
  - In `src/shared/providers/ExtractionProvider.ts` add optional:
    `inferContext?(spans: TranscriptSpan[]): Promise<InferredContext>` with a
    doc comment (callers must guard with `provider.inferContext !== undefined`,
    same pattern as `summarise`/`query`).
  - In `FakeExtractionProvider.ts` implement `inferContext` returning injected
    canned data (default: empty arrays).

Commit: `feat(import): add InferredContext DTO and inferContext provider port`

---

### Step 3 - AnthropicExtractionProvider.inferContext

**Goal:** real implementation that asks the model to infer agenda + participants
from a transcript, validated through Zod with the existing one-retry repair.

`/tdd`:

- Red: `src/main/providers/AnthropicExtractionProvider.test.ts`: mock HTTP; given a
  transcript, `inferContext` returns parsed `InferredContext`; a first malformed
  JSON response triggers the existing repair retry; a still-bad second response
  degrades to empty arrays (never throws into the pipeline).
- Green: implement `inferContext` reusing the JSON-with-one-retry-repair helper and
  the final-pass model (sonnet). Prompt in `primaryLanguage`. Never log transcript
  content (principle #11/#12).

Commit: `feat(import): implement Anthropic inferContext`

---

### Step 4 - CustomOpenAIExtractionProvider.inferContext

**Goal:** parity for the BYO OpenAI-compatible adapter.

`/tdd`:

- Red: `src/main/providers/CustomOpenAIExtractionProvider.test.ts`: mock HTTP; same
  three cases as Step 3.
- Green: implement `inferContext` mirroring Step 3 against the OpenAI-compatible
  endpoint.

Commit: `feat(import): implement CustomOpenAI inferContext`

---

### Step 5 - ImportSessionController (main orchestration core)

**Goal:** the heart. A non-Electron, fully injected controller that runs file PCM
through the ASR port, persists spans, optionally infers context, then runs the
final extraction pass and marks the meeting ended. This is the meaty deterministic
test.

`/tdd`:

- Red: `src/main/session/ImportSessionController.test.ts` using `FakeASRProvider`,
  `FakeExtractionProvider`, a fake `Clock`, in-memory repos, and a fake sender.
  Assert:
  1. `start({ meetingId, title, language, agendaItems, participants, infer: false })`
     upserts a meeting row with `state: 'live'`, `source: 'import'`.
  2. Frames pushed via `pushFrame()` produce spans that get persisted to
     `transcriptSpanRepo`.
  3. `finish()` stops the ASR provider, waits for spans to drain, runs the final
     pass (Discussion Summaries + proposed Decisions/Actions persisted), sets the
     meeting to `state: 'ended'` with `endedAt`, and resolves with `{ meetingId }`.
  4. With `infer: true` and a fake `inferContext` returning agenda + participants,
     those are persisted (agendaItemRepo/participantRepo) and used as the final-pass
     context (assert via the spy on the fake provider's `extract` request).
  5. With `infer: false` and user-supplied agenda/participants, those are persisted
     and used as context.
  6. A progress callback fires stage transitions: `transcribing` → (`inferring`?)
     → `extracting` → `done`.
- Green: create `src/main/session/ImportSessionController.ts`. Shape it on
  `LiveSessionController` (injected deps: settingsStore, secretStorage, all repos,
  sender, clock, injectable `buildAsr`/`buildExtraction`). Internally:
  - `start`: upsert meeting; build ASR provider (use `tryBuildAsrProvider`; for
    import, surface a clear error/progress event if ASR is not ready rather than
    silently using Fake - decide and document in the test); call `provider.start()`;
    spawn an async loop consuming `provider.spans()` that persists each final span
    (`isFinal !== false`) to `spanRepo`.
  - `pushFrame`: forward to `provider.pushAudioFrame`.
  - `finish`: `provider.stop()`; await the span loop to complete; if `infer` and
    `provider.inferContext` exists, read all spans, call it, persist agenda items +
    participants; assemble `MeetingContext`; run the final pass. Reuse
    `ExtractionLoopScheduler.runFinalPass(meeting, context)` (or
    `LiveExtractionRuntime` constructed with the real context and call
    `endMeeting`) so the summaries/items emit through the same path. Then set the
    meeting `state: 'ended'`, `endedAt`. Emit progress along the way.

Note: prefer composing `LiveExtractionRuntime` with the real `context` so
`items:changed` / `items:summaries` still emit and Review can read them back. This
also fixes the live path's habit of passing empty context, but keep that change out
of scope here (do not touch LiveSessionController in this step).

Commit: `feat(import): add ImportSessionController orchestrating offline transcription + final pass`

---

### Step 6 - Import IPC contract (schemas + channels)

**Goal:** declare the import channels in the single source of truth.

`/tdd`:

- Red: a schema test (next to `ipc.ts` or in `ipc-registry.test.ts`) asserting the
  new request/response schemas parse valid payloads and reject invalid ones, and
  that `IpcChannel` / `IpcOnewayChannel` include the new names.
- Green: in `src/shared/ipc.ts` add:
  - `import:start` (invoke): request `{ title, primaryLanguage, source: 'import',
agendaItems: {title,topic}[], participants: {name}[], inferContext: boolean }`,
    response `{ meetingId }`.
  - `import:finish` (invoke): request `{ meetingId }`, response `{ meetingId }`.
  - `import:frame` (one-way): add `'import:frame'` to `IpcOnewayChannel`.
  - `import:progress` (push event): payload
    `{ stage: 'transcribing'|'inferring'|'extracting'|'done'|'error', percent?: number, error?: string }`
    with a Zod schema (validated renderer-side per principle #8). Add
    `onImportProgress` to `RendererApi`, plus `importStart` / `importFinish` /
    `importSendFrame`.
  - Add the new invoke channels to the `IpcChannel` union.

Commit: `feat(import): add import IPC channels and schemas`

---

### Step 7 - Wire ImportSessionController into main + ipc-registry

**Goal:** connect the controller to the real IPC surface.

`/tdd`:

- Red: extend `src/main/ipc-registry.test.ts` to assert `import:start` /
  `import:finish` dispatch to injected handlers, and that the `IPC_CHANNELS` array
  stays in sync with the `IpcChannel` union (there is likely already a sync test;
  extend it).
- Green:
  - In `src/main/ipc-registry.ts` add handlers for `import:start` (create the
    meeting row, return `meetingId`, call `controller.start`) and `import:finish`
    (call `controller.finish`, return `{ meetingId }`).
  - In `src/main/index.ts`: construct an `ImportSessionController` (same deps as
    `LiveSessionController` plus `agendaItemRepo` + `participantRepo`); register
    `ipcMain.on('import:frame', ...)` forwarding to `controller.pushFrame`; add the
    new invoke channels to `IPC_CHANNELS`; wire `pushImportProgress` to
    `webContents.send('import:progress', evt)`.

Commit: `feat(import): wire import controller into main IPC`

---

### Step 8 - Preload bridge for import

**Goal:** expose the import API on `window.api`.

`/tdd`:

- Red: preload/bridge test (follow the existing pattern for `audioSendFrame` /
  `onTranscriptSpan`) asserting `importStart`, `importFinish`, `importSendFrame`,
  `onImportProgress` are exposed and forward to the right channels.
- Green: implement in `src/preload/` and update `src/renderer/src/env.d.ts` (or the
  shared `RendererApi`) so the renderer is typed.

Commit: `feat(import): expose import API over preload bridge`

---

### Step 9 - Renderer AudioFileImportService (decode + resample + stream)

**Goal:** decode the picked file, downmix to mono, resample to 16 kHz, chunk to
Int16 frames, and stream them with progress + throttling.

`/tdd`:

- Red: `src/renderer/src/services/AudioFileImportService.test.ts`. Inject a fake
  decoder (so jsdom needs no real Web Audio) returning a known Float32 buffer at a
  known sample rate, and a fake `window.api`. Assert:
  - stereo input is downmixed to mono;
  - output is resampled to 16 kHz and chunked into 4096-sample Int16 frames via the
    existing `PcmFramer`;
  - frames are pushed through `importSendFrame` in order;
  - a progress callback reports decode/stream percent based on samples consumed;
  - `start`/`finish` ordering: `importStart` before frames, `importFinish` after the
    last frame.
- Green: implement `AudioFileImportService`:
  - `decode(file)` behind an injectable decoder; default uses
    `OfflineAudioContext`/`AudioContext.decodeAudioData(await file.arrayBuffer())`.
  - downmix (average channels), feed through `PcmFramer({ sourceSampleRate,
targetSampleRate: 16000, frameSize: 4096 })`, push frames.
  - Optional pacing/throttle (e.g. cap frames/sec) so a cloud streaming ASR is not
    flooded faster than it can accept; for local ASR pacing is unnecessary. Make it
    a parameter so it is testable and off by default in tests.

Commit: `feat(import): add renderer AudioFileImportService (decode, resample, stream)`

---

### Step 10 - Import screen + route + Home entry point

**Goal:** the user-facing flow.

`/tdd`:

- Red: `src/renderer/src/__tests__/ImportScreen.test.tsx` with
  `@testing-library/react` + a mocked `window.api`. Assert:
  - file `<input type="file">`, title, language, an "upload vs infer agenda"
    toggle, and (when upload) agenda/participant inputs render;
  - "Start import" is disabled until a file + title are present;
  - starting calls `importStart`, streams via the service, then `importFinish`;
  - `import:progress` events update a progress view; `stage: 'done'` loads the
    meeting (`loadMeeting`) and navigates to Review; `stage: 'error'` shows an error
    and does not navigate;
  - Home renders an "Importeer opname" button that routes to `import`.
- Green:
  - Add `'import'` to `AppRoute` in `store/appStore.ts` and to `SCREENS` in
    `App.tsx` (no top-nav tab; reach it from Home to keep the nav clean).
  - `src/renderer/src/screens/ImportScreen.tsx`: wire `AudioFileImportService` +
    `window.api`, manage stages, on done `await loadMeeting(meetingId)` +
    `setRoute('review')`.
  - Add an "Importeer opname" button to `HomeScreen` next to "Nieuwe vergadering".
  - Add i18n strings (Dutch default) for all new UI in `src/renderer/src/i18n`.

Commit: `feat(import): add Import screen and Home entry point`

---

### Step 11 - Review labelling + polish + reflect

**Goal:** show that a meeting was imported, and close the DoD/docs loop.

`/tdd`:

- Red: `ReviewScreen.test.tsx` shows an "Geimporteerd" label/badge when
  `meeting.source === 'import'`; `HomeScreen.test.tsx` optionally tags imported
  meetings in the history list.
- Green: render the badge from `meeting.source`. Add i18n string.
- Reflect (same commit): re-read `CONTEXT.md` for term drift; confirm ADR 0026 is
  accurate to what shipped; optional screenshot under `docs/`.

Commit: `feat(import): label imported meetings in Review and Home`

---

## Cross-cutting notes

- **Frame format** is the live contract: 16 kHz mono 16-bit LE PCM, 4096-sample
  (256 ms) frames via `PcmFramer`. Do not invent a second format.
- **Supported formats** = whatever Chromium `decodeAudioData` accepts in Electron
  (mp3, wav, m4a/aac, flac, ogg/opus). Unsupported files surface a clean
  `stage: 'error'`, never a crash.
- **Progress stages**: the renderer owns decode/stream percent (it knows the file
  duration); main emits coarse stage transitions (`transcribing` → `inferring` →
  `extracting` → `done`). Keep them in the `import:progress` enum.
- **Privacy/egress**: import sends audio to the same configured ASR provider and
  text to the same extraction provider as live, so the existing `EgressIndicator`
  and disclosure copy already cover it. Do not log transcript content or file
  contents (principles #11/#12).
- **Degraded paths**: no ASR key configured → import cannot transcribe; emit a clear
  `error` stage pointing at Settings rather than silently producing an empty
  meeting. No extraction key → spans are still transcribed and persisted, but no
  notes (mirror the live degraded path); surface this to the user.
- **Out of scope for V1** (note in ADR 0026 as follow-ups): Deepgram prerecorded
  REST adapter, `ffmpeg`-based main-process decode, multi-file/batch import,
  speaker diarization mapping for imported files.

## Definition of Done (every step)

build succeeds, `npm test` passes, `npm run test:native` passes, zero lint errors,
Prettier has run (`format` last, after any new ADR/migration files are added).
One coherent commit per step via the `/git-commit` skill.
