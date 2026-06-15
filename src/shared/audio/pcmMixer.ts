/**
 * pcmMixer — pure PCM sample mixing (item 0017).
 *
 * Mixes a microphone Float32 buffer with an optional system-audio loopback
 * Float32 buffer into a single output Float32 buffer, then clamps every
 * sample to [-1, +1] to prevent overflow.
 *
 * ## Design decisions
 *
 * - Pure function with no side-effects: easy to test in Node, no browser deps.
 * - When loopback is null or zero-length it is treated as absent and the mic
 *   signal is returned directly (zero-copy when no gains are applied and
 *   lengths match). This is the in-person / mic-only degenerate case described
 *   in ADR 0002.
 * - Length mismatch is resolved by zero-padding the shorter array. Both the
 *   mic-longer and loopback-longer cases are handled symmetrically.
 * - Optional per-signal gain lets the caller duck one source relative to the
 *   other (e.g. reduce system audio to 0.7× during a live meeting). Defaults
 *   are 1.0 for both.
 * - Clamping happens after summing, not before. This preserves the shape of
 *   each signal at the cost of occasional hard clips on very loud material.
 *   For ASR purposes this is acceptable; the ASR model cares about phonemes,
 *   not audio fidelity.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MixOptions {
  /** Gain applied to the microphone signal before mixing. Default: 1.0. */
  micGain?: number
  /** Gain applied to the loopback signal before mixing. Default: 1.0. */
  loopbackGain?: number
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Mix mic and optional loopback Float32 buffers into a single output.
 *
 * @param mic       Raw microphone samples in the range [-1, +1].
 * @param loopback  System-audio loopback samples, or null when absent.
 * @param opts      Optional per-channel gain values (default 1.0 each).
 * @returns         Mixed Float32Array of length max(mic.length, loopback.length),
 *                  with every sample clamped to [-1, +1].
 */
export function mixPcm(
  mic: Float32Array,
  loopback: Float32Array | null,
  opts?: MixOptions,
): Float32Array {
  const micGain = opts?.micGain ?? 1.0
  const loopbackGain = opts?.loopbackGain ?? 1.0

  // No loopback (null or empty) → passthrough (mic-only degenerate case)
  if (loopback === null || loopback.length === 0) {
    if (micGain === 1.0) {
      // Exact passthrough — return a copy so callers can't mutate our data
      return mic.slice()
    }
    // Apply mic gain even in passthrough mode
    const out = new Float32Array(mic.length)
    for (let i = 0; i < mic.length; i++) {
      out[i] = Math.max(-1.0, Math.min(1.0, (mic[i] ?? 0) * micGain))
    }
    return out
  }

  const outLen = Math.max(mic.length, loopback.length)
  const out = new Float32Array(outLen)

  for (let i = 0; i < outLen; i++) {
    const m = (mic[i] ?? 0) * micGain
    const l = (loopback[i] ?? 0) * loopbackGain
    out[i] = Math.max(-1.0, Math.min(1.0, m + l))
  }

  return out
}
