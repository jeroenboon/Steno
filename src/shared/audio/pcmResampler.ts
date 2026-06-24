/**
 * resamplePcm16 — pure Int16 PCM sample-rate conversion.
 *
 * The renderer's capture pipeline (AudioCaptureService + PcmFramer) emits mono
 * 16-bit LE PCM at CAPTURE_SAMPLE_RATE. Most ASR providers consume that directly
 * (Deepgram is told sample_rate=16000; local Whisper runs at 16 kHz; the batch
 * adapters WAV-wrap it at 16 kHz). The realtime adapters that expect a different
 * rate (OpenAI/Azure Realtime want 24 kHz pcm16) resample with this function
 * before sending, so the audio is interpreted at the right speed/pitch.
 *
 * Linear interpolation — the same quality bar as PcmFramer, which already
 * resamples the capture path. Good enough for speech ASR; the strict requirement
 * is the correct rate, not audiophile fidelity. Pure (no Node/browser deps) so
 * it is fully testable and usable in either process.
 */

/** Sample rate of the PCM frames leaving the renderer (the IPC contract). */
export const CAPTURE_SAMPLE_RATE = 16_000

const INT16_MAX = 32767
const INT16_MIN = -32768

/**
 * Resample mono Int16 LE PCM from `fromRate` to `toRate`.
 *
 * @param pcm       Mono 16-bit LE PCM bytes.
 * @param fromRate  Sample rate of `pcm` (Hz).
 * @param toRate    Desired sample rate (Hz).
 * @returns         Resampled mono 16-bit LE PCM. Returns `pcm` unchanged when the
 *                  rates match (a common passthrough for 16 kHz providers).
 */
export function resamplePcm16(pcm: Uint8Array, fromRate: number, toRate: number): Uint8Array {
  if (fromRate === toRate) return pcm

  const inSamples = pcm.byteLength >> 1
  if (inSamples === 0) return new Uint8Array(0)

  const inView = new DataView(pcm.buffer, pcm.byteOffset, inSamples * 2)
  const readSample = (i: number): number => inView.getInt16(i * 2, true)

  const ratio = fromRate / toRate // source samples per output sample
  const outSamples = Math.max(1, Math.round(inSamples / ratio))
  const out = new Uint8Array(outSamples * 2)
  const outView = new DataView(out.buffer)

  for (let t = 0; t < outSamples; t++) {
    const pos = t * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, inSamples - 1)
    const frac = pos - i0
    const interpolated = readSample(i0) * (1 - frac) + readSample(i1) * frac
    const clamped = Math.max(INT16_MIN, Math.min(INT16_MAX, Math.round(interpolated)))
    outView.setInt16(t * 2, clamped, true)
  }

  return out
}
