/**
 * FakeASRProvider — deterministic in-memory ASR for tests.
 *
 * Tests push scripted TranscriptSpans via pushScriptedSpan(); the spans()
 * iterator yields them in order. No real audio processing happens.
 * Satisfies the ASRProvider interface structurally.
 */

import type { TranscriptSpan } from '../domain/types'

import type { ASRProvider } from './ASRProvider'

type SpanResolver = (value: IteratorResult<TranscriptSpan>) => void

/** Sentinel result marking the iterator as complete. */
const DONE: IteratorReturnResult<undefined> = { value: undefined, done: true }

export class FakeASRProvider implements ASRProvider {
  private _stopped = false
  private _queue: TranscriptSpan[] = []
  // Resolvers waiting for the next span to arrive
  private _waiters: SpanResolver[] = []
  // Batch transcription (item 0026)
  private _batchSpans: TranscriptSpan[] = []
  private _batchCalls: Uint8Array[] = []

  start(): void {
    this._stopped = false
  }

  stop(): void {
    this._stopped = true
    // Drain any waiters with done=true so the iterator completes
    for (const resolve of this._waiters) {
      resolve(DONE)
    }
    this._waiters = []
  }

  /** Feed a raw PCM frame — ignored in the fake, but accepted without error. */
  pushAudioFrame(chunk: Uint8Array): void {
    void chunk // explicitly discarded: the fake doesn't process real audio
  }

  /**
   * Enqueue a scripted span to be emitted by the spans() iterator.
   * Can be called before or after start().
   */
  pushScriptedSpan(span: TranscriptSpan): void {
    const waiter = this._waiters.shift()
    if (waiter !== undefined) {
      // Someone is already waiting — deliver immediately
      waiter({ value: span, done: false })
    } else {
      this._queue.push(span)
    }
  }

  /** How many scripted spans are waiting to be consumed. */
  pendingCount(): number {
    return this._queue.length
  }

  /** Script the spans returned by transcribeBatch(). */
  scriptBatchSpans(spans: TranscriptSpan[]): void {
    this._batchSpans = spans
  }

  /** Returns the PCM buffers passed to transcribeBatch(), in order. */
  batchCalls(): readonly Uint8Array[] {
    return this._batchCalls
  }

  transcribeBatch(pcm: Uint8Array): Promise<TranscriptSpan[]> {
    this._batchCalls.push(pcm)
    return Promise.resolve(this._batchSpans)
  }

  spans(): AsyncIterable<TranscriptSpan> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this

    return {
      [Symbol.asyncIterator](): AsyncIterator<TranscriptSpan> {
        return {
          next(): Promise<IteratorResult<TranscriptSpan>> {
            if (self._stopped && self._queue.length === 0) {
              return Promise.resolve(DONE)
            }

            const queued = self._queue.shift()
            if (queued !== undefined) {
              return Promise.resolve({ value: queued, done: false })
            }

            if (self._stopped) {
              return Promise.resolve(DONE)
            }

            // Nothing queued and not stopped yet — wait for next pushScriptedSpan or stop()
            return new Promise<IteratorResult<TranscriptSpan>>((resolve) => {
              self._waiters.push(resolve)
            })
          },
        }
      },
    }
  }
}
