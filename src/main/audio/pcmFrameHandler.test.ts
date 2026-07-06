/**
 * @vitest-environment node
 *
 * Tests for the PCM frame boundary handler (audit S3).
 *
 * Drives the guard exactly as the ipcMain.on('audio:frame' / 'import:frame')
 * boundary does, without real Electron IPC. A malformed or over-cap payload is
 * DROPPED (never forwarded to the sink) and devlogged; a bad frame must not
 * throw or crash main mid-meeting. A legitimate frame passes through unchanged.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { MAX_PCM_FRAME_BYTES } from '@shared/audio/pcmFrameGuard'

import { initDevlog, resetDevlog, type DevlogConfig } from '../devlog'

import { createPcmFrameHandler } from './pcmFrameHandler'

afterEach(() => {
  resetDevlog()
})

interface ParsedLine {
  category: string
  event: string
  meta?: Record<string, unknown>
}

function collector(): { lines: string[]; config: DevlogConfig } {
  const lines: string[] = []
  const config: DevlogConfig = {
    enabled: true,
    includeContent: false,
    write: (line) => lines.push(line),
    now: () => 0,
  }
  return { lines, config }
}

function parse(line: string | undefined): ParsedLine {
  return JSON.parse(line ?? '{}') as ParsedLine
}

describe('createPcmFrameHandler', () => {
  it('forwards a valid frame to the sink unchanged', () => {
    const sink = vi.fn()
    const handle = createPcmFrameHandler({ sink, channel: 'audio:frame' })
    const frame = new Uint8Array([0, 1, 2, 3])

    handle(frame)

    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith(frame)
  })

  it('drops a wrong-type payload and devlogs (never reaches the sink)', () => {
    const { lines, config } = collector()
    initDevlog(config)
    const sink = vi.fn()
    const handle = createPcmFrameHandler({ sink, channel: 'audio:frame' })

    handle('not a frame')

    expect(sink).not.toHaveBeenCalled()
    expect(lines).toHaveLength(1)
    const parsed = parse(lines[0])
    expect(parsed.category).toBe('audio')
    expect(parsed.event).toBe('frame-rejected')
    expect(parsed.meta?.channel).toBe('audio:frame')
  })

  it('drops an over-cap payload and devlogs (never reaches the sink)', () => {
    const { lines, config } = collector()
    initDevlog(config)
    const sink = vi.fn()
    const handle = createPcmFrameHandler({ sink, channel: 'import:frame' })

    handle(new Uint8Array(MAX_PCM_FRAME_BYTES + 1))

    expect(sink).not.toHaveBeenCalled()
    expect(lines).toHaveLength(1)
    const parsed = parse(lines[0])
    expect(parsed.event).toBe('frame-rejected')
    expect(parsed.meta?.channel).toBe('import:frame')
    expect(parsed.meta?.byteLength).toBe(MAX_PCM_FRAME_BYTES + 1)
  })

  it('does not throw on an invalid payload (a bad frame must not crash main)', () => {
    const sink = vi.fn()
    const handle = createPcmFrameHandler({ sink, channel: 'audio:frame' })

    expect(() => {
      handle(undefined)
    }).not.toThrow()
    expect(sink).not.toHaveBeenCalled()
  })
})
