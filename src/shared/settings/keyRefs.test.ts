/**
 * Tests for keyRef resolution + shared-key detection (Phase 5.2).
 *
 * A single vendor key (openai/mistral/azure) can serve both the ASR and the
 * extraction role. These helpers say which keyRef each role uses and whether
 * one key is shared, so the UI can tell the user a replace affects both roles.
 */

import { describe, expect, it } from 'vitest'

import { getSharedKeyRef, resolveAsrKeyRef, resolveExtractionKeyRef } from './keyRefs'
import type { AppSettings } from './settingsSchema'

describe('resolveExtractionKeyRef', () => {
  it('returns "anthropic" for the Anthropic extractor', () => {
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    expect(resolveExtractionKeyRef(settings)).toBe('anthropic')
  })

  it('returns the configured keyRef for an openai-compatible extractor', () => {
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiCompatible: {
        preset: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4-mini',
        keyRef: 'openai',
        displayName: 'OpenAI',
      },
    }
    expect(resolveExtractionKeyRef(settings)).toBe('openai')
  })
})

describe('resolveAsrKeyRef', () => {
  it('returns "deepgram" for Deepgram', () => {
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    expect(resolveAsrKeyRef(settings)).toBe('deepgram')
  })

  it('returns null for the on-device provider', () => {
    const settings: AppSettings = {
      asrProvider: 'local-parakeet',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    expect(resolveAsrKeyRef(settings)).toBeNull()
  })

  it('returns the configured keyRef for openai-audio', () => {
    const settings: AppSettings = {
      asrProvider: 'openai-audio',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
      openaiAudio: { model: 'gpt-4o-mini-transcribe', keyRef: 'openai', displayName: 'OpenAI' },
    }
    expect(resolveAsrKeyRef(settings)).toBe('openai')
  })
})

describe('getSharedKeyRef', () => {
  it('returns the keyRef when both roles use the same vendor key', () => {
    const settings: AppSettings = {
      asrProvider: 'openai-audio',
      extractionProvider: 'openai-compatible',
      primaryLanguage: 'nl',
      openaiAudio: { model: 'gpt-4o-mini-transcribe', keyRef: 'openai', displayName: 'OpenAI' },
      openaiCompatible: {
        preset: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4-mini',
        keyRef: 'openai',
        displayName: 'OpenAI',
      },
    }
    expect(getSharedKeyRef(settings)).toBe('openai')
  })

  it('returns null when the roles use different keys', () => {
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    expect(getSharedKeyRef(settings)).toBeNull()
  })

  it('returns null when one role has no key (on-device ASR)', () => {
    const settings: AppSettings = {
      asrProvider: 'local-parakeet',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    expect(getSharedKeyRef(settings)).toBeNull()
  })
})
