# ADR 0028 — ASR is batch-first: no shared realtime wire, streaming deferred

**Status:** accepted (implemented 2026-06-24)  
**Relates to:** ADR 0007 (ports & adapters), ADR 0011 (Deepgram streaming), ADR 0026 (file import), Multi-provider expansion plan (Phase 3)

## Problem statement

The multi-provider expansion adds OpenAI, Mistral and Azure as ASR vendors. For extraction this was cheap: every vendor speaks the same `chat/completions` wire, so one adapter + one engine serves them all (ADR 0027). ASR is not so lucky.

1. **There is no shared realtime wire.** Live ASR is three unrelated WebSocket protocols — OpenAI Realtime (shared by OpenAI and Azure OpenAI `gpt-4o-transcribe`), Mistral Voxtral Realtime, and Deepgram's own. Each has its own session setup, interim/final semantics, and reconnect rules. A "generic streaming ASR adapter" would be a fiction.
2. **Batch transcription _is_ near-uniform.** The prerecorded path is a single multipart POST of an audio file to an `/audio/transcriptions`-style endpoint, differing only in URL + auth and minor response shape — the same kind of variation the extraction engine already absorbs.
3. The file-import feature (ADR 0026) only needs batch transcription: the whole audio is available up front.

The design goal: **let imports use any vendor now, without blocking on three separate realtime streaming integrations.**

## Decisions

### 1. Ship batch first; defer realtime streaming

Cloud ASR for the new vendors ships as **import-only**. OpenAI, Mistral Voxtral and Azure Whisper implement `transcribeBatch` and nothing else. Realtime streaming adapters are a later, explicit phase (plan Phase 4), built per-vendor because they share no wire.

### 2. One port, two modes; streaming methods throw on batch-only adapters

The `ASRProvider` port keeps both halves: streaming (`start` / `pushAudioFrame` / `spans`) and the optional `transcribeBatch`. Import-only adapters extend a shared `ImportOnlyAsrProvider` base whose streaming methods throw a descriptive "not yet implemented; import only" error. This keeps one port (no parallel type hierarchy) while making the unsupported half loud rather than silently broken.

### 3. The factory gates by usage

`buildAsrProvider(settings, storage, usage)` takes a `usage: 'live' | 'import'`:

- **import** → constructs the batch adapter.
- **live** → throws a descriptive Dutch "kan alleen voor import worden gebruikt" error for the batch-only vendors.

`ImportSessionController` builds with `'import'`; the live runtime uses the default `'live'` and already degrades to the Fake ASR on a not-ok build, so selecting an import-only vendor for a live meeting surfaces as a logged reason and a clear role-card notice rather than a crash. Deepgram and local Whisper build for both modes.

### 4. Shared batch substrate, per-vendor schema + target

The common work — WAV-encoding the renderer's raw PCM, multipart assembly, the POST, HTTP-error handling, and the segment→span mapping (with optional diarization speaker labels) — lives in `batchAsrSupport.ts`. Each adapter supplies only its Zod response schema and its `AudioBatchTarget` (URL + auth header): OpenAI/Mistral use `Bearer`; Azure uses the `api-key` header and the deployment URL shape, mirroring `AzureOpenAIExtractionProvider`.

### 5. Diarization maps onto the existing Speaker-label flow

Voxtral's batch response carries speaker diarization. It maps onto `TranscriptSpan.speakerLabel` (`Speaker N`), so the existing Speaker label → Participant flow (CONTEXT.md) lights up on the import path with no new concept.

## Trade-offs

- **Live parity is delayed** for the new vendors. Acceptable: Deepgram and local Whisper remain solid live options, and import is the feature that needed many vendors first (whole-file cost sensitivity, accuracy).
- **A batch-only adapter that implements a streaming port can throw at runtime.** Mitigated by the factory gate (the real guard) plus the role-card notice; the throws are a last line of defence, not the primary UX.
- **No realtime cost/latency tuning yet** for OpenAI/Mistral/Azure — deferred with the streaming adapters.

## Implementation notes

- `OpenAIBatchAsrProvider`, `MistralVoxtralBatchAsrProvider`, `AzureWhisperBatchAsrProvider` all extend `ImportOnlyAsrProvider` and reuse `postAudioTranscription` + `transcriptionResultToSpans`.
- WAV wrapping (`wavEncoder.ts`) is needed because the endpoints take a recognised container, not headerless PCM; the renderer still streams 16 kHz mono 16-bit LE PCM as for live.
- Responses are Zod-validated at the boundary (principle #8); keys travel only in headers and are never logged (principle #12).
- The ASR role card offers the import-only vendors with an explicit "alleen voor import" notice; Azure Speech persists only once its endpoint validates.

## What's next (Phase 4)

- Per-vendor realtime streaming adapters (OpenAI Realtime, reused for Azure OpenAI; Mistral Voxtral Realtime), each with its own interim/final + reconnect logic behind the same `ASRProvider` port.
- Remove the live gate and let the runtime pick streaming for live, batch for import, per provider capability; update egress/disclosure for live audio leaving to the vendor.
