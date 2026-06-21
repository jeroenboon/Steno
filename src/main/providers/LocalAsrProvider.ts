/**
 * LocalAsrProvider (item 0024).
 *
 * Implements ASRProvider using sherpa-onnx + Whisper (offline, batch-per-chunk).
 * The real SherpaSession is hidden behind SherpaSessionFactory so tests can inject
 * FakeSherpaSessionFactory without any real model or native addon.
 *
 * Audio pipeline:
 *   - Input: Uint8Array, 16-bit LE PCM, 16 kHz mono (from AudioCaptureBridge)
 *   - Convert to Float32Array, normalised [-1, 1]
 *   - Buffer until a full chunk (default 5000 ms = 80000 samples)
 *   - Feed chunk to session.transcribe()
 *   - Emit TranscriptSpan for each non-empty result
 *
 * isFinal is absent on all spans (Whisper emits one result per chunk).
 * Per ADR 0011: isFinal absent = treated as final by all consumers.
 *
 * Lifecycle / async coordination:
 *   _pendingWork counts in-flight async tasks (session init + each inference).
 *   stop() sets _stopped. _drainWaiters() fires only when _stopped && _pendingWork === 0,
 *   guaranteeing all buffered audio is processed before the iterator completes.
 */

import { randomUUID } from 'node:crypto'

import { TranscriptSpanSchema, type TranscriptSpan } from '@shared/domain/types'
import type { ASRProvider } from '@shared/providers/ASRProvider'

import type { SherpaSession, SherpaSessionFactory } from './sherpa/SherpaSession'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 16_000
const INT16_MAX = 32_768

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface LocalAsrProviderOptions {
  /** Path to the directory containing the model files. */
  modelDir: string
  /** BCP-47 language tag. Default 'nl'. */
  language?: string
  /** Chunk duration in milliseconds. Default 5000 (5 s — Whisper needs context). */
  chunkDurationMs?: number
  /** Injected for tests; defaults to DefaultSherpaSessionFactory (lazy loaded). */
  sessionFactory?: SherpaSessionFactory
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class LocalAsrProvider implements ASRProvider {
  private readonly _modelDir: string
  private readonly _chunkDurationMs: number
  private readonly _sessionFactory: SherpaSessionFactory

  private _started = false
  private _stopped = false

  /** PCM bytes buffered from pushAudioFrame() calls. */
  private _buffer: Uint8Array = new Uint8Array(0)
  /** Running wall-clock position of emitted audio in milliseconds. */
  private _positionMs = 0

  /** Spans waiting to be consumed by the iterator. */
  private _queue: TranscriptSpan[] = []
  /** Promises waiting for the next queued span. */
  private _waiters: ((result: IteratorResult<TranscriptSpan>) => void)[] = []

  /**
   * Count of in-flight async tasks (session init + inference calls).
   * The iterator completes when _stopped === true && _pendingWork === 0.
   */
  private _pendingWork = 0

  private _session: SherpaSession | null = null
  private _sessionReady = false

  constructor(options: LocalAsrProviderOptions) {
    this._modelDir = options.modelDir
    this._chunkDurationMs = options.chunkDurationMs ?? 5_000
    const language = options.language ?? 'nl'
    this._sessionFactory = options.sessionFactory ?? new LazyDefaultSherpaFactory(language)
  }

  // -------------------------------------------------------------------------
  // ASRProvider interface
  // -------------------------------------------------------------------------

  start(): void {
    this._started = true
    this._stopped = false
    this._buffer = new Uint8Array(0)
    this._positionMs = 0
    this._pendingWork = 0
    this._sessionReady = false
    this._session = null

    this._workStarted()
    void this._initSession()
  }

  stop(): void {
    if (!this._started) return
    this._stopped = true
    this._maybeFinalize()
  }

  pushAudioFrame(chunk: Uint8Array): void {
    if (!this._started || this._stopped) return

    const combined = new Uint8Array(this._buffer.length + chunk.length)
    combined.set(this._buffer)
    combined.set(chunk, this._buffer.length)
    this._buffer = combined

    this._processBuffer()
  }

  spans(): AsyncIterable<TranscriptSpan> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this

    return {
      [Symbol.asyncIterator](): AsyncIterator<TranscriptSpan> {
        return {
          next(): Promise<IteratorResult<TranscriptSpan>> {
            if (self._stopped && self._pendingWork === 0 && self._queue.length === 0) {
              return Promise.resolve({ value: undefined, done: true })
            }

            const queued = self._queue.shift()
            if (queued !== undefined) {
              return Promise.resolve({ value: queued, done: false })
            }

            if (self._stopped && self._pendingWork === 0) {
              return Promise.resolve({ value: undefined, done: true })
            }

            return new Promise<IteratorResult<TranscriptSpan>>((resolve) => {
              self._waiters.push(resolve)
            })
          },
        }
      },
    }
  }

  // -------------------------------------------------------------------------
  // Internal: pending work tracking
  // -------------------------------------------------------------------------

  private _workStarted(): void {
    this._pendingWork++
  }

  private _workDone(): void {
    this._pendingWork--
    this._maybeFinalize()
  }

  private _maybeFinalize(): void {
    if (this._stopped && this._pendingWork === 0) {
      this._drainWaiters()
    }
  }

  // -------------------------------------------------------------------------
  // Internal: session init + buffer processing
  // -------------------------------------------------------------------------

  private async _initSession(): Promise<void> {
    try {
      this._session = await this._sessionFactory.createSession(this._modelDir)
      this._sessionReady = true
      // Process any audio that arrived while the session was initializing.
      this._processBuffer()
    } catch (err) {
      console.error('[LocalAsrProvider] Failed to initialise sherpa-onnx session:', err)
      this._stopped = true
    } finally {
      this._workDone()
    }
  }

  private _processBuffer(): void {
    if (!this._sessionReady || this._session === null) return

    const bytesPerSample = 2
    const samplesPerChunk = Math.floor((this._chunkDurationMs * SAMPLE_RATE) / 1000)
    const bytesPerChunk = samplesPerChunk * bytesPerSample

    while (this._buffer.length >= bytesPerChunk) {
      const chunkBytes = this._buffer.slice(0, bytesPerChunk)
      this._buffer = this._buffer.slice(bytesPerChunk)

      const pcm = int16ToFloat32(chunkBytes)
      const startMs = this._positionMs
      const endMs = startMs + this._chunkDurationMs
      this._positionMs = endMs

      this._workStarted()
      void this._runInference(pcm, startMs, endMs)
    }
  }

  private async _runInference(pcm: Float32Array, startMs: number, endMs: number): Promise<void> {
    try {
      if (this._session === null) return
      const text = (await this._session.transcribe(pcm, SAMPLE_RATE)).trim()
      if (text.length === 0) return

      const raw = {
        id: randomUUID(),
        text,
        startMs,
        endMs,
        // isFinal intentionally absent — Whisper emits one result per chunk
      }

      const parsed = TranscriptSpanSchema.safeParse(raw)
      if (!parsed.success) return

      this._emit(parsed.data)
    } catch (err) {
      console.error('[LocalAsrProvider] Inference error:', err)
    } finally {
      this._workDone()
    }
  }

  private _emit(span: TranscriptSpan): void {
    const waiter = this._waiters.shift()
    if (waiter !== undefined) {
      waiter({ value: span, done: false })
    } else {
      this._queue.push(span)
    }
  }

  private _drainWaiters(): void {
    if (this._session !== null) {
      this._session.free()
      this._session = null
    }
    const done: IteratorReturnResult<undefined> = { value: undefined, done: true }
    for (const resolve of this._waiters) {
      resolve(done)
    }
    this._waiters = []
  }
}

// ---------------------------------------------------------------------------
// Default session factory (lazy import of sherpa-onnx)
// ---------------------------------------------------------------------------

class LazyDefaultSherpaFactory implements SherpaSessionFactory {
  constructor(private readonly language: string) {}

  async createSession(modelDir: string): Promise<SherpaSession> {
    const { DefaultSherpaSessionFactory } = await import('./sherpa/DefaultSherpaSessionFactory')
    const real = new DefaultSherpaSessionFactory(this.language)
    return real.createSession(modelDir)
  }
}

// ---------------------------------------------------------------------------
// Audio conversion
// ---------------------------------------------------------------------------

function int16ToFloat32(bytes: Uint8Array): Float32Array {
  const samples = bytes.length / 2
  const float32 = new Float32Array(samples)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < samples; i++) {
    const int16 = view.getInt16(i * 2, true) // little-endian
    float32[i] = int16 / INT16_MAX
  }
  return float32
}
