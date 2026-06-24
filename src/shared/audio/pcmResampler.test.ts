/**
 * Tests for resamplePcm16 — Int16 PCM rate conversion for realtime ASR.
 *
 * The renderer emits PCM at CAPTURE_SAMPLE_RATE (16 kHz). Some realtime ASR
 * vendors (OpenAI/Azure Realtime) expect a different rate (24 kHz), so the
 * adapter resamples before sending. Sending 16 kHz samples labelled as 24 kHz
 * would speed up and raise the pitch — wrong transcription.
 */

import { describe, expect, it } from 'vitest'

import { CAPTURE_SAMPLE_RATE, resamplePcm16 } from './pcmResampler'

/** Build a Uint8Array of Int16 LE samples. */
function pcm(samples: number[]): Uint8Array {
  const out = new Uint8Array(samples.length * 2)
  const view = new DataView(out.buffer)
  samples.forEach((s, i) => {
    view.setInt16(i * 2, s, true)
  })
  return out
}

/** Read a Uint8Array back into Int16 LE samples. */
function samplesOf(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: number[] = []
  for (let i = 0; i < bytes.byteLength / 2; i++) out.push(view.getInt16(i * 2, true))
  return out
}

describe('resamplePcm16', () => {
  it('exposes the capture rate as 16 kHz', () => {
    expect(CAPTURE_SAMPLE_RATE).toBe(16_000)
  })

  it('returns the input unchanged when the rates are equal', () => {
    const input = pcm([100, 200, 300, 400])
    const out = resamplePcm16(input, 16_000, 16_000)
    expect(samplesOf(out)).toEqual([100, 200, 300, 400])
  })

  it('upsamples 16 kHz to 24 kHz by the 3:2 ratio', () => {
    // 4 input samples → round(4 * 24/16) = 6 output samples.
    const input = pcm([0, 0, 0, 0])
    const out = resamplePcm16(input, 16_000, 24_000)
    expect(samplesOf(out)).toHaveLength(6)
  })

  it('preserves a constant signal across upsampling', () => {
    const input = pcm([1000, 1000, 1000, 1000])
    const out = resamplePcm16(input, 16_000, 24_000)
    for (const s of samplesOf(out)) expect(s).toBe(1000)
  })

  it('linearly interpolates between samples', () => {
    // Two samples 0 and 100 at 16 kHz → 3 samples at 24 kHz; the middle one
    // lands at source position 0.666… ⇒ ~67.
    const out = resamplePcm16(pcm([0, 100]), 16_000, 24_000)
    const s = samplesOf(out)
    expect(s).toHaveLength(3)
    expect(s[0]).toBe(0)
    expect(s[1]).toBeGreaterThan(50)
    expect(s[1]).toBeLessThan(100)
  })

  it('returns an empty buffer for empty input', () => {
    expect(resamplePcm16(new Uint8Array(0), 16_000, 24_000).byteLength).toBe(0)
  })
})
