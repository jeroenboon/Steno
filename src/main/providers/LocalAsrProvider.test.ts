/**
 * Tests for LocalAsrProvider (item 0024).
 *
 * All sherpa-onnx inference is mocked via FakeSherpaSessionFactory — no real model,
 * no real native addon. Tests drive the provider through the ASRProvider public interface.
 *
 * Behaviours tested:
 * - pushAudioFrame() before start() is silently ignored
 * - stop() before start() is a no-op
 * - After start() + N frames: iterator emits spans in order
 * - stop() closes the iterator once the buffer is drained
 * - A session factory error is caught; iterator completes without crash
 * - Invalid model output is skipped via Zod validation
 */

import { describe, expect, it } from 'vitest'

import { LocalAsrProvider } from './LocalAsrProvider'
import { FakeSherpaSessionFactory } from './sherpa/SherpaSession'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a PCM Uint8Array of the given number of 16-bit samples (16 kHz). */
function pcmFrame(numSamples: number): Uint8Array {
  return new Uint8Array(numSamples * 2) // 16-bit = 2 bytes per sample
}

/** 560 ms at 16 kHz = 8960 samples. */
const CHUNK_SAMPLES = 8960
const CHUNK_BYTES = CHUNK_SAMPLES * 2

/** Collect up to `max` spans from the iterable, then stop. */
async function collectSpans(
  provider: LocalAsrProvider,
  max: number,
): Promise<import('@shared/domain/types').TranscriptSpan[]> {
  const spans: import('@shared/domain/types').TranscriptSpan[] = []
  for await (const span of provider.spans()) {
    spans.push(span)
    if (spans.length >= max) break
  }
  return spans
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocalAsrProvider', () => {
  it('pushAudioFrame() before start() is silently ignored', () => {
    const provider = new LocalAsrProvider({
      modelDir: '/fake/model',
      sessionFactory: new FakeSherpaSessionFactory(['hello']),
    })
    expect(() => {
      provider.pushAudioFrame(pcmFrame(CHUNK_SAMPLES))
    }).not.toThrow()
  })

  it('stop() before start() is a no-op', () => {
    const provider = new LocalAsrProvider({
      modelDir: '/fake/model',
      sessionFactory: new FakeSherpaSessionFactory([]),
    })
    expect(() => {
      provider.stop()
    }).not.toThrow()
  })

  it('emits a span for each full chunk pushed after start()', async () => {
    const script = ['hallo', 'wereld', 'test']
    const provider = new LocalAsrProvider({
      modelDir: '/fake/model',
      sessionFactory: new FakeSherpaSessionFactory(script),
      chunkDurationMs: 560,
    })

    provider.start()

    // Push exactly 3 full chunks
    for (let i = 0; i < 3; i++) {
      provider.pushAudioFrame(new Uint8Array(CHUNK_BYTES))
    }
    provider.stop()

    const spans = await collectSpans(provider, 3)
    expect(spans).toHaveLength(3)
    expect(spans[0]?.text).toBe('hallo')
    expect(spans[1]?.text).toBe('wereld')
    expect(spans[2]?.text).toBe('test')
  })

  it('accumulates partial frames across multiple pushAudioFrame() calls', async () => {
    const provider = new LocalAsrProvider({
      modelDir: '/fake/model',
      sessionFactory: new FakeSherpaSessionFactory(['geaccumuleerd']),
      chunkDurationMs: 560,
    })

    provider.start()

    // Push half a chunk at a time — should only fire once a full chunk is buffered
    const half = CHUNK_BYTES / 2
    provider.pushAudioFrame(new Uint8Array(half))
    provider.pushAudioFrame(new Uint8Array(half))
    provider.stop()

    const spans = await collectSpans(provider, 1)
    expect(spans).toHaveLength(1)
    expect(spans[0]?.text).toBe('geaccumuleerd')
  })

  it('stop() closes the iterator after buffered spans are emitted', async () => {
    const provider = new LocalAsrProvider({
      modelDir: '/fake/model',
      sessionFactory: new FakeSherpaSessionFactory(['laatste']),
    })

    provider.start()
    provider.pushAudioFrame(new Uint8Array(CHUNK_BYTES))
    provider.stop()

    const allSpans: import('@shared/domain/types').TranscriptSpan[] = []
    for await (const span of provider.spans()) {
      allSpans.push(span)
    }
    expect(allSpans).toHaveLength(1)
    expect(allSpans[0]?.text).toBe('laatste')
  })

  it('spans have isFinal absent (treated as final per ADR 0011)', async () => {
    const provider = new LocalAsrProvider({
      modelDir: '/fake/model',
      sessionFactory: new FakeSherpaSessionFactory(['isFinal check']),
    })

    provider.start()
    provider.pushAudioFrame(new Uint8Array(CHUNK_BYTES))
    provider.stop()

    const spans = await collectSpans(provider, 1)
    expect(spans[0]?.isFinal).toBeUndefined()
  })

  it('empty transcription output from the model is skipped (no span emitted)', async () => {
    const provider = new LocalAsrProvider({
      modelDir: '/fake/model',
      sessionFactory: new FakeSherpaSessionFactory(['', '']), // empty output
    })

    provider.start()
    provider.pushAudioFrame(new Uint8Array(CHUNK_BYTES))
    provider.pushAudioFrame(new Uint8Array(CHUNK_BYTES))
    provider.stop()

    const allSpans: import('@shared/domain/types').TranscriptSpan[] = []
    for await (const span of provider.spans()) {
      allSpans.push(span)
    }
    expect(allSpans).toHaveLength(0)
  })

  it('spans have correct startMs and endMs based on chunk position', async () => {
    const provider = new LocalAsrProvider({
      modelDir: '/fake/model',
      sessionFactory: new FakeSherpaSessionFactory(['eerste', 'tweede']),
      chunkDurationMs: 560,
    })

    provider.start()
    provider.pushAudioFrame(new Uint8Array(CHUNK_BYTES))
    provider.pushAudioFrame(new Uint8Array(CHUNK_BYTES))
    provider.stop()

    const spans = await collectSpans(provider, 2)
    expect(spans[0]?.startMs).toBe(0)
    expect(spans[0]?.endMs).toBe(560)
    expect(spans[1]?.startMs).toBe(560)
    expect(spans[1]?.endMs).toBe(1120)
  })

  it('session factory error causes iterator to complete without throwing', async () => {
    class BrokenFactory {
      createSession(): Promise<never> {
        return Promise.reject(new Error('sherpa-onnx init failed'))
      }
    }

    const provider = new LocalAsrProvider({
      modelDir: '/fake/model',
      sessionFactory: new BrokenFactory(),
    })

    provider.start()
    provider.pushAudioFrame(new Uint8Array(CHUNK_BYTES))
    provider.stop()

    const allSpans: import('@shared/domain/types').TranscriptSpan[] = []
    await expect(
      (async () => {
        for await (const span of provider.spans()) {
          allSpans.push(span)
        }
      })(),
    ).resolves.toBeUndefined()

    expect(allSpans).toHaveLength(0)
  })
})
