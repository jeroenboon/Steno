# ADR 0031 — Realtime ASR resamples in the adapter; the capture contract stays 16 kHz

**Status:** accepted (implemented 2026-06-24)  
**Relates to:** ADR 0005 (process discipline), ADR 0007 (ports & adapters), ADR 0011 (Deepgram streaming), ADR 0013 (renderer audio capture), ADR 0028 (no shared realtime wire), Multi-provider expansion plan (Phase 4 follow-up)

## Problem statement

The renderer captures microphone + system loopback, mixes it, and resamples to **16 kHz** mono 16-bit LE PCM (`AudioCaptureService` + `PcmFramer`), then streams those frames to main over the `audio:frame` IPC channel. Main forwards each frame to the configured ASR provider via `pushAudioFrame`.

That 16 kHz contract is correct for Deepgram (told `sample_rate=16000`), local Whisper (16 kHz model), and the batch adapters (WAV-wrapped at 16 kHz). But the Phase 4 realtime adapters forwarded those bytes verbatim with no rate negotiation, and **OpenAI/Azure Realtime expect `pcm16` at 24 kHz**. Sending 16 kHz samples that the endpoint reads as 24 kHz plays the audio ~1.5× fast and pitch-shifted, wrecking transcription. The bug couldn't be caught by the scripted-frame unit tests (they assert framing, not acoustics), so it was deferred out of the Phase 4 adapter commits and gated live cloud ASR use.

Two ways to fix it:

1. **Resample in the renderer per chosen provider** — have the capture path target the selected provider's rate.
2. **Resample in the adapter** — keep the renderer at a fixed canonical rate and let each adapter convert to the rate it needs.

## Decision

**Resample in the adapter. The renderer keeps emitting a single canonical 16 kHz stream.**

- A pure `resamplePcm16(pcm, fromRate, toRate)` (linear interpolation, the same quality bar as `PcmFramer`) lives in `src/shared/audio/pcmResampler.ts`, alongside a `CAPTURE_SAMPLE_RATE = 16_000` constant that is now the **single source of truth** for the pipeline rate (the renderer's `TARGET_SAMPLE_RATE` points at it).
- Each realtime adapter declares the rate it wants and resamples from `CAPTURE_SAMPLE_RATE` inside `pushAudioFrame`:
  - `OpenAIRealtimeAsrProvider` → 24 kHz (`inputSampleRate`, default 24 kHz). Azure reuses this adapter and rate.
  - `MistralVoxtralRealtimeAsrProvider` → 16 kHz. Voxtral consumes the capture rate, so this is a passthrough today; it is still routed through the resampler so a future API change is a one-line constant edit.
- `resamplePcm16` returns the input unchanged when the rates match, so the 16 kHz providers pay nothing.

### Why the adapter, not the renderer

- **Process discipline (ADR 0005) + ports & adapters (ADR 0007).** Vendor-specific wire facts — auth, URL, framing, and now sample rate — belong in the main-process adapter, not in the UI. The renderer shouldn't know that "OpenAI Realtime wants 24 kHz." It already knows nothing else vendor-specific.
- **One capture path, not N.** Resampling in the renderer would mean the capture graph reconfigures per provider, and a provider switch mid-session (or the import path, which reuses the same framer) would have to renegotiate. A fixed canonical rate keeps capture, IPC, persistence, and the batch path uniform; only the realtime adapters that differ do the extra work.
- **Testability.** The conversion is a pure function with its own spec; each adapter's resampling is observable in the bytes it sends (the OpenAI adapter test asserts an 8-byte 16 kHz frame leaves as 12 bytes at 24 kHz).

### Why resampling (not just relabelling) is the correct fix

The captured audio genuinely contains up to ~8 kHz of speech content sampled at 16 kHz. Resampling to 24 kHz preserves those frequencies so the speech sounds correct at the right speed; relabelling 16 kHz bytes as 24 kHz would not. Upsampling adds no information, but it makes the endpoint interpret the audio at the rate it was actually captured.

## Consequences

- Live OpenAI/Azure/Mistral cloud ASR can now be used without pitch/speed distortion.
- Adding a realtime vendor with yet another rate is a per-adapter constant + the shared resampler — no capture or IPC changes.
- Linear interpolation is "good enough for speech" (same as the existing capture resample); if a vendor ever needs higher-fidelity resampling, it can be swapped behind the same pure function without touching adapters.
