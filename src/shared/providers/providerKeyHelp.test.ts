/**
 * Tests for the provider key-help catalog (Phase 5.3).
 *
 * Maps a vendor keyRef to the page where the user obtains that vendor's API key
 * (and, for Azure, the resource that carries the endpoint/deployment). Drives
 * the in-app "where do I get this?" guidance in Settings.
 */

import { describe, expect, it } from 'vitest'

import { PROVIDER_KEY_HELP } from './providerKeyHelp'

describe('PROVIDER_KEY_HELP', () => {
  it('covers every cloud vendor keyRef', () => {
    expect(Object.keys(PROVIDER_KEY_HELP).sort()).toEqual(
      ['anthropic', 'azure', 'deepgram', 'mistral', 'openai'].sort(),
    )
  })

  it('gives a valid https key URL for each vendor', () => {
    for (const entry of Object.values(PROVIDER_KEY_HELP)) {
      const url = new URL(entry.keyUrl)
      expect(url.protocol).toBe('https:')
    }
  })
})
