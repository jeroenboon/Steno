import { describe, expect, it } from 'vitest'

import { ExtractionTerminalStateSchema } from './extractionTerminalState'

describe('ExtractionTerminalStateSchema', () => {
  it('accepts the output-truncated reason', () => {
    const parsed = ExtractionTerminalStateSchema.parse({ reason: 'output-truncated' })
    expect(parsed.reason).toBe('output-truncated')
  })

  it('rejects an unknown reason', () => {
    expect(ExtractionTerminalStateSchema.safeParse({ reason: 'nope' }).success).toBe(false)
  })
})
