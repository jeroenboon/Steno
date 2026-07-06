/**
 * Tests for TestConnectionButton (Phase 5.1).
 *
 * The button runs one provider:testConnection round-trip and surfaces the
 * outcome in Dutch. window.api is mocked; no IPC, no network.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProviderTestConnectionResponse } from '../../../shared/ipc'

const providerTestConnection = vi.fn<
  [{ role: 'asr' | 'extraction' }],
  Promise<ProviderTestConnectionResponse>
>()

Object.defineProperty(window, 'api', {
  value: { providerTestConnection },
  writable: true,
  configurable: true,
})

const { TestConnectionButton } = await import('./TestConnectionButton')

describe('TestConnectionButton', () => {
  beforeEach(() => {
    providerTestConnection.mockReset()
  })

  it('probes the given role and shows a success message', async () => {
    providerTestConnection.mockResolvedValue({ ok: true })
    render(<TestConnectionButton role="extraction" testId="test-extraction" />)

    fireEvent.click(screen.getByTestId('test-extraction'))

    await waitFor(() => {
      expect(screen.getByTestId('test-extraction-result').textContent).toBe('Verbinding gelukt')
    })
    expect(providerTestConnection).toHaveBeenCalledWith({ role: 'extraction' })
  })

  it('shows the HTTP status code on an auth failure', async () => {
    providerTestConnection.mockResolvedValue({ ok: false, error: 'HTTP 401' })
    render(<TestConnectionButton role="asr" testId="test-asr" />)

    fireEvent.click(screen.getByTestId('test-asr'))

    await waitFor(() => {
      expect(screen.getByTestId('test-asr-result').textContent).toContain('HTTP 401')
    })
  })

  it('shows a friendly hint when the key has not been saved yet', async () => {
    providerTestConnection.mockResolvedValue({ ok: false, error: 'no-key' })
    render(<TestConnectionButton role="extraction" testId="test-extraction" />)

    fireEvent.click(screen.getByTestId('test-extraction'))

    await waitFor(() => {
      expect(screen.getByTestId('test-extraction-result').textContent).toBe(
        'Sla eerst de API-sleutel op',
      )
    })
  })

  it('shows a local "server unreachable" hint including the endpoint', async () => {
    providerTestConnection.mockResolvedValue({ ok: false, error: 'local-unreachable' })
    render(
      <TestConnectionButton
        role="extraction"
        testId="test-extraction"
        endpoint="http://localhost:1234/v1"
      />,
    )

    fireEvent.click(screen.getByTestId('test-extraction'))

    await waitFor(() => {
      const text = screen.getByTestId('test-extraction-result').textContent
      expect(text).toContain('Kon de lokale server niet bereiken')
      expect(text).toContain('http://localhost:1234/v1')
    })
  })

  it('shows a local "model not loaded" hint on local-model-missing', async () => {
    providerTestConnection.mockResolvedValue({ ok: false, error: 'local-model-missing' })
    render(<TestConnectionButton role="extraction" testId="test-extraction" />)

    fireEvent.click(screen.getByTestId('test-extraction'))

    await waitFor(() => {
      expect(screen.getByTestId('test-extraction-result').textContent).toContain(
        'model werd niet gevonden',
      )
    })
  })

  it('shows a local "key required" hint on local-auth', async () => {
    providerTestConnection.mockResolvedValue({ ok: false, error: 'local-auth' })
    render(<TestConnectionButton role="extraction" testId="test-extraction" />)

    fireEvent.click(screen.getByTestId('test-extraction'))

    await waitFor(() => {
      expect(screen.getByTestId('test-extraction-result').textContent).toContain(
        'vraagt om een sleutel',
      )
    })
  })
})
