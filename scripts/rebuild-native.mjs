/**
 * Swap native modules' compiled addons to match a target runtime's Node ABI.
 *
 * Native modules (better-sqlite3, onnxruntime-genai) keep a single compiled
 * addon each. The Electron app and the Vitest suite embed *different* Node
 * ABIs, so the same binary cannot serve both — loading the wrong one crashes
 * with ERR_DLOPEN_FAILED / NODE_MODULE_VERSION mismatch. Each native-using
 * command self-heals by swapping in the prebuilt binary for the ABI it needs.
 *
 * We use prebuild-install (prebuilt binaries, no C++ toolchain required).
 *
 * Usage:
 *   node scripts/rebuild-native.mjs electron   # ABI for the Electron app
 *   node scripts/rebuild-native.mjs node       # ABI for the current Node (tests)
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const target = process.argv[2]
if (target !== 'node' && target !== 'electron') {
  console.error(`Unknown target "${target ?? ''}". Use "node" or "electron".`)
  process.exit(2)
}

const require = createRequire(import.meta.url)
const prebuildInstall = require.resolve('prebuild-install/bin.js')

// Modules to rebuild. Each entry is checked for presence before rebuilding —
// onnxruntime-genai is optional and may not be installed yet.
const NATIVE_MODULES = ['better-sqlite3', 'onnxruntime-genai']

// `node` is the default runtime for prebuild-install (current process ABI).
// For `electron`, pin to the installed Electron version so the ABI matches.
const extraArgs = []
if (target === 'electron') {
  const electronVersion = require('electron/package.json').version
  extraArgs.push('--runtime', 'electron', '--target', electronVersion)
}

for (const moduleName of NATIVE_MODULES) {
  let moduleDir
  try {
    moduleDir = dirname(require.resolve(`${moduleName}/package.json`))
  } catch {
    // Module not installed — skip silently (e.g. onnxruntime-genai is optional)
    continue
  }

  // Skip if the module doesn't have a native build directory
  if (!existsSync(`${moduleDir}/build/Release`)) {
    continue
  }

  try {
    execFileSync(process.execPath, [prebuildInstall, ...extraArgs], {
      cwd: moduleDir,
      stdio: 'inherit',
    })
  } catch {
    console.error(`\nFailed to install the ${target}-ABI prebuilt binary for ${moduleName}.\n`)
    process.exit(1)
  }
}
