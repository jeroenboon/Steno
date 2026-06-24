/**
 * Tests for SharedKeyNotice (Phase 5.2).
 *
 * Shows a one-line notice in a provider's key panel when that key is shared by
 * both the ASR and extraction roles, so the user knows a replace affects both.
 */

import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'

import type { AppSettings } from '../../../shared/settings/settingsSchema'

import { SharedKeyNotice } from './SharedKeyNotice'

const sharedOpenAI: AppSettings = {
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

describe('SharedKeyNotice', () => {
  it('renders the notice when the keyRef is shared by both roles', () => {
    render(<SharedKeyNotice settings={sharedOpenAI} keyRef="openai" testId="shared-openai" />)
    expect(screen.getByTestId('shared-openai').textContent).toMatch(
      /audio.*notulen|notulen.*audio/i,
    )
  })

  it('renders nothing when the keyRef is not shared', () => {
    const settings: AppSettings = {
      asrProvider: 'deepgram',
      extractionProvider: 'anthropic',
      primaryLanguage: 'nl',
    }
    render(<SharedKeyNotice settings={settings} keyRef="deepgram" testId="shared-deepgram" />)
    expect(screen.queryByTestId('shared-deepgram')).toBeNull()
  })
})
