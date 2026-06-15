import { describe, expect, it } from 'vitest'

import { buildContentSecurityPolicy } from './csp'

describe('buildContentSecurityPolicy', () => {
  it('is strict in production: no unsafe-inline / unsafe-eval for scripts', () => {
    const csp = buildContentSecurityPolicy(false)
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain("'unsafe-inline' 'unsafe-eval'")
    expect(csp).not.toContain('ws:')
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
  })

  it('relaxes scripts and websockets in development for the Vite dev server', () => {
    const csp = buildContentSecurityPolicy(true)
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'")
    expect(csp).toContain('ws:')
    expect(csp).toContain('wss:')
    // Still keeps the non-script protections.
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
  })
})
