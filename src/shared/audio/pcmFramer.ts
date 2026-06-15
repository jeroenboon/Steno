/**
 * PcmFramer — pure PCM framing, resampling, and float→int16 conversion.
 *
 * Responsibilities:
 *   1. Accept raw Float32 audio samples from Web Audio / AudioWorklet.
 *   2. Resample from sourceSampleRate to targetSampleRate using linear
 *      interpolation (sufficient quality for speech ASR).
 *   3. Convert resampled float samples to Int16 PCM (little-endian, clamped).
 *   4. Emit complete fixed-size frames via a callback. Incomplete trailing
 *      samples are buffered internally until a full frame can be emitted.
 *
 * This module has zero browser dependencies and is fully testable in Node.
 * Browser-side wiring (getUserMedia, ScriptProcessorNode) is isolated in the
 * renderer's AudioCaptureService.
 *
 * ## Frame format
 * Each emitted Uint8Array contains `frameSize` Int16 samples in little-endian
 * byte order (= `frameSize * 2` bytes total). This matches the encoding
 * Deepgram expects: `encoding=linear16`, mono, 16-bit LE.
 *
 * ## Resampling
 * Linear interpolation: for each target sample index t, compute the
 * corresponding source position p = t × (sourceSampleRate / targetSampleRate),
 * then interpolate between floor(p) and ceil(p). Good enough for speech; the
 * only strict requirement from Deepgram is the correct sample rate, not audiophile
 * fidelity.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PcmFramerOptions {
  /** Sample rate of the incoming Float32 audio (e.g. 48 000 Hz from Web Audio). */
  sourceSampleRate: number
  /** Target sample rate required by the ASR provider (16 000 Hz for Deepgram). */
  targetSampleRate: number
  /** Number of Int16 *samples* (not bytes) per emitted frame. */
  frameSize: number
}

/** Called once per complete frame with a Uint8Array view of the Int16 PCM data. */
export type FrameCallback = (frame: Uint8Array) => void

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INT16_MAX = 32767
const INT16_MIN = -32768

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class PcmFramer {
  private readonly _ratio: number // sourceSampleRate / targetSampleRate
  private readonly _frameSize: number
  private _buffer: Float32Array // resampled float samples not yet emitted
  private _bufLen = 0

  constructor(private readonly _opts: PcmFramerOptions) {
    this._ratio = _opts.sourceSampleRate / _opts.targetSampleRate
    this._frameSize = _opts.frameSize
    this._buffer = new Float32Array(_opts.frameSize)
  }

  /**
   * Push a chunk of raw Float32 samples. May emit zero or more complete frames
   * via the callback. Any leftover samples are buffered until the next push.
   *
   * @param input    Float32 samples from the audio source (range [-1, +1]).
   * @param onFrame  Called synchronously for each complete frame.
   */
  push(input: Float32Array, onFrame: FrameCallback): void {
    if (input.length === 0) return

    // Resample the input chunk to the target sample rate
    const resampled = this._resample(input)

    // Append resampled samples to the internal buffer, emitting frames as they fill
    let srcIdx = 0
    while (srcIdx < resampled.length) {
      const space = this._frameSize - this._bufLen
      const available = resampled.length - srcIdx
      const toCopy = Math.min(space, available)

      for (let i = 0; i < toCopy; i++) {
        // resample guarantees index within bounds; use nullish-coalesce for safety
        const sample = resampled[srcIdx + i] ?? 0
        this._buffer[this._bufLen + i] = sample
      }
      this._bufLen += toCopy
      srcIdx += toCopy

      if (this._bufLen === this._frameSize) {
        onFrame(this._encodeFrame(this._buffer))
        this._bufLen = 0
      }
    }
  }

  /** Discard any buffered partial frame (call on session stop or reset). */
  reset(): void {
    this._bufLen = 0
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resample `input` from sourceSampleRate to targetSampleRate using linear
   * interpolation. Returns a new Float32Array of the resampled samples.
   */
  private _resample(input: Float32Array): Float32Array {
    if (this._opts.sourceSampleRate === this._opts.targetSampleRate) {
      // No-op: copy as-is to avoid allocating an extra array in the hot path.
      return input
    }

    const srcLen = input.length
    // Number of output samples after resampling
    const outLen = Math.floor(srcLen / this._ratio)
    if (outLen === 0) return new Float32Array(0)

    const out = new Float32Array(outLen)
    for (let i = 0; i < outLen; i++) {
      const srcPos = i * this._ratio
      const lo = Math.floor(srcPos)
      const hi = Math.min(lo + 1, srcLen - 1)
      const frac = srcPos - lo
      // Linear interpolation; indices are bounded above, safe to coalesce to 0
      const loVal = input[lo] ?? 0
      const hiVal = input[hi] ?? 0
      out[i] = loVal * (1 - frac) + hiVal * frac
    }
    return out
  }

  /**
   * Encode `frameSize` float samples as little-endian Int16 PCM into a
   * Uint8Array. Clamps values outside [-1, +1].
   */
  private _encodeFrame(samples: Float32Array): Uint8Array {
    const bytes = new Uint8Array(this._frameSize * 2)
    const view = new DataView(bytes.buffer)
    for (let i = 0; i < this._frameSize; i++) {
      const s = samples[i] ?? 0
      const int16 =
        s < 0
          ? Math.max(Math.floor(Math.max(s, -1) * 32768), INT16_MIN)
          : Math.min(Math.floor(Math.min(s, 1) * 32768), INT16_MAX)
      view.setInt16(i * 2, int16, /* littleEndian */ true)
    }
    return bytes
  }
}
