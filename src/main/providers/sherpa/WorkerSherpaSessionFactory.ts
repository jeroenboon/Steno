/**
 * WorkerSherpaSessionFactory — runs sherpa-onnx Whisper inference in a
 * worker_thread so the CPU-bound decode never blocks the main process event loop.
 *
 * ## Why
 * sherpa-onnx is a synchronous WASM build. `recognizer.decode()` runs on the
 * calling thread for the full duration of a chunk (~4.8 s for a 5 s chunk of the
 * small model on a typical CPU). On the main process that freezes IPC, audio
 * intake, and window management — the app shows "Not Responding". A validation
 * probe measured 0 main-loop heartbeats during a main-thread decode vs ~992
 * during the same decode in a worker. Offloading is the fix. See ADR 0041.
 *
 * ## Shape
 * Implements the existing `SherpaSessionFactory` / `SherpaSession` seam, so
 * `LocalAsrProvider` is unchanged: it still calls `session.transcribe(pcm)` and
 * awaits a `Promise<string>`. Here that promise is fulfilled by the worker.
 *
 * The real `worker_threads.Worker` sits behind a `SherpaWorkerHandle` seam so the
 * request/response protocol is unit-tested with a fake handle (no thread, no WASM,
 * no model). Only the thin default spawner touches Node's worker_threads.
 *
 * ## Protocol
 *   main → worker:  { type: 'init', modelDir, language }
 *                   { type: 'decode', id, sampleRate, pcm }   (pcm buffer transferred)
 *                   { type: 'free' }
 *   worker → main:  { type: 'ready' } | { type: 'initError', error }
 *                   { type: 'result', id, text } | { type: 'decodeError', id, error }
 *
 * The worker owns one OfflineRecognizer and processes decode requests FIFO (its
 * event loop is single-threaded and the decode is synchronous), so results return
 * in submission order; the `id` correlation is belt-and-braces and lets multiple
 * in-flight `transcribe()` calls (LocalAsrProvider fires them without awaiting)
 * resolve independently.
 */

import { join } from 'node:path'
import { Worker, type Transferable } from 'node:worker_threads'

import type { SherpaSession, SherpaSessionFactory } from './SherpaSession'

// ---------------------------------------------------------------------------
// Wire protocol
// ---------------------------------------------------------------------------

export type WorkerRequest =
  | { type: 'init'; modelDir: string; language: string }
  | { type: 'decode'; id: number; sampleRate: number; pcm: Float32Array }
  | { type: 'free' }

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'initError'; error: string }
  | { type: 'result'; id: number; text: string }
  | { type: 'decodeError'; id: number; error: string }

/**
 * Minimal seam over `worker_threads.Worker`: enough to post requests, receive
 * responses/errors, and terminate. Injected so the protocol is testable.
 */
export interface SherpaWorkerHandle {
  postMessage(message: WorkerRequest, transfer?: readonly ArrayBufferLike[]): void
  onMessage(cb: (msg: WorkerResponse) => void): void
  onError(cb: (err: Error) => void): void
  terminate(): void
}

export type SherpaWorkerSpawner = () => SherpaWorkerHandle

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export class WorkerSherpaSessionFactory implements SherpaSessionFactory {
  constructor(
    private readonly language: string,
    private readonly spawn: SherpaWorkerSpawner = defaultSpawn,
  ) {}

  async createSession(modelDir: string): Promise<SherpaSession> {
    const handle = this.spawn()
    const session = new WorkerSherpaSession(handle)
    await session.init(modelDir, this.language)
    return session
  }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

interface Pending {
  resolve: (text: string) => void
  reject: (err: Error) => void
}

class WorkerSherpaSession implements SherpaSession {
  private readonly _pending = new Map<number, Pending>()
  private _counter = 0
  private _freed = false
  private _readyResolve: (() => void) | null = null
  private _readyReject: ((err: Error) => void) | null = null

  constructor(private readonly _handle: SherpaWorkerHandle) {
    this._handle.onMessage(this._handleMessage)
    this._handle.onError(this._handleError)
  }

  init(modelDir: string, language: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._readyResolve = resolve
      this._readyReject = reject
      this._handle.postMessage({ type: 'init', modelDir, language })
    })
  }

  transcribe(audioPcm: Float32Array, sampleRate: number): Promise<string> {
    if (this._freed) return Promise.reject(new Error('[WorkerSherpaSession] session already freed'))
    const id = ++this._counter
    return new Promise<string>((resolve, reject) => {
      this._pending.set(id, { resolve, reject })
      // Transfer the PCM buffer for zero-copy handoff; LocalAsrProvider does not
      // reuse it after the call.
      this._handle.postMessage({ type: 'decode', id, sampleRate, pcm: audioPcm }, [audioPcm.buffer])
    })
  }

  free(): void {
    if (this._freed) return
    this._freed = true
    this._handle.postMessage({ type: 'free' })
    this._handle.terminate()
    this._rejectAll(new Error('[WorkerSherpaSession] session freed'))
  }

  private readonly _handleMessage = (msg: WorkerResponse): void => {
    switch (msg.type) {
      case 'ready':
        this._readyResolve?.()
        this._clearReady()
        return
      case 'initError':
        this._readyReject?.(new Error(`[WorkerSherpaSession] init failed: ${msg.error}`))
        this._clearReady()
        return
      case 'result': {
        const p = this._pending.get(msg.id)
        if (p !== undefined) {
          this._pending.delete(msg.id)
          p.resolve(msg.text)
        }
        return
      }
      case 'decodeError': {
        const p = this._pending.get(msg.id)
        if (p !== undefined) {
          this._pending.delete(msg.id)
          p.reject(new Error(`[WorkerSherpaSession] decode failed: ${msg.error}`))
        }
        return
      }
    }
  }

  private readonly _handleError = (err: Error): void => {
    // A thread-level failure fails init (if pending) and every in-flight decode.
    this._readyReject?.(err)
    this._clearReady()
    this._rejectAll(err)
  }

  private _clearReady(): void {
    this._readyResolve = null
    this._readyReject = null
  }

  private _rejectAll(err: Error): void {
    for (const p of this._pending.values()) p.reject(err)
    this._pending.clear()
  }
}

// ---------------------------------------------------------------------------
// Default spawner (the only part that touches node:worker_threads)
// ---------------------------------------------------------------------------

/**
 * Spawn the real decode worker. The worker entry is a sibling module resolved
 * relative to this file.
 *
 * NOTE (spike / needs in-app verification): the worker-path resolution below
 * assumes the electron-vite main build emits `sherpaDecodeWorker.mjs` next to the
 * bundled main entry. If the packaged/dev build resolves it elsewhere, adjust the
 * emit (vite asset copy or a `?worker`/`new URL(...)` import) — this is the one
 * seam the unit tests do not cover.
 */
function defaultSpawn(): SherpaWorkerHandle {
  const worker = new Worker(join(__dirname, 'sherpaDecodeWorker.mjs'))

  return {
    postMessage(message, transfer): void {
      worker.postMessage(message, transfer as unknown as readonly Transferable[] | undefined)
    },
    onMessage(cb): void {
      worker.on('message', cb)
    },
    onError(cb): void {
      worker.on('error', cb)
    },
    terminate(): void {
      void worker.terminate()
    },
  }
}
