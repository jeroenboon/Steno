/**
 * Swap better-sqlite3's compiled addon to match a target runtime's Node ABI.
 *
 * Why this is needed: better-sqlite3 keeps a single compiled addon at
 * build/Release. The Electron app and the Vitest suite embed *different* Node
 * ABIs, so the same binary cannot serve both — loading the wrong one crashes
 * with ERR_DLOPEN_FAILED / NODE_MODULE_VERSION mismatch. So each native-using
 * command (dev, preview, test, test:native) self-heals by swapping in the
 * prebuilt binary for the ABI it needs before it runs.
 *
 * We use prebuild-install (fetches a *prebuilt* binary — no C++ toolchain
 * required) rather than electron-builder install-app-deps, because the latter
 * caches and skips the rebuild after an external swap. prebuild-install copies
 * the requested runtime's binary every run, so swaps are deterministic.
 *
 * Usage:
 *   node scripts/rebuild-native.mjs electron   # ABI for the Electron app
 *   node scripts/rebuild-native.mjs node       # ABI for the current Node (tests)
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const target = process.argv[2]
if (target !== 'node' && target !== 'electron') {
  console.error(`Unknown target "${target ?? ''}". Use "node" or "electron".`)
  process.exit(2)
}

const require = createRequire(import.meta.url)
const moduleDir = dirname(require.resolve('better-sqlite3/package.json'))
const prebuildInstall = require.resolve('prebuild-install/bin.js')

// `node` is the default runtime for prebuild-install (current process ABI).
// For `electron`, pin to the installed Electron version so the ABI matches.
const args = [prebuildInstall]
if (target === 'electron') {
  const electronVersion = require('electron/package.json').version
  args.push('--runtime', 'electron', '--target', electronVersion)
}

try {
  execFileSync(process.execPath, args, { cwd: moduleDir, stdio: 'inherit' })
} catch {
  console.error(`\nFailed to install the ${target}-ABI prebuilt binary for better-sqlite3.\n`)
  process.exit(1)
}
