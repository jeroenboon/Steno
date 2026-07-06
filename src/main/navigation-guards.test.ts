import { describe, expect, it } from 'vitest'

import { denyWindowOpen, isNavigationAllowed } from './navigation-guards'

// S2 — navigation guards (Electron security checklist, ADR 0005).
// Two pure predicates back the setWindowOpenHandler / will-navigate guards wired
// in index.ts, so the allow/deny logic is testable without launching Electron.

describe('denyWindowOpen', () => {
  it('denies every new-window request unconditionally', () => {
    expect(denyWindowOpen()).toEqual({ action: 'deny' })
  })
})

describe('isNavigationAllowed', () => {
  describe('development (dev-server URL present)', () => {
    const devUrl = 'http://localhost:5173'

    it('allows navigation to the dev-server origin', () => {
      expect(isNavigationAllowed('http://localhost:5173/index.html', devUrl)).toBe(true)
    })

    it('denies navigation to an external https origin', () => {
      expect(isNavigationAllowed('https://evil.example/', devUrl)).toBe(false)
    })

    it('denies a look-alike host that merely shares the dev URL as a prefix', () => {
      expect(isNavigationAllowed('http://localhost:5173.evil.com/', devUrl)).toBe(false)
    })
  })

  describe('production (no dev-server URL — renderer loaded from file:)', () => {
    it('allows navigation to a file: URL', () => {
      expect(isNavigationAllowed('file:///C:/app/resources/renderer/index.html', undefined)).toBe(
        true,
      )
    })

    it('denies navigation to an external https origin', () => {
      expect(isNavigationAllowed('https://evil.example/', undefined)).toBe(false)
    })
  })

  it('denies an unparseable target URL', () => {
    expect(isNavigationAllowed('not a url', 'http://localhost:5173')).toBe(false)
  })
})
