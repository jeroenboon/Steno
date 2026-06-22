/**
 * Tests for AudioFileImportService (item 0026).
 *
 * The Web Audio decoder is injected, so jsdom needs no real decodeAudioData: the
 * test feeds a known decoded buffer and asserts the renderer-owned pipeline:
 * stereo is downmixed to mono, resampled to 16 kHz and chunked into Int16 frames
 * via PcmFramer, frames are streamed in order between importStart and
 * importFinish, and progress runs to completion.
 */

import { describe, expect, it, vi } from 'vitest'

import { AudioFileImportService, type DecodedAudio } from './AudioFileImportService'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApi() {
  const order: string[] = []
  const frames: Uint8Array[] = []
  return {
    order,
    frames,
    importStart: vi.fn(() => {
      order.push('start')
      return Promise.resolve({ meetingId: 'imp-1' })
    }),
    importSendFrame: vi.fn((frame: Uint8Array) => {
      frames.push(frame)
      order.push('frame')
    }),
    importFinish: vi.fn((req: { meetingId: string }) => {
      order.push('finish')
      return Promise.resolve({ meetingId: req.meetingId })
    }),
  }
}

const startReq = {
  title: 'Geïmporteerde opname',
  primaryLanguage: 'nl',
  agendaItems: [],
  participants: [],
  inferContext: true,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AudioFileImportService', () => {
  it('starts the import, streams frames, then finishes — in that order', async () => {
    const api = makeApi()
    // 32 kHz stereo, 16384 samples/channel → after mono downmix + resample to
    // 16 kHz → 8192 samples → exactly 2 frames of 4096.
    const left = new Float32Array(16384).fill(1)
    const right = new Float32Array(16384).fill(-1)
    const decoded: DecodedAudio = { channelData: [left, right], sampleRate: 32000 }

    const service = new AudioFileImportService({
      api,
      decoder: () => Promise.resolve(decoded),
    })

    const meetingId = await service.streamFile(new ArrayBuffer(8), startReq)

    expect(meetingId).toBe('imp-1')
    expect(api.importStart).toHaveBeenCalledTimes(1)
    expect(api.importStart).toHaveBeenCalledWith(startReq)
    expect(api.importFinish).toHaveBeenCalledWith({ meetingId: 'imp-1' })

    // Ordering: start first, finish last, ≥1 frame in between.
    expect(api.order[0]).toBe('start')
    expect(api.order[api.order.length - 1]).toBe('finish')
    expect(api.order.filter((o) => o === 'frame').length).toBeGreaterThan(0)
  })

  it('downmixes stereo to mono by averaging the channels', async () => {
    const api = makeApi()
    // left = +1, right = -1 → mono average = 0 → every Int16 sample is 0.
    const left = new Float32Array(16384).fill(1)
    const right = new Float32Array(16384).fill(-1)
    const decoded: DecodedAudio = { channelData: [left, right], sampleRate: 32000 }

    const service = new AudioFileImportService({
      api,
      decoder: () => Promise.resolve(decoded),
    })

    await service.streamFile(new ArrayBuffer(8), startReq)

    expect(api.frames.length).toBeGreaterThan(0)
    for (const frame of api.frames) {
      expect(frame.every((byte) => byte === 0)).toBe(true)
    }
  })

  it('reports progress that ends at 1', async () => {
    const api = makeApi()
    const mono = new Float32Array(16000).fill(0)
    const decoded: DecodedAudio = { channelData: [mono], sampleRate: 16000 }

    const service = new AudioFileImportService({
      api,
      decoder: () => Promise.resolve(decoded),
    })

    const progress: number[] = []
    await service.streamFile(new ArrayBuffer(8), startReq, {
      onProgress: (fraction) => progress.push(fraction),
    })

    expect(progress.length).toBeGreaterThan(0)
    expect(progress[progress.length - 1]).toBe(1)
    // Progress is monotonic non-decreasing and bounded to [0, 1].
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1] ?? 0)
      expect(progress[i]).toBeLessThanOrEqual(1)
    }
  })

  it('handles a mono file without a downmix step', async () => {
    const api = makeApi()
    const mono = new Float32Array(16384).fill(0.5)
    const decoded: DecodedAudio = { channelData: [mono], sampleRate: 16000 }

    const service = new AudioFileImportService({
      api,
      decoder: () => Promise.resolve(decoded),
    })

    await service.streamFile(new ArrayBuffer(8), startReq)

    // 16384 mono samples at 16 kHz (no resample) → exactly 4 frames of 4096.
    expect(api.importSendFrame).toHaveBeenCalledTimes(4)
  })
})
