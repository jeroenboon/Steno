# ADR 0026: Audio file import via renderer decode and streaming ASR port reuse

Status: accepted (2026-06-22)

## Context

The app only transcribes live capture. We want to import a recorded audio file
(mp3, wav, m4a, flac, ogg), optionally upload or infer the agenda + participants,
and produce the same structured notes (Discussion Summaries + Decisions + Actions)
we already produce live. See `docs/plans/audio-file-import-plan.md` for the full
step plan.

The live pipeline is already vendor-neutral from `ASRProvider.pushAudioFrame()`
rightward: spans are persisted, and the final extraction pass
(`ExtractionLoopScheduler.runFinalPass`) reads ALL persisted spans and produces the
notes. So an import path only needs to replace the source of the PCM frames.

## Decisions

### 1. Decode in the renderer via Web Audio, stream PCM frames to main

The user picks a file with a sandbox-safe `<input type="file">`. The renderer
decodes it with `AudioContext.decodeAudioData` (Chromium decodes mp3/wav/m4a/flac/
ogg in Electron), downmixes to mono, resamples to 16 kHz via the existing
`PcmFramer`, and streams 16-bit LE PCM frames to main over IPC, exactly as live
capture does.

Rationale: no `ffmpeg` binary and no new native dependency. Decoding is CPU work,
not I/O / DB / secrets / a provider call, so it stays within the "renderer is UI
only" rule the same way `AudioCaptureService` already runs Web Audio for mic and
loopback. The file bytes are turned into PCM and streamed; they never need to reach
main as a file.

Alternative considered: decode in main with `ffmpeg-static`. Rejected for V1 (new
binary, packaging weight). It is the upgrade path if we hit a container/codec
Chromium cannot decode; an unsupported file surfaces a clean error, never a crash.

### 2. Reuse the streaming `ASRProvider` port; no Deepgram prerecorded adapter in V1

Import frames go through the same configured `ASRProvider` as live. The local
Whisper provider (`LocalAsrProvider`, batch-per-chunk) is ideal for files and fully
offline, which is the privacy-preferred path. The cloud streaming provider also
works when the renderer paces the frames so it does not flood the socket faster
than realtime.

Alternative considered: a dedicated Deepgram prerecorded REST adapter. That is the
correct long-term tool for cloud file transcription, but it is a second ASR path
and is deferred. Recorded here as future work.

### 3. Imported meetings reuse the `draft → live → ended` state machine

"Live" here is just the transcription phase the user waits on. We do not add a
fourth state. We add a `source: 'live' | 'import'` field to Meeting (migration
0004, default `'live'`) purely for labelling. If the app is killed mid-import the
meeting shows as an interrupted live meeting, the same as a crashed live capture.

### 4. Agenda and participants: upload OR infer

If the user supplies agenda/participants, they are used as context for the final
pass. If the user picks "infer", a new optional
`ExtractionProvider.inferContext(spans)` derives them from the transcript after
transcription and before the final pass. `inferContext` is optional on the port
(same pattern as `summarise`/`query`), so adapters opt in.

## Consequences

- The entire downstream pipeline (persist spans, final pass, Review, export) is
  reused unchanged; the new surface is the renderer decode/stream service, a main
  `ImportSessionController`, the import IPC channels, and the Import screen.
- Egress is unchanged: import sends audio to the configured ASR provider and text
  to the configured extraction provider, so the existing `EgressIndicator` and
  disclosure copy already cover it.
- Degraded paths mirror live: no ASR key configured surfaces a clear error pointing
  at Settings rather than producing an empty meeting; no extraction key still
  transcribes and persists spans but produces no notes.

## Future work

- Deepgram prerecorded REST adapter for faster, more robust cloud file
  transcription.
- `ffmpeg`-based main-process decode as a fallback for formats Chromium cannot
  decode.
- Multi-file / batch import and speaker-label mapping for imported files.
