/**
 * WorkerSherpaSessionFactory — protocol orchestration tests.
 *
 * The real worker_threads.Worker is hidden behind a `SherpaWorkerHandle` seam so
 * these tests drive the request/response protocol deterministically, with no real
 * thread, no WASM, and no model. The real worker entry is exercised in-app.
 */

import { describe, expect, it } from 'vitest'

import {
  WorkerSherpaSessionFactory,
  type SherpaWorkerHandle,
  type WorkerRequest,
  type WorkerResponse,
} from './WorkerSherpaSessionFactory'

/** A fake worker handle that records posted requests and lets a test push responses. */
class FakeWorkerHandle implements SherpaWorkerHandle {
  readonly posted: WorkerRequest[] = []
  readonly transfers: (readonly ArrayBufferLike[] | undefined)[] = []
  terminated = false
  private messageCb: ((msg: WorkerResponse) => void) | null = null
  private errorCb: ((err: Error) => void) | null = null

  postMessage(message: WorkerRequest, transfer?: readonly ArrayBufferLike[]): void {
    this.posted.push(message)
    this.transfers.push(transfer)
  }
  onMessage(cb: (msg: WorkerResponse) => void): void {
    this.messageCb = cb
  }
  onError(cb: (err: Error) => void): void {
    this.errorCb = cb
  }
  terminate(): void {
    this.terminated = true
  }

  // --- test helpers ---
  emit(msg: WorkerResponse): void {
    this.messageCb?.(msg)
  }
  emitError(err: Error): void {
    this.errorCb?.(err)
  }
  lastOfType<T extends WorkerRequest['type']>(type: T): Extract<WorkerRequest, { type: T }> {
    const found = [...this.posted].reverse().find((m) => m.type === type)
    if (found === undefined) throw new Error(`no posted message of type ${type}`)
    return found as Extract<WorkerRequest, { type: T }>
  }
}

function makeFactory(): { factory: WorkerSherpaSessionFactory; handle: FakeWorkerHandle } {
  const handle = new FakeWorkerHandle()
  const factory = new WorkerSherpaSessionFactory('nl', () => handle)
  return { factory, handle }
}

describe('WorkerSherpaSessionFactory', () => {
  it('posts init with the model dir + language and resolves createSession on ready', async () => {
    const { factory, handle } = makeFactory()
    const sessionPromise = factory.createSession('/models/whisper-small')

    const init = handle.lastOfType('init')
    expect(init.modelDir).toBe('/models/whisper-small')
    expect(init.language).toBe('nl')

    handle.emit({ type: 'ready' })
    await expect(sessionPromise).resolves.toBeDefined()
  })

  it('rejects createSession when the worker reports an init error', async () => {
    const { factory, handle } = makeFactory()
    const sessionPromise = factory.createSession('/models/whisper-small')
    handle.emit({ type: 'initError', error: 'model files missing' })
    await expect(sessionPromise).rejects.toThrow(/model files missing/)
  })

  it('transcribe posts a decode request and resolves with the matching result text', async () => {
    const { factory, handle } = makeFactory()
    const session = await resolvedSession(factory, handle)

    const pcm = new Float32Array([0.1, 0.2, 0.3])
    const textPromise = session.transcribe(pcm, 16_000)

    const decode = handle.lastOfType('decode')
    expect(decode.sampleRate).toBe(16_000)
    handle.emit({ type: 'result', id: decode.id, text: 'hallo wereld' })
    await expect(textPromise).resolves.toBe('hallo wereld')
  })

  it('transfers the PCM buffer (zero-copy) on decode', async () => {
    const { factory, handle } = makeFactory()
    const session = await resolvedSession(factory, handle)

    const pcm = new Float32Array([0.1, 0.2])
    void session.transcribe(pcm, 16_000)
    const lastTransfer = handle.transfers[handle.transfers.length - 1]
    expect(lastTransfer).toEqual([pcm.buffer])
  })

  it('routes out-of-order results to the correct pending transcribe calls', async () => {
    const { factory, handle } = makeFactory()
    const session = await resolvedSession(factory, handle)

    const first = session.transcribe(new Float32Array([1]), 16_000)
    const second = session.transcribe(new Float32Array([2]), 16_000)
    const decodes = handle.posted.filter(
      (m): m is Extract<WorkerRequest, { type: 'decode' }> => m.type === 'decode',
    )
    expect(decodes).toHaveLength(2)
    const d0 = decodes[0]
    const d1 = decodes[1]
    if (d0 === undefined || d1 === undefined) throw new Error('expected two decode requests')

    // Reply to the second first, then the first — each must resolve its own call.
    handle.emit({ type: 'result', id: d1.id, text: 'second' })
    handle.emit({ type: 'result', id: d0.id, text: 'first' })
    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
  })

  it('rejects the matching transcribe on a decode error', async () => {
    const { factory, handle } = makeFactory()
    const session = await resolvedSession(factory, handle)

    const textPromise = session.transcribe(new Float32Array([1]), 16_000)
    const decode = handle.lastOfType('decode')
    handle.emit({ type: 'decodeError', id: decode.id, error: 'decode blew up' })
    await expect(textPromise).rejects.toThrow(/decode blew up/)
  })

  it('free() terminates the worker and rejects any in-flight transcribe', async () => {
    const { factory, handle } = makeFactory()
    const session = await resolvedSession(factory, handle)

    const inflight = session.transcribe(new Float32Array([1]), 16_000)
    session.free()
    expect(handle.terminated).toBe(true)
    await expect(inflight).rejects.toThrow()
  })

  it('surfaces a worker thread error to an in-flight transcribe', async () => {
    const { factory, handle } = makeFactory()
    const session = await resolvedSession(factory, handle)

    const inflight = session.transcribe(new Float32Array([1]), 16_000)
    handle.emitError(new Error('worker crashed'))
    await expect(inflight).rejects.toThrow(/worker crashed/)
  })
})

async function resolvedSession(
  factory: WorkerSherpaSessionFactory,
  handle: FakeWorkerHandle,
): Promise<{ transcribe: (p: Float32Array, r: number) => Promise<string>; free: () => void }> {
  const p = factory.createSession('/models/whisper-small')
  handle.emit({ type: 'ready' })
  return p
}
