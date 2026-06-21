/**
 * Native-module smoke test under the Electron runtime.
 *
 * Why this exists: the Vitest suite runs under system Node, where a native
 * module (better-sqlite3) built for Node's ABI loads fine. The Electron app
 * embeds a *different* Node ABI, so a module that isn't rebuilt for Electron
 * crashes the app at startup with ERR_DLOPEN_FAILED / NODE_MODULE_VERSION
 * mismatch — and no Node-side test can see it. This check loads the native
 * modules under Electron's actual runtime (ELECTRON_RUN_AS_NODE) so the DoD
 * gate and CI fail loudly instead of shipping a broken app.
 *
 * Run via: npm run test:native
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// `require('electron')` in a plain Node process resolves to the path of the
// Electron executable.
const electronPath = require('electron')

// Probe script executed *inside* Electron's Node.
// Exercises the real failure path for each native module.
const probe = [
  // better-sqlite3 (always required)
  "const Database = require('better-sqlite3');",
  "const db = new Database(':memory:');",
  "db.pragma('foreign_keys = ON');",
  'db.close();',
  // sherpa-onnx (optional — skip if not installed)
  "try { require('sherpa-onnx'); console.log('[smoke] sherpa-onnx OK'); }",
  "catch (e) { if (e.code === 'MODULE_NOT_FOUND') { console.log('[smoke] sherpa-onnx not installed, skipping'); }",
  'else { throw e; } }',
  "console.log('native modules OK under Electron');",
].join(' ')

try {
  execFileSync(electronPath, ['-e', probe], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  })
} catch {
  console.error(
    '\nNative module failed to load under Electron.\n' +
      'A native dependency is likely built for the wrong Node ABI.\n' +
      'Fix: run `npm run rebuild:native` (electron-builder install-app-deps).\n',
  )
  process.exit(1)
}
