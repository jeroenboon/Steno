/**
 * @vitest-environment node
 *
 * Tests for the PCM frame guard (audit S3).
 *
 * The one-way renderer→main channels (audio:frame / import:frame) carry raw
 * binary PCM. A parameter annotation is a compile-time claim, not a runtime
 * check. This pure predicate is the cheap runtime guard (type + max-length)
 * both channels share — no per-frame Zod (ADR 0013 trade-off).
 */

import { describe, expect, it } from 'vitest'

import { MAX_PCM_FRAME_BYTES, isValidPcmFrame } from './pcmFrameGuard'

// A legitimate frame is 4096 Int16 samples × 2 bytes = 8192 bytes.
const LEGIT_FRAME_BYTES = 4096 * 2

describe('isValidPcmFrame', () => {
  it('accepts a legitimately-sized Uint8Array frame', () => {
    expect(isValidPcmFrame(new Uint8Array(LEGIT_FRAME_BYTES))).toBe(true)
  })

  it('accepts a Buffer (Uint8Array subclass Electron may deliver)', () => {
    expect(isValidPcmFrame(Buffer.alloc(LEGIT_FRAME_BYTES))).toBe(true)
  })

  it('accepts a frame at exactly the cap', () => {
    expect(isValidPcmFrame(new Uint8Array(MAX_PCM_FRAME_BYTES))).toBe(true)
  })

  it('rejects a frame one byte over the cap', () => {
    expect(isValidPcmFrame(new Uint8Array(MAX_PCM_FRAME_BYTES + 1))).toBe(false)
  })

  it('rejects a wrong-type payload (string)', () => {
    expect(isValidPcmFrame('not a frame')).toBe(false)
  })

  it('rejects a wrong-type payload (plain object)', () => {
    expect(isValidPcmFrame({ length: 8192 })).toBe(false)
  })

  it('rejects a bare ArrayBuffer (not a typed-array view)', () => {
    expect(isValidPcmFrame(new ArrayBuffer(LEGIT_FRAME_BYTES))).toBe(false)
  })

  it('rejects null and undefined', () => {
    expect(isValidPcmFrame(null)).toBe(false)
    expect(isValidPcmFrame(undefined)).toBe(false)
  })

  it('honours a custom maxBytes argument', () => {
    expect(isValidPcmFrame(new Uint8Array(9), 8)).toBe(false)
    expect(isValidPcmFrame(new Uint8Array(8), 8)).toBe(true)
  })

  it('caps generously above a legitimate frame', () => {
    // Sanity: the cap must never reject a real frame.
    expect(MAX_PCM_FRAME_BYTES).toBeGreaterThan(LEGIT_FRAME_BYTES)
  })
})
