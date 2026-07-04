/**
 * Tests for the pure settings field validators. No rendering, no window.api.
 * Error messages come from i18n, so we assert on presence/absence of a field's
 * error rather than the exact copy.
 */

import { describe, expect, it } from 'vitest'

import {
  isValidUrl,
  validateAudioFields,
  validateAzureFields,
  validateCustomFields,
  type AudioAsrFields,
  type AzureFields,
  type CustomFields,
} from './settingsValidation'

const validCustom: CustomFields = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  displayName: 'OpenAI',
  keyRef: 'openai',
}

const validAzure: AzureFields = {
  endpoint: 'https://my-resource.openai.azure.com/',
  deployment: 'my-deployment',
  apiVersion: '2024-12-01-preview',
  model: 'gpt-4o-mini',
  displayName: 'Azure OpenAI',
  keyRef: 'azure',
}

describe('isValidUrl', () => {
  it('accepts an absolute URL', () => {
    expect(isValidUrl('https://api.openai.com/v1')).toBe(true)
  })

  it('rejects a non-URL string', () => {
    expect(isValidUrl('not a url')).toBe(false)
    expect(isValidUrl('')).toBe(false)
  })
})

describe('validateCustomFields', () => {
  it('returns no errors for a valid config', () => {
    expect(validateCustomFields(validCustom)).toEqual({})
  })

  it('flags an invalid base URL', () => {
    const errors = validateCustomFields({ ...validCustom, baseUrl: 'nope' })
    expect(errors.baseUrl).toBeDefined()
    expect(errors.model).toBeUndefined()
  })

  it('flags a blank model and a blank display name', () => {
    const errors = validateCustomFields({ ...validCustom, model: '  ', displayName: '' })
    expect(errors.model).toBeDefined()
    expect(errors.displayName).toBeDefined()
    expect(errors.baseUrl).toBeUndefined()
  })
})

describe('validateAudioFields', () => {
  const audio: AudioAsrFields = {
    model: 'gpt-4o-mini-transcribe',
    endpoint: '',
    deployment: '',
    apiVersion: '2024-06-01',
    keyRef: 'openai',
    displayName: 'OpenAI',
  }

  it('needs only a model for OpenAI/Mistral', () => {
    expect(validateAudioFields('openai-audio', audio)).toEqual({})
    expect(validateAudioFields('mistral-voxtral', { ...audio, model: '' }).model).toBeDefined()
  })

  it('needs a valid endpoint and deployment for Azure Speech', () => {
    const errors = validateAudioFields('azure-speech', audio)
    expect(errors.endpoint).toBeDefined()
    expect(errors.deployment).toBeDefined()

    const ok = validateAudioFields('azure-speech', {
      ...audio,
      endpoint: 'https://x.cognitiveservices.azure.com/',
      deployment: 'whisper',
    })
    expect(ok).toEqual({})
  })
})

describe('validateAzureFields', () => {
  it('returns no errors for a valid config', () => {
    expect(validateAzureFields(validAzure)).toEqual({})
  })

  it('flags an invalid endpoint URL', () => {
    const errors = validateAzureFields({ ...validAzure, endpoint: 'nope' })
    expect(errors.endpoint).toBeDefined()
  })

  it('flags every blank required field', () => {
    const errors = validateAzureFields({
      ...validAzure,
      deployment: '',
      apiVersion: '  ',
      model: '',
      displayName: '',
    })
    expect(errors.deployment).toBeDefined()
    expect(errors.apiVersion).toBeDefined()
    expect(errors.model).toBeDefined()
    expect(errors.displayName).toBeDefined()
  })
})
