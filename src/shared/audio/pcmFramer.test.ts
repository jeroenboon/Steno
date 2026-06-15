/**
 * Tests for the pure PCM framing / resampling / float→int16 conversion logic.
 *
 * Everything here runs in Node without a browser or AudioWorklet.
 * The module under test is a pure function with no side-effects.
 */

import { describe, it, expect } from 'vitest'

import { PcmFramer, type PcmFramerOptions } from './pcmFramer'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Generate a simple sine wave as Float32 samples in [-1, +1]. */
function makeSine(numSamples: number, frequency = 440, sampleRate = 48_000): Float32Array {
  const buf = new Float32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    buf[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate)
  }
  return buf
}

/** Collect all complete frames emitted for the given input. */
function collectFrames(framer: PcmFramer, input: Float32Array): Uint8Array[] {
  const frames: Uint8Array[] = []
  framer.push(input, (frame) => {
    frames.push(frame)
  })
  return frames
}

/** Read the first Int16 sample from a PCM frame (little-endian). */
function firstInt16(frame: Uint8Array): number {
  const view = new DataView(frame.buffer, frame.byteOffset)
  return view.getInt16(0, true)
}

// ---------------------------------------------------------------------------
// float → int16 conversion
// ---------------------------------------------------------------------------

describe('float32 → int16 conversion', () => {
  const opts: PcmFramerOptions = {
    sourceSampleRate: 48_000,
    targetSampleRate: 16_000,
    frameSize: 512,
  }

  it('converts 0.0 to 0', () => {
    const framer = new PcmFramer(opts)
    const silent = new Float32Array(opts.frameSize * 3).fill(0)
    const frames: Uint8Array[] = []
    framer.push(silent, (f) => frames.push(f))
    // All bytes should be zero
    for (const frame of frames) {
      const view = new DataView(frame.buffer, frame.byteOffset)
      for (let i = 0; i < frame.byteLength; i += 2) {
        expect(view.getInt16(i, true)).toBe(0)
      }
    }
  })

  it('converts +1.0 to 32767 (max positive int16)', () => {
    const framer = new PcmFramer({ ...opts, sourceSampleRate: 16_000, frameSize: 1 })
    // Feed exactly one resampled sample worth of data
    // At 1:1 rate, one Float32 sample = one Int16 sample = 2 bytes
    const buf = new Float32Array(1)
    buf[0] = 1.0
    const frames = collectFrames(framer, buf)
    expect(frames).toHaveLength(1)
    const frame = frames[0]
    expect(frame).toBeDefined()
    if (frame !== undefined) {
      expect(firstInt16(frame)).toBe(32767)
    }
  })

  it('converts -1.0 to -32768 (min negative int16)', () => {
    const framer = new PcmFramer({ ...opts, sourceSampleRate: 16_000, frameSize: 1 })
    const buf = new Float32Array(1)
    buf[0] = -1.0
    const frames = collectFrames(framer, buf)
    expect(frames).toHaveLength(1)
    const frame = frames[0]
    expect(frame).toBeDefined()
    if (frame !== undefined) {
      expect(firstInt16(frame)).toBe(-32768)
    }
  })

  it('clamps values above +1.0 to 32767', () => {
    const framer = new PcmFramer({ ...opts, sourceSampleRate: 16_000, frameSize: 1 })
    const buf = new Float32Array(1)
    buf[0] = 2.5
    const frames = collectFrames(framer, buf)
    const frame = frames[0]
    expect(frame).toBeDefined()
    if (frame !== undefined) {
      expect(firstInt16(frame)).toBe(32767)
    }
  })

  it('clamps values below -1.0 to -32768', () => {
    const framer = new PcmFramer({ ...opts, sourceSampleRate: 16_000, frameSize: 1 })
    const buf = new Float32Array(1)
    buf[0] = -2.5
    const frames = collectFrames(framer, buf)
    const frame = frames[0]
    expect(frame).toBeDefined()
    if (frame !== undefined) {
      expect(firstInt16(frame)).toBe(-32768)
    }
  })
})

// ---------------------------------------------------------------------------
// fixed-size framing
// ---------------------------------------------------------------------------

describe('fixed-size framing', () => {
  const FRAME_SIZE = 256 // samples (not bytes)
  const opts: PcmFramerOptions = {
    sourceSampleRate: 16_000,
    targetSampleRate: 16_000,
    frameSize: FRAME_SIZE,
  }

  it('emits one frame when exactly one frame worth of samples is pushed', () => {
    const framer = new PcmFramer(opts)
    const input = makeSine(FRAME_SIZE, 440, 16_000)
    const frames = collectFrames(framer, input)
    expect(frames).toHaveLength(1)
    // Frame size in bytes = 2 bytes per Int16 sample
    const frame = frames[0]
    expect(frame).toBeDefined()
    if (frame !== undefined) {
      expect(frame.byteLength).toBe(FRAME_SIZE * 2)
    }
  })

  it('emits two frames when two frame-lengths of samples are pushed at once', () => {
    const framer = new PcmFramer(opts)
    const input = makeSine(FRAME_SIZE * 2, 440, 16_000)
    const frames = collectFrames(framer, input)
    expect(frames).toHaveLength(2)
  })

  it('buffers a partial trailing chunk and does NOT emit it as a frame', () => {
    const framer = new PcmFramer(opts)
    // Push 1.5 frames worth — expect exactly 1 complete frame
    const input = makeSine(Math.floor(FRAME_SIZE * 1.5), 440, 16_000)
    const frames = collectFrames(framer, input)
    expect(frames).toHaveLength(1)
  })

  it('emits the second frame when the buffered partial is completed by a later push', () => {
    const framer = new PcmFramer(opts)
    const half = FRAME_SIZE / 2

    // First push: half a frame — no frames yet
    const frames1 = collectFrames(framer, makeSine(half, 440, 16_000))
    expect(frames1).toHaveLength(0)

    // Second push: another half frame — now a complete frame
    const frames2 = collectFrames(framer, makeSine(half, 440, 16_000))
    expect(frames2).toHaveLength(1)
    const frame2 = frames2[0]
    expect(frame2).toBeDefined()
    if (frame2 !== undefined) {
      expect(frame2.byteLength).toBe(FRAME_SIZE * 2)
    }
  })

  it('emits no frames when an empty buffer is pushed', () => {
    const framer = new PcmFramer(opts)
    const frames = collectFrames(framer, new Float32Array(0))
    expect(frames).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// resampling
// ---------------------------------------------------------------------------

describe('resampling', () => {
  it('down-samples 48 kHz to 16 kHz (3:1 ratio)', () => {
    // Push exactly 3 × frameSize samples at 48 kHz.
    // After downsampling 3:1 we expect exactly 1 × frameSize target samples.
    const FRAME_SIZE = 128
    const opts: PcmFramerOptions = {
      sourceSampleRate: 48_000,
      targetSampleRate: 16_000,
      frameSize: FRAME_SIZE,
    }
    const framer = new PcmFramer(opts)
    // 3 × FRAME_SIZE source samples → 1 × FRAME_SIZE target samples → 1 frame
    const input = makeSine(3 * FRAME_SIZE, 440, 48_000)
    const frames = collectFrames(framer, input)
    expect(frames).toHaveLength(1)
    const frame = frames[0]
    expect(frame).toBeDefined()
    if (frame !== undefined) {
      expect(frame.byteLength).toBe(FRAME_SIZE * 2)
    }
  })

  it('down-samples 44.1 kHz to 16 kHz (non-integer ratio)', () => {
    // 44100 → 16000 ratio ≈ 2.75625.
    // Push 44100 source samples. Expected target samples = 16000.
    const FRAME_SIZE = 4096
    const SOURCE_RATE = 44_100
    const TARGET_RATE = 16_000
    const opts: PcmFramerOptions = {
      sourceSampleRate: SOURCE_RATE,
      targetSampleRate: TARGET_RATE,
      frameSize: FRAME_SIZE,
    }
    const framer = new PcmFramer(opts)

    // Push one second worth of 44.1 kHz audio; expect ~3 full frames (each 4096
    // samples × 2 bytes = 8192 bytes). 16000 / 4096 = 3 full frames + 3712 leftover.
    const input = makeSine(SOURCE_RATE, 440, SOURCE_RATE)
    const frames = collectFrames(framer, input)
    expect(frames).toHaveLength(3)
  })

  it('passes through 16 kHz → 16 kHz without distortion', () => {
    const FRAME_SIZE = 64
    const opts: PcmFramerOptions = {
      sourceSampleRate: 16_000,
      targetSampleRate: 16_000,
      frameSize: FRAME_SIZE,
    }
    const framer = new PcmFramer(opts)
    // A buffer of known values
    const input = new Float32Array(FRAME_SIZE)
    input.fill(0.5)
    const frames = collectFrames(framer, input)
    expect(frames).toHaveLength(1)
    const frame = frames[0]
    expect(frame).toBeDefined()
    if (frame !== undefined) {
      const firstSample = firstInt16(frame)
      // 0.5 × 32768 = 16384 (floor) — positive range uses 32768 as multiplier
      expect(firstSample).toBe(16384)
    }
  })
})

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe('PcmFramer.reset()', () => {
  it('clears the internal buffer so partial frames are discarded', () => {
    const FRAME_SIZE = 128
    const framer = new PcmFramer({
      sourceSampleRate: 16_000,
      targetSampleRate: 16_000,
      frameSize: FRAME_SIZE,
    })

    // Push half a frame
    collectFrames(framer, new Float32Array(FRAME_SIZE / 2))

    framer.reset()

    // Push half a frame again — should still produce no output because buffer was cleared
    const frames = collectFrames(framer, new Float32Array(FRAME_SIZE / 2))
    expect(frames).toHaveLength(0)
  })
})
