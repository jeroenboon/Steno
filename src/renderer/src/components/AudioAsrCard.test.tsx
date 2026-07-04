/**
 * Tests for AudioAsrCard — its own responsibilities: provider-specific fields,
 * reveal-dirty Save gating, validation blocking a save, and emitting the
 * validated fields to onSave. The persist path is covered by SettingsScreen.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS } from '../../../shared/settings/settingsSchema'
import type { AudioAsrFields } from '../screens/settingsValidation'
import type { SecretKeyField } from '../screens/useSecretKeyField'

import { AudioAsrCard } from './AudioAsrCard'

const openaiFields: AudioAsrFields = {
  model: 'gpt-4o-mini-transcribe',
  endpoint: '',
  deployment: '',
  apiVersion: '2024-06-01',
  keyRef: 'openai',
  displayName: 'OpenAI',
}

function stubKeyField(): SecretKeyField {
  return {
    value: '',
    saveState: 'idle',
    editing: false,
    present: false,
    change: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    beginReplace: vi.fn(),
    cancel: vi.fn(),
    setPresent: vi.fn(),
    resetSaveState: vi.fn(),
  }
}

type Provider = 'openai-audio' | 'mistral-voxtral' | 'azure-speech'

function renderCard(overrides: {
  provider?: Provider
  initialFields?: AudioAsrFields
  initiallyDirty?: boolean
  onSave?: (p: Provider, f: AudioAsrFields) => Promise<void>
}) {
  const onSave = overrides.onSave ?? vi.fn().mockResolvedValue(undefined)
  render(
    <AudioAsrCard
      keyField={stubKeyField()}
      settings={DEFAULT_SETTINGS}
      provider={overrides.provider ?? 'openai-audio'}
      initialFields={overrides.initialFields ?? openaiFields}
      modelPlaceholder="gpt-4o-mini-transcribe"
      initiallyDirty={overrides.initiallyDirty ?? false}
      onSave={onSave}
    />,
  )
  return { onSave }
}

describe('AudioAsrCard', () => {
  it('shows only the model field for OpenAI/Mistral', () => {
    renderCard({ provider: 'openai-audio' })
    expect(screen.getByTestId('audio-model')).toBeInTheDocument()
    expect(screen.queryByTestId('azure-speech-endpoint')).not.toBeInTheDocument()
  })

  it('shows the endpoint/deployment/apiVersion fields for Azure Speech', () => {
    renderCard({ provider: 'azure-speech' })
    expect(screen.getByTestId('azure-speech-endpoint')).toBeInTheDocument()
    expect(screen.getByTestId('azure-speech-deployment')).toBeInTheDocument()
    expect(screen.getByTestId('azure-speech-api-version')).toBeInTheDocument()
  })

  it('starts with Save disabled on a clean load, enabled once a field is edited', () => {
    renderCard({ initiallyDirty: false })
    const save = screen.getByTestId('save-audio-config')
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByTestId('audio-model'), { target: { value: 'whisper-1' } })
    expect(save).toBeEnabled()
  })

  it('enables Save immediately when initiallyDirty (just switched)', () => {
    renderCard({ initiallyDirty: true })
    expect(screen.getByTestId('save-audio-config')).toBeEnabled()
  })

  it('blocks the save when Azure Speech has no endpoint', () => {
    const { onSave } = renderCard({
      provider: 'azure-speech',
      initialFields: { ...openaiFields, keyRef: 'azure', displayName: 'Azure Speech' },
      initiallyDirty: true,
    })

    fireEvent.click(screen.getByTestId('save-audio-config'))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('emits the provider and validated fields to onSave when valid', () => {
    const { onSave } = renderCard({ provider: 'openai-audio', initiallyDirty: true })

    fireEvent.click(screen.getByTestId('save-audio-config'))

    expect(onSave).toHaveBeenCalledWith('openai-audio', openaiFields)
  })
})
