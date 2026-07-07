# ADR 0041 — Local ASR inference runs in a worker_thread

**Status:** accepted (in-app verified in dev; packaging follow-up tracked below)
**Relates to:** ADR 0001 (local ONNX ASR), ADR 0005 (process discipline)

## Context

`sherpa-onnx` ships as a synchronous WASM build. `recognizer.decode()` runs on the
calling thread for the full duration of a chunk. Measured on a dev machine with the
Whisper small model: **~5.4 s to decode a 5 s chunk** (slightly slower than
real-time). `LocalAsrProvider` ran that decode on the **main process** event loop,
so every chunk froze IPC, audio intake, and window management — the app showed
"Not Responding" for seconds at a time, regardless of the extraction provider.

A validation probe made this concrete. Decoding on the main thread: **0** main-loop
heartbeats (10 ms interval) during the decode. The same decode in a worker_thread:
**~992** heartbeats over 14 s (and 2050 over a 32 s real-audio run) — the main loop
stayed free the entire time, and the transcript was correct.

## Decision

Run sherpa inference in a Node `worker_thread`, behind the existing
`SherpaSessionFactory` / `SherpaSession` seam, so `LocalAsrProvider` is unchanged
(it still awaits `session.transcribe(pcm): Promise<string>`). The real
`worker_threads.Worker` sits behind a `SherpaWorkerHandle` seam so the
request/response protocol (init/decode/free, id-correlated results, error and
free-time rejection) is unit-tested with a fake handle — no thread, no WASM, no
model. `providerFactory` injects `WorkerSherpaSessionFactory` for `local-parakeet`.

**Why worker_threads, not utilityProcess:** sherpa is WASM, so it is ABI-agnostic
and loads cleanly in a worker (no native-addon worker-safety concern, and the
existing dual-ABI swap does not even apply — the worker shares the Electron
runtime). worker_threads has lower overhead than a separate process and the
`transcribe(): Promise<string>` seam already returns a promise, so it is a drop-in.
utilityProcess stays the fallback if a future non-WASM sherpa build is not
worker-safe.

The worker entry (`sherpaDecodeWorker.mjs`) is a standalone ESM file copied verbatim
into `out/main/` by an electron-vite `writeBundle` hook (sherpa-onnx is externalized
and required at runtime from node_modules). The spawner resolves it via
`join(__dirname, 'sherpaDecodeWorker.mjs')`.

## Consequences

- The "Not Responding" freeze during local transcription is removed: the main
  process stays responsive while decode runs in the worker.
- Because decode is ~real-time-or-slower, a backlog accumulates during a live
  meeting and drains after it ends (the existing `_pendingWork` drain-on-stop
  already finishes the tail). This "lazy" transcript is acceptable but needs a
  visible progress signal and a backlog cap — tracked as a follow-up (P1), along
  with deferring/batching extraction under local load (P2).
- **In-app verified (dev):** the emitted worker spawns from `out/main/` inside the
  running Electron main process with live mic capture; the freeze is gone and
  transcription flows (audio local, notes cloud). This is what moves the ADR to
  accepted.
- **Follow-up — packaging (not yet done):** the repo currently has no
  electron-builder config or packaging script; the app only runs via
  `electron-vite build` → `out/`. The spawner resolves the worker with
  `join(__dirname, 'sherpaDecodeWorker.mjs')`, which works in the `out/` layout but
  will **not** work once the app is packaged into `app.asar`: Node cannot spawn a
  worker from inside an asar, and sherpa-onnx's runtime assets cannot load from it
  either. When packaging is introduced, both the worker entry and sherpa-onnx must
  be `asarUnpack`'d (or shipped via `extraResources`) and the spawn path pointed at
  the unpacked location. Tracked as a separate issue — deliberately out of scope for
  this perf spike.
