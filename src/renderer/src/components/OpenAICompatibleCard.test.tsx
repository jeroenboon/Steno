/**
 * Tests for OpenAICompatibleCard — its own responsibilities: reveal-dirty Save
 * gating, client-side validation blocking a save, and emitting validated fields
 * to onSave. Preset prefill + the union merge live in the SettingsScreen suite.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS } from '../../../shared/settings/settingsSchema'
import type { CustomFields } from '../screens/settingsValidation'
import type { SecretKeyField } from '../screens/useSecretKeyField'

import { OpenAICompatibleCard } from './OpenAICompatibleCard'

const validFields: CustomFields = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  displayName: 'OpenAI',
  keyRef: 'openai',
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

function renderCard(overrides: {
  initialFields?: CustomFields
  initiallyDirty?: boolean
  onSave?: (f: CustomFields) => Promise<void>
}) {
  const onSave = overrides.onSave ?? vi.fn().mockResolvedValue(undefined)
  render(
    <OpenAICompatibleCard
      keyField={stubKeyField()}
      settings={DEFAULT_SETTINGS}
      initialFields={overrides.initialFields ?? validFields}
      initiallyDirty={overrides.initiallyDirty ?? false}
      onSave={onSave}
    />,
  )
  return { onSave }
}

describe('OpenAICompatibleCard', () => {
  it('renders the base URL, model and display-name fields plus the key input', () => {
    renderCard({})

    expect(screen.getByTestId('custom-openai-base-url')).toBeInTheDocument()
    expect(screen.getByTestId('custom-openai-model')).toBeInTheDocument()
    expect(screen.getByTestId('custom-openai-display-name')).toBeInTheDocument()
    expect(screen.getByTestId('custom-openai-key')).toBeInTheDocument()
  })

  it('starts with Save disabled on a clean load, enabled once a field is edited', () => {
    renderCard({ initiallyDirty: false })
    const save = screen.getByTestId('save-custom-openai')
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByTestId('custom-openai-model'), {
      target: { value: 'gpt-4o' },
    })
    expect(save).toBeEnabled()
  })

  it('enables Save immediately when initiallyDirty (just revealed)', () => {
    renderCard({ initiallyDirty: true })
    expect(screen.getByTestId('save-custom-openai')).toBeEnabled()
  })

  it('blocks the save when the base URL is invalid', () => {
    const { onSave } = renderCard({
      initialFields: { ...validFields, baseUrl: 'not-a-url' },
      initiallyDirty: true,
    })

    fireEvent.click(screen.getByTestId('save-custom-openai'))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('emits the validated fields to onSave when valid', () => {
    const { onSave } = renderCard({ initialFields: validFields, initiallyDirty: true })

    fireEvent.click(screen.getByTestId('save-custom-openai'))

    expect(onSave).toHaveBeenCalledWith(validFields)
  })
})
