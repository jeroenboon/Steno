import { describe, expect, it } from 'vitest'

import { createWindowOptions } from './window-options'

// Slice 3 — security-flag config test
// createWindowOptions() is a pure function (no Electron import needed in tests).
// We assert all four security flags required by the Electron security baseline.

describe('createWindowOptions', () => {
  it('sets contextIsolation to true', () => {
    const opts = createWindowOptions('/some/preload.js')
    expect(opts.webPreferences.contextIsolation).toBe(true)
  })

  it('sets nodeIntegration to false', () => {
    const opts = createWindowOptions('/some/preload.js')
    expect(opts.webPreferences.nodeIntegration).toBe(false)
  })

  it('sets sandbox to true', () => {
    const opts = createWindowOptions('/some/preload.js')
    expect(opts.webPreferences.sandbox).toBe(true)
  })

  it('sets the preload path to the value passed in', () => {
    const preloadPath = '/absolute/path/to/preload.js'
    const opts = createWindowOptions(preloadPath)
    expect(opts.webPreferences.preload).toBe(preloadPath)
  })

  it('sets the window icon when an icon path is provided', () => {
    const opts = createWindowOptions('/some/preload.js', '/path/to/icon.png')
    expect(opts.icon).toBe('/path/to/icon.png')
  })

  it('omits the icon when no icon path is provided', () => {
    const opts = createWindowOptions('/some/preload.js')
    expect('icon' in opts).toBe(false)
  })
})
