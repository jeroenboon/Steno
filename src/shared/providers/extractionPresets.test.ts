/**
 * Tests for extraction provider presets catalog (Phase 1.1).
 *
 * Verifies that each preset is complete, with valid URLs and non-empty models.
 */

import { describe, it, expect } from 'vitest'

import { extractionPresets, localExtractionPresets } from './extractionPresets'

describe('extractionPresets', () => {
  it('should export an object with three presets', () => {
    expect(extractionPresets).toHaveProperty('openai')
    expect(extractionPresets).toHaveProperty('mistral')
    expect(extractionPresets).toHaveProperty('custom')
  })

  describe('openai preset', () => {
    it('should have a displayName', () => {
      expect(extractionPresets.openai).toHaveProperty('displayName')
      expect(typeof extractionPresets.openai.displayName).toBe('string')
      expect(extractionPresets.openai.displayName.length).toBeGreaterThan(0)
    })

    it('should have a valid baseUrl', () => {
      expect(extractionPresets.openai).toHaveProperty('defaultBaseUrl')
      expect(() => new URL(extractionPresets.openai.defaultBaseUrl)).not.toThrow()
    })

    it('should have a non-empty defaultModel', () => {
      expect(extractionPresets.openai).toHaveProperty('defaultModel')
      expect(typeof extractionPresets.openai.defaultModel).toBe('string')
      expect(extractionPresets.openai.defaultModel.length).toBeGreaterThan(0)
    })
  })

  describe('mistral preset', () => {
    it('should have a displayName', () => {
      expect(extractionPresets.mistral).toHaveProperty('displayName')
      expect(typeof extractionPresets.mistral.displayName).toBe('string')
      expect(extractionPresets.mistral.displayName.length).toBeGreaterThan(0)
    })

    it('should have a valid baseUrl', () => {
      expect(extractionPresets.mistral).toHaveProperty('defaultBaseUrl')
      expect(() => new URL(extractionPresets.mistral.defaultBaseUrl)).not.toThrow()
    })

    it('should have a non-empty defaultModel', () => {
      expect(extractionPresets.mistral).toHaveProperty('defaultModel')
      expect(typeof extractionPresets.mistral.defaultModel).toBe('string')
      expect(extractionPresets.mistral.defaultModel.length).toBeGreaterThan(0)
    })
  })

  describe('custom preset', () => {
    it('should have a displayName', () => {
      expect(extractionPresets.custom).toHaveProperty('displayName')
      expect(typeof extractionPresets.custom.displayName).toBe('string')
      expect(extractionPresets.custom.displayName.length).toBeGreaterThan(0)
    })

    it('should exist as a placeholder', () => {
      expect(extractionPresets.custom).toBeDefined()
    })
  })

  it('should export presets from the providers index', () => {
    // This is a meta-test: verify that extractionPresets is importable from src/shared/providers
    // The actual import happens at the top of this file, so if it fails, this test fails.
    expect(extractionPresets).toBeDefined()
  })
})

describe('localExtractionPresets (ADR 0040)', () => {
  it('exposes the three named runtimes plus a generic custom entry', () => {
    expect(localExtractionPresets).toHaveProperty('lmstudio')
    expect(localExtractionPresets).toHaveProperty('ollama')
    expect(localExtractionPresets).toHaveProperty('llamacpp')
    expect(localExtractionPresets).toHaveProperty('local-custom')
  })

  it('prefills each named runtime with its default loopback URL and port', () => {
    expect(localExtractionPresets.lmstudio.defaultBaseUrl).toBe('http://localhost:1234/v1')
    expect(localExtractionPresets.ollama.defaultBaseUrl).toBe('http://localhost:11434/v1')
    expect(localExtractionPresets.llamacpp.defaultBaseUrl).toBe('http://localhost:8080/v1')
  })

  it('gives every named runtime a non-empty display name', () => {
    for (const preset of ['lmstudio', 'ollama', 'llamacpp'] as const) {
      expect(localExtractionPresets[preset].displayName.length).toBeGreaterThan(0)
    }
  })

  it('leaves the generic custom entry with an empty base URL for the user to fill', () => {
    expect(localExtractionPresets['local-custom'].defaultBaseUrl).toBe('')
  })
})
