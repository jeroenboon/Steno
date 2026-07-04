/**
 * Tests for ProviderKeyCard — the key-only provider block (Deepgram, Anthropic).
 *
 * Verifies the wiring the card is responsible for: the KeyField / help / test
 * button all render with the test-ids derived from keyRef + role, and Save
 * delegates to the injected keyField.save(keyRef). The full behaviour lives in
 * the SettingsScreen suite; this pins the derivation so a rename can't slip past.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { SecretKeyField } from '../screens/useSecretKeyField'

import { ProviderKeyCard } from './ProviderKeyCard'

function stubKeyField(overrides: Partial<SecretKeyField> = {}): SecretKeyField {
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
    ...overrides,
  }
}

function renderCard(keyField: SecretKeyField) {
  return render(
    <ProviderKeyCard
      keyField={keyField}
      keyRef="deepgram"
      role="asr"
      label="Deepgram key"
      placeholder="dg-..."
      missingText="Geen sleutel"
    />,
  )
}

describe('ProviderKeyCard', () => {
  it('derives the KeyField, help and test-connection test-ids from keyRef + role', () => {
    renderCard(stubKeyField({ value: 'x' }))

    expect(screen.getByTestId('deepgram-key-input')).toBeInTheDocument()
    expect(screen.getByTestId('save-deepgram-key')).toBeInTheDocument()
    expect(screen.getByTestId('deepgram-key-help')).toBeInTheDocument()
    expect(screen.getByTestId('test-asr-connection')).toBeInTheDocument()
  })

  it('delegates Save to keyField.save(keyRef)', () => {
    const keyField = stubKeyField({ value: 'sk-123' })
    renderCard(keyField)

    fireEvent.click(screen.getByTestId('save-deepgram-key'))

    expect(keyField.save).toHaveBeenCalledWith('deepgram')
  })

  it('shows the saved-status badge (not the input) once the key is present', () => {
    renderCard(stubKeyField({ present: true }))

    expect(screen.getByTestId('deepgram-key-status')).toBeInTheDocument()
    expect(screen.queryByTestId('deepgram-key-input')).not.toBeInTheDocument()
  })
})
