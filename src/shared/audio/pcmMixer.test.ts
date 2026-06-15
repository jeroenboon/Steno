/**
 * Tests for the pure PCM mixer (item 0017).
 *
 * mixPcm() is a zero-dependency pure function. No browser APIs, no IPC.
 * All tests run in Node via Vitest.
 *
 * Behaviors under test:
 *   1. Null loopback → mic passthrough (values identical)
 *   2. Equal-length signals sum correctly
 *   3. Positive overflow clamps to +1.0
 *   4. Negative overflow clamps to -1.0
 *   5. Length mismatch: shorter array is zero-padded
 *   6. Custom gain applied to loopback
 *   7. Empty loopback array treated like null (passthrough)
 */

import { describe, it, expect } from 'vitest'

import { mixPcm } from './pcmMixer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Float32Array from a plain number array. */
function f32(...values: number[]): Float32Array {
  return new Float32Array(values)
}

/** Read a single sample from a Float32Array, asserting it is close to expected. */
function expectSample(arr: Float32Array, index: number, expected: number, precision = 6): void {
  const val = arr[index]
  expect(val).toBeDefined()
  expect(val).toBeCloseTo(expected, precision)
}

// ---------------------------------------------------------------------------
// 1. Null loopback → passthrough
// ---------------------------------------------------------------------------

describe('mixPcm — null loopback', () => {
  it('returns mic samples unchanged when loopback is null', () => {
    const mic = f32(0.1, 0.5, -0.3, 0.0)
    const result = mixPcm(mic, null)

    expect(result).toHaveLength(4)
    expectSample(result, 0, 0.1)
    expectSample(result, 1, 0.5)
    expectSample(result, 2, -0.3)
    expectSample(result, 3, 0.0)
  })
})

// ---------------------------------------------------------------------------
// 2. Equal-length signals sum correctly
// ---------------------------------------------------------------------------

describe('mixPcm — equal-length sum', () => {
  it('sums mic and loopback sample-by-sample', () => {
    const mic = f32(0.25, 0.0, -0.1)
    const loopback = f32(0.25, 0.3, 0.1)
    const result = mixPcm(mic, loopback)

    expect(result).toHaveLength(3)
    expectSample(result, 0, 0.5)
    expectSample(result, 1, 0.3)
    expectSample(result, 2, 0.0)
  })
})

// ---------------------------------------------------------------------------
// 3. Positive overflow clamped to +1.0
// ---------------------------------------------------------------------------

describe('mixPcm — positive overflow', () => {
  it('clamps sum above +1.0 to exactly +1.0', () => {
    const mic = f32(0.8)
    const loopback = f32(0.8)
    const result = mixPcm(mic, loopback)

    expect(result).toHaveLength(1)
    // 0.8 + 0.8 = 1.6, must clamp to 1.0
    expectSample(result, 0, 1.0)
  })

  it('clamps sum at exactly 1.0 to 1.0 (boundary, no clamp needed)', () => {
    const mic = f32(0.5)
    const loopback = f32(0.5)
    const result = mixPcm(mic, loopback)

    expectSample(result, 0, 1.0)
  })
})

// ---------------------------------------------------------------------------
// 4. Negative overflow clamped to -1.0
// ---------------------------------------------------------------------------

describe('mixPcm — negative overflow', () => {
  it('clamps sum below -1.0 to exactly -1.0', () => {
    const mic = f32(-0.8)
    const loopback = f32(-0.8)
    const result = mixPcm(mic, loopback)

    expect(result).toHaveLength(1)
    // -0.8 + -0.8 = -1.6, must clamp to -1.0
    expectSample(result, 0, -1.0)
  })
})

// ---------------------------------------------------------------------------
// 5. Length mismatch: zero-pad the shorter array
// ---------------------------------------------------------------------------

describe('mixPcm — length mismatch', () => {
  it('zero-pads loopback when mic is longer', () => {
    const mic = f32(0.4, 0.5, 0.6)
    const loopback = f32(0.1)
    const result = mixPcm(mic, loopback)

    // Output length equals the longer (mic)
    expect(result).toHaveLength(3)
    expectSample(result, 0, 0.5) // 0.4 + 0.1
    expectSample(result, 1, 0.5) // 0.5 + 0 (zero-padded)
    expectSample(result, 2, 0.6) // 0.6 + 0 (zero-padded)
  })

  it('zero-pads mic when loopback is longer', () => {
    const mic = f32(0.2)
    const loopback = f32(0.1, 0.3, 0.5)
    const result = mixPcm(mic, loopback)

    // Output length equals the longer (loopback)
    expect(result).toHaveLength(3)
    expectSample(result, 0, 0.3) // 0.2 + 0.1
    expectSample(result, 1, 0.3) // 0 + 0.3 (zero-padded mic)
    expectSample(result, 2, 0.5) // 0 + 0.5 (zero-padded mic)
  })
})

// ---------------------------------------------------------------------------
// 6. Custom gain applied to loopback
// ---------------------------------------------------------------------------

describe('mixPcm — custom gain', () => {
  it('scales loopback by loopbackGain before mixing', () => {
    const mic = f32(0.4)
    const loopback = f32(1.0) // full amplitude loopback
    const result = mixPcm(mic, loopback, { loopbackGain: 0.5 })

    // 0.4 + 1.0 * 0.5 = 0.9
    expect(result).toHaveLength(1)
    expectSample(result, 0, 0.9)
  })

  it('scales mic by micGain before mixing', () => {
    const mic = f32(1.0)
    const loopback = f32(0.2)
    const result = mixPcm(mic, loopback, { micGain: 0.5 })

    // 1.0 * 0.5 + 0.2 = 0.7
    expect(result).toHaveLength(1)
    expectSample(result, 0, 0.7)
  })

  it('clamps even after gain reduction if result still exceeds bounds', () => {
    const mic = f32(0.9)
    const loopback = f32(0.9)
    // With default gains, 0.9+0.9=1.8 → clamp 1.0
    const result = mixPcm(mic, loopback)
    expectSample(result, 0, 1.0)
  })
})

// ---------------------------------------------------------------------------
// 7. Empty loopback array treated like null (passthrough)
// ---------------------------------------------------------------------------

describe('mixPcm — empty loopback array', () => {
  it('treats zero-length loopback as absent (mic passthrough)', () => {
    const mic = f32(0.3, -0.4, 0.7)
    const loopback = new Float32Array(0)
    const result = mixPcm(mic, loopback)

    expect(result).toHaveLength(3)
    expectSample(result, 0, 0.3)
    expectSample(result, 1, -0.4)
    expectSample(result, 2, 0.7)
  })
})
