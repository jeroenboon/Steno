/**
 * @vitest-environment node
 *
 * Regression guard for the "module not found: zod" preload crash.
 *
 * The preload runs SANDBOXED (sandbox: true, ADR 0005). A sandboxed preload
 * cannot require Node modules at runtime, so it must not import `zod` — directly,
 * or transitively via a VALUE import from @shared/ipc (which builds the whole
 * Zod schema graph, e.g. `ipcChannelSchemas`). When that regressed, the preload
 * failed to load, `contextBridge.exposeInMainWorld` never ran, window.api was
 * undefined, and the renderer blanked. Neither the unit tests nor `npm run build`
 * caught it because neither loads the preload in a real sandbox — so we assert it
 * at the source level here. Only `import type` from @shared/ipc is allowed (it is
 * erased at build time and pulls no runtime dependency).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, it, expect } from 'vitest'

const preloadDir = fileURLToPath(new URL('.', import.meta.url))
const sourceFiles = readdirSync(preloadDir).filter(
  (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
)

describe('preload is sandbox-safe (no runtime Node dependency)', () => {
  it('found preload source files to check', () => {
    expect(sourceFiles.length).toBeGreaterThan(0)
  })

  for (const file of sourceFiles) {
    const src = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')

    it(`${file} does not import zod at runtime`, () => {
      expect(src).not.toMatch(/from\s+['"]zod['"]/)
    })

    // Repo style keeps imports single-line (Prettier, 100 cols). A value import
    // from @shared/ipc (anything but `import type`) drags the schema graph in.
    it(`${file} imports @shared/ipc as types only`, () => {
      expect(src).not.toMatch(/^import\s+(?!type\b).*from\s+['"]@shared\/ipc['"]/m)
    })
  }
})
