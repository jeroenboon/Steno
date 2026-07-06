/**
 * sherpaDecodeWorker.mjs — the worker_thread entry that owns the sherpa-onnx
 * OfflineRecognizer and runs Whisper decode off the main process event loop.
 *
 * Kept as a standalone .mjs (not bundled): the electron-vite main build copies it
 * verbatim into out/main/ (see the copy hook in electron.vite.config.ts), and
 * sherpa-onnx is resolved at runtime from node_modules (externalized), so this
 * file requires it directly.
 *
 * Protocol (mirror of WorkerSherpaSessionFactory):
 *   in:  { type:'init', modelDir, language } | { type:'decode', id, sampleRate, pcm } | { type:'free' }
 *   out: { type:'ready' } | { type:'initError', error }
 *        { type:'result', id, text } | { type:'decodeError', id, error }
 */
import { parentPort } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

/** @type {any} */
let recognizer = null

function initRecognizer(modelDir, language) {
  const sherpa = require('sherpa-onnx')
  recognizer = sherpa.createOfflineRecognizer({
    modelConfig: {
      whisper: {
        encoder: join(modelDir, 'small-encoder.int8.onnx'),
        decoder: join(modelDir, 'small-decoder.int8.onnx'),
        language,
        task: 'transcribe',
      },
      tokens: join(modelDir, 'small-tokens.txt'),
      numThreads: 2,
      debug: 0,
      provider: 'cpu',
    },
  })
}

function decode(pcm, sampleRate) {
  const stream = recognizer.createStream()
  stream.acceptWaveform(sampleRate, pcm)
  recognizer.decode(stream)
  const result = recognizer.getResult(stream)
  stream.free()
  return typeof result.text === 'string' ? result.text : ''
}

parentPort?.on('message', (msg) => {
  try {
    switch (msg.type) {
      case 'init':
        initRecognizer(msg.modelDir, msg.language)
        parentPort?.postMessage({ type: 'ready' })
        return
      case 'decode': {
        const text = decode(msg.pcm, msg.sampleRate)
        parentPort?.postMessage({ type: 'result', id: msg.id, text })
        return
      }
      case 'free':
        recognizer?.free?.()
        recognizer = null
        return
    }
  } catch (e) {
    const error = String((e && e.stack) || e)
    if (msg.type === 'init') parentPort?.postMessage({ type: 'initError', error })
    else if (msg.type === 'decode')
      parentPort?.postMessage({ type: 'decodeError', id: msg.id, error })
  }
})
