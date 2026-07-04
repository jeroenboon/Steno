/**
 * Tests for AzureExtractionCard — the card's own responsibilities: the reveal-
 * dirty Save gating, client-side validation blocking a save, and emitting the
 * validated fields to onSave. The end-to-end persist path is covered by the
 * SettingsScreen suite.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS } from '../../../shared/settings/settingsSchema'
import type { AzureFields } from '../screens/settingsValidation'
import type { SecretKeyField } from '../screens/useSecretKeyField'

import { AzureExtractionCard } from './AzureExtractionCard'

const validFields: AzureFields = {
  endpoint: 'https://my-resource.openai.azure.com/',
  deployment: 'my-deployment',
  apiVersion: '2024-12-01-preview',
  model: 'gpt-4o-mini',
  displayName: 'Azure OpenAI',
  keyRef: 'azure',
}

function stubKeyField(): SecretKeyField {
  return {
    value: '',
    saveState: 'idle',
    editing: false,
    present: true,
    change: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    beginReplace: vi.fn(),
    cancel: vi.fn(),
    setPresent: vi.fn(),
    resetSaveState: vi.fn(),
  }
}

function renderCard(overrides: {
  initialFields?: AzureFields
  initiallyDirty?: boolean
  onSave?: (f: AzureFields) => Promise<void>
}) {
  const onSave = overrides.onSave ?? vi.fn().mockResolvedValue(undefined)
  render(
    <AzureExtractionCard
      keyField={stubKeyField()}
      settings={DEFAULT_SETTINGS}
      initialFields={overrides.initialFields ?? validFields}
      initiallyDirty={overrides.initiallyDirty ?? false}
      onSave={onSave}
    />,
  )
  return { onSave }
}

describe('AzureExtractionCard', () => {
  it('renders the five config fields and the key input', () => {
    renderCard({})

    expect(screen.getByTestId('azure-openai-endpoint')).toBeInTheDocument()
    expect(screen.getByTestId('azure-openai-deployment')).toBeInTheDocument()
    expect(screen.getByTestId('azure-openai-api-version')).toBeInTheDocument()
    expect(screen.getByTestId('azure-openai-model')).toBeInTheDocument()
    expect(screen.getByTestId('azure-openai-display-name')).toBeInTheDocument()
  })

  it('starts with Save disabled on a clean load, enabled once a field is edited', () => {
    renderCard({ initiallyDirty: false })
    const save = screen.getByTestId('save-azure-openai')
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByTestId('azure-openai-deployment'), {
      target: { value: 'other-deployment' },
    })
    expect(save).toBeEnabled()
  })

  it('enables Save immediately when initiallyDirty (just switched to Azure)', () => {
    renderCard({ initiallyDirty: true })
    expect(screen.getByTestId('save-azure-openai')).toBeEnabled()
  })

  it('blocks the save and shows errors when a field is invalid', () => {
    const { onSave } = renderCard({
      initialFields: { ...validFields, endpoint: 'not-a-url', model: '' },
      initiallyDirty: true,
    })

    fireEvent.click(screen.getByTestId('save-azure-openai'))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('emits the validated fields to onSave when valid', () => {
    const { onSave } = renderCard({ initialFields: validFields, initiallyDirty: true })

    fireEvent.click(screen.getByTestId('save-azure-openai'))

    expect(onSave).toHaveBeenCalledWith(validFields)
  })
})
