import { copyFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'

import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * Copy the standalone sherpa decode worker (a plain .mjs, not part of the bundle
 * graph) next to the built main entry so `WorkerSherpaSessionFactory` can spawn it
 * from `join(__dirname, 'sherpaDecodeWorker.mjs')`. Runs on every main build
 * (dev + prod). sherpa-onnx is externalized and resolved from node_modules at
 * runtime, so the worker requires it directly.
 */
const copySherpaWorker = {
  name: 'copy-sherpa-decode-worker',
  writeBundle(): void {
    const dest = resolve('out/main')
    mkdirSync(dest, { recursive: true })
    copyFileSync(
      resolve('src/main/providers/sherpa/sherpaDecodeWorker.mjs'),
      resolve('out/main/sherpaDecodeWorker.mjs'),
    )
  },
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copySherpaWorker],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
    build: {
      rollupOptions: {
        // onnxruntime-genai is a native module that may not be installed until
        // the user enables local ASR. It is loaded via dynamic import at runtime
        // only when local-parakeet is selected. Mark it external so the build
        // does not fail when the package is absent.
        external: ['onnxruntime-genai'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react()],
  },
})
