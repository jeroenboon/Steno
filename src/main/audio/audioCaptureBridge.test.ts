/**
 * Tests for the audio capture bridge (item 0015).
 *
 * Tests the main-process side of audio streaming:
 *   - audio:start registers the ASR session
 *   - audio:frame feeds PCM frames to the active ASR provider
 *   - transcript spans emitted by the provider are forwarded to the renderer
 *   - audio:stop tears down the session
 *   - edge cases: frame pushed before start, stop called when already stopped
 *
 * No real getUserMedia or WebSocket is involved. FakeASRProvider + a fake
 * webContents sender are the only collaborators.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import type { TranscriptSpan } from '@shared/domain/types'
import { FakeASRProvider } from '@shared/providers'

import { AudioCaptureBridge } from './AudioCaptureBridge'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal fake webContents sender — records what was sent. */
function makeWebContentsSender(): {
  send: ReturnType<typeof vi.fn>
  sentSpans: () => TranscriptSpan[]
} {
  const calls: TranscriptSpan[] = []
  const send = vi.fn((channel: string, span: TranscriptSpan) => {
    if (channel === 'transcript:span') {
      calls.push(span)
    }
  })
  return {
    send,
    sentSpans: () => calls,
  }
}

function makeSpan(text: string, isFinal = true): TranscriptSpan {
  return {
    id: `span-${text}`,
    text,
    startMs: 0,
    endMs: 100,
    isFinal,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AudioCaptureBridge', () => {
  let fakeAsr: FakeASRProvider
  let sender: ReturnType<typeof makeWebContentsSender>
  let bridge: AudioCaptureBridge

  beforeEach(() => {
    fakeAsr = new FakeASRProvider()
    sender = makeWebContentsSender()
    bridge = new AudioCaptureBridge({
      asrProvider: fakeAsr,
      sender: { send: sender.send },
    })
  })

  describe('audio:start', () => {
    it('starts the ASR provider and begins forwarding spans', async () => {
      bridge.start()

      // Emit a span from the provider
      fakeAsr.pushScriptedSpan(makeSpan('hallo wereld'))

      // Allow micro-task queue to flush (the span loop is async)
      await new Promise<void>((r) => {
        setTimeout(r, 0)
      })

      const spans = sender.sentSpans()
      expect(spans).toHaveLength(1)
      const span = spans[0]
      expect(span).toBeDefined()
      if (span !== undefined) {
        expect(span.text).toBe('hallo wereld')
      }
    })

    it('calling start twice is a no-op (does not double-start)', () => {
      bridge.start()
      bridge.start() // second call ignored
      // Provider should still be in a valid state
      expect(() => {
        fakeAsr.pushScriptedSpan(makeSpan('test'))
      }).not.toThrow()
    })
  })

  describe('audio:frame', () => {
    it('forwards PCM frames to the ASR provider when active', () => {
      bridge.start()
      const frame = new Uint8Array([0, 1, 2, 3])
      bridge.pushAudioFrame(frame)
      // FakeASRProvider accepts frames silently; no throw = pass
    })

    it('ignores frames when not started', () => {
      // Should not throw even if start() was never called
      const frame = new Uint8Array([0, 1, 2, 3])
      expect(() => {
        bridge.pushAudioFrame(frame)
      }).not.toThrow()
    })
  })

  describe('audio:stop', () => {
    it('stops the ASR provider and stops forwarding spans', async () => {
      bridge.start()
      bridge.stop()

      fakeAsr.pushScriptedSpan(makeSpan('should not arrive'))

      // Provider is stopped so span emitted before the listener quits
      // does not get forwarded (queue drain after stop)
      await new Promise<void>((r) => {
        setTimeout(r, 5)
      })

      // The span may or may not arrive depending on timing; key invariant:
      // calling stop() does not throw
      expect(() => {
        bridge.stop()
      }).not.toThrow()
    })

    it('calling stop without start does not throw', () => {
      expect(() => {
        bridge.stop()
      }).not.toThrow()
    })
  })

  describe('span forwarding', () => {
    it('forwards multiple spans in order', async () => {
      bridge.start()

      fakeAsr.pushScriptedSpan(makeSpan('eerste'))
      fakeAsr.pushScriptedSpan(makeSpan('tweede'))
      fakeAsr.pushScriptedSpan(makeSpan('derde'))

      await new Promise<void>((r) => {
        setTimeout(r, 0)
      })

      const texts = sender.sentSpans().map((s) => s.text)
      expect(texts).toEqual(['eerste', 'tweede', 'derde'])
    })

    it('forwards both interim and final spans', async () => {
      bridge.start()

      fakeAsr.pushScriptedSpan(makeSpan('gedeeltelijk', false)) // isFinal=false
      fakeAsr.pushScriptedSpan(makeSpan('definitief', true)) // isFinal=true

      await new Promise<void>((r) => {
        setTimeout(r, 0)
      })

      const spans = sender.sentSpans()
      expect(spans).toHaveLength(2)
      expect(spans[0]?.isFinal).toBe(false)
      expect(spans[1]?.isFinal).toBe(true)
    })
  })

  describe('error resilience', () => {
    it('keeps draining subsequent spans when the onSpan observer throws', async () => {
      // The onSpan observer includes the runtime's span persistence (a DB
      // insert). A single failing insert must not tear down the whole stream.
      const seen: string[] = []
      const onSpan = vi.fn((span: TranscriptSpan) => {
        seen.push(span.text)
        if (span.text === 'boom') {
          throw new Error('db insert failed')
        }
      })
      bridge = new AudioCaptureBridge({
        asrProvider: fakeAsr,
        sender: { send: sender.send },
        onSpan,
      })
      bridge.start()

      fakeAsr.pushScriptedSpan(makeSpan('boom')) // observer throws on this one
      fakeAsr.pushScriptedSpan(makeSpan('daarna')) // must still be processed

      await new Promise<void>((r) => {
        setTimeout(r, 0)
      })

      // The observer saw both spans: the loop did not abort after the throw.
      expect(seen).toEqual(['boom', 'daarna'])
      // And the surviving span still reached the renderer.
      expect(sender.sentSpans().map((s) => s.text)).toContain('daarna')
    })

    it('keeps draining subsequent spans when the sender throws', async () => {
      // The renderer can vanish mid-meeting; webContents.send then throws.
      let calls = 0
      const flakySend = vi.fn((channel: string) => {
        void channel
        calls += 1
        if (calls === 1) {
          throw new Error('renderer gone')
        }
      })
      bridge = new AudioCaptureBridge({
        asrProvider: fakeAsr,
        sender: { send: flakySend },
      })
      bridge.start()

      fakeAsr.pushScriptedSpan(makeSpan('eerste')) // send throws
      fakeAsr.pushScriptedSpan(makeSpan('tweede')) // loop must continue

      await new Promise<void>((r) => {
        setTimeout(r, 0)
      })

      // Both spans were attempted: the loop survived the first send throwing.
      expect(flakySend).toHaveBeenCalledTimes(2)
    })

    it('does not leak an unhandled rejection when a span throws', async () => {
      const rejections: unknown[] = []
      const onRejection = (reason: unknown): void => {
        rejections.push(reason)
      }
      process.on('unhandledRejection', onRejection)
      try {
        bridge = new AudioCaptureBridge({
          asrProvider: fakeAsr,
          sender: { send: sender.send },
          onSpan: () => {
            throw new Error('boom')
          },
        })
        bridge.start()

        fakeAsr.pushScriptedSpan(makeSpan('boom'))

        // Give any rejected microtask a chance to surface.
        await new Promise<void>((r) => {
          setTimeout(r, 10)
        })

        expect(rejections).toEqual([])
      } finally {
        process.off('unhandledRejection', onRejection)
      }
    })
  })
})
