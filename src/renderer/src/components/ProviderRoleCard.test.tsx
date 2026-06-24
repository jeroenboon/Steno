/**
 * Tests for ProviderRoleCard component (Phase 0.4).
 *
 * Tests validate:
 *   - Rendering with grouped options
 *   - Provider selection via dropdown
 *   - Config panel visibility (progressive disclosure)
 *   - Disclosure copy display
 *   - Key status indicator
 */

import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ProviderRoleCard } from '../components/ProviderRoleCard'

describe('ProviderRoleCard — grouped provider selection', () => {
  it('renders the role title', () => {
    const mockOnChange = vi.fn()
    render(
      <ProviderRoleCard
        roleTitle="Audio"
        groups={[
          {
            label: 'Op dit apparaat',
            options: [{ value: 'local', label: 'Lokaal' }],
          },
        ]}
        selectedValue="local"
        configPanel={null}
        disclosure={<p>Test disclosure</p>}
        onChange={mockOnChange}
        testId="test-select"
      />,
    )

    expect(screen.getByText('Audio')).toBeDefined()
  })

  it('renders a select with optgroups for each provider group', () => {
    const mockOnChange = vi.fn()
    render(
      <ProviderRoleCard
        roleTitle="Audio"
        groups={[
          {
            label: 'Op dit apparaat',
            options: [{ value: 'local', label: 'Lokaal' }],
          },
          {
            label: 'Cloud',
            options: [{ value: 'deepgram', label: 'Deepgram' }],
          },
        ]}
        selectedValue="local"
        configPanel={null}
        disclosure={<p>Test disclosure</p>}
        onChange={mockOnChange}
        testId="test-select"
      />,
    )

    const select = screen.getByTestId('test-select')
    expect(select).toBeDefined()

    const selectElement = select as HTMLSelectElement
    expect(selectElement.value).toBe('local')

    const optgroups = Array.from(select.querySelectorAll('optgroup')).filter(
      (el): el is HTMLOptGroupElement => el instanceof HTMLOptGroupElement,
    )
    expect(optgroups.length).toBe(2)
    expect(optgroups[0]?.label).toBe('Op dit apparaat')
    expect(optgroups[1]?.label).toBe('Cloud')
  })

  it('calls onChange when a provider is selected', () => {
    const mockOnChange = vi.fn()
    render(
      <ProviderRoleCard
        roleTitle="Audio"
        groups={[
          {
            label: 'Op dit apparaat',
            options: [{ value: 'local', label: 'Lokaal' }],
          },
          {
            label: 'Cloud',
            options: [{ value: 'deepgram', label: 'Deepgram' }],
          },
        ]}
        selectedValue="local"
        configPanel={null}
        disclosure={<p>Test disclosure</p>}
        onChange={mockOnChange}
        testId="test-select"
      />,
    )

    const select = screen.getByTestId('test-select')
    fireEvent.change(select, { target: { value: 'deepgram' } })

    expect(mockOnChange).toHaveBeenCalledWith('deepgram')
  })

  it('renders selected provider value in the dropdown', () => {
    const mockOnChange = vi.fn()
    render(
      <ProviderRoleCard
        roleTitle="Audio"
        groups={[
          {
            label: 'Cloud',
            options: [{ value: 'deepgram', label: 'Deepgram' }],
          },
        ]}
        selectedValue="deepgram"
        configPanel={null}
        disclosure={<p>Test disclosure</p>}
        onChange={mockOnChange}
        testId="test-select"
      />,
    )

    const select = screen.getByTestId('test-select')
    const selectElement = select as HTMLSelectElement
    expect(selectElement.value).toBe('deepgram')
  })
})

describe('ProviderRoleCard — progressive disclosure', () => {
  it('shows config panel when provided', () => {
    const mockOnChange = vi.fn()
    render(
      <ProviderRoleCard
        roleTitle="Audio"
        groups={[
          {
            label: 'Cloud',
            options: [{ value: 'deepgram', label: 'Deepgram' }],
          },
        ]}
        selectedValue="deepgram"
        configPanel={<div data-testid="config-panel">Deepgram config</div>}
        disclosure={<p>Test disclosure</p>}
        onChange={mockOnChange}
        testId="test-select"
      />,
    )

    expect(screen.getByTestId('test-select-config')).toBeDefined()
    expect(screen.getByTestId('config-panel')).toBeDefined()
  })

  it('does not show config panel when configPanel is null', () => {
    const mockOnChange = vi.fn()
    render(
      <ProviderRoleCard
        roleTitle="Audio"
        groups={[
          {
            label: 'Cloud',
            options: [{ value: 'deepgram', label: 'Deepgram' }],
          },
        ]}
        selectedValue="deepgram"
        configPanel={null}
        disclosure={<p>Test disclosure</p>}
        onChange={mockOnChange}
        testId="test-select"
      />,
    )

    expect(screen.queryByTestId('test-select-config')).toBeNull()
  })

  it('displays different config panels when provider changes', () => {
    const mockOnChange = vi.fn()
    const { rerender } = render(
      <ProviderRoleCard
        roleTitle="Audio"
        groups={[
          {
            label: 'Cloud',
            options: [{ value: 'deepgram', label: 'Deepgram' }],
          },
        ]}
        selectedValue="deepgram"
        configPanel={<div data-testid="deepgram-config">Deepgram key input</div>}
        disclosure={<p>Deepgram disclosure</p>}
        onChange={mockOnChange}
        testId="test-select"
      />,
    )

    expect(screen.getByTestId('deepgram-config')).toBeDefined()

    rerender(
      <ProviderRoleCard
        roleTitle="Audio"
        groups={[
          {
            label: 'Op dit apparaat',
            options: [{ value: 'local', label: 'Lokaal' }],
          },
        ]}
        selectedValue="local"
        configPanel={<div data-testid="local-config">Local model section</div>}
        disclosure={<p>Local disclosure</p>}
        onChange={mockOnChange}
        testId="test-select"
      />,
    )

    expect(screen.queryByTestId('deepgram-config')).toBeNull()
    expect(screen.getByTestId('local-config')).toBeDefined()
  })
})

describe('ProviderRoleCard — disclosure copy', () => {
  it('renders disclosure copy', () => {
    const mockOnChange = vi.fn()
    render(
      <ProviderRoleCard
        roleTitle="Audio"
        groups={[
          {
            label: 'Cloud',
            options: [{ value: 'deepgram', label: 'Deepgram' }],
          },
        ]}
        selectedValue="deepgram"
        configPanel={null}
        disclosure={<p data-testid="disclosure-text">Audiogegevens gaan naar Deepgram</p>}
        onChange={mockOnChange}
        testId="test-select"
      />,
    )

    expect(screen.getByTestId('disclosure-text')).toBeDefined()
    expect(screen.getByTestId('disclosure-text').textContent).toContain('Audiogegevens')
  })
})

describe('ProviderRoleCard — shared key status', () => {
  it('shows key status when keyIsSet is true', () => {
    const mockOnChange = vi.fn()
    render(
      <ProviderRoleCard
        roleTitle="Audio"
        groups={[
          {
            label: 'Cloud',
            options: [{ value: 'deepgram', label: 'Deepgram' }],
          },
        ]}
        selectedValue="deepgram"
        configPanel={null}
        disclosure={<p>Test disclosure</p>}
        keyIsSet={true}
        onChange={mockOnChange}
        testId="test-select"
      />,
    )

    expect(screen.getByTestId('test-select-key-set')).toBeDefined()
    expect(screen.getByText('Sleutel al ingesteld')).toBeDefined()
  })

  it('does not show key status when keyIsSet is false', () => {
    const mockOnChange = vi.fn()
    render(
      <ProviderRoleCard
        roleTitle="Audio"
        groups={[
          {
            label: 'Cloud',
            options: [{ value: 'deepgram', label: 'Deepgram' }],
          },
        ]}
        selectedValue="deepgram"
        configPanel={null}
        disclosure={<p>Test disclosure</p>}
        keyIsSet={false}
        onChange={mockOnChange}
        testId="test-select"
      />,
    )

    expect(screen.queryByTestId('test-select-key-set')).toBeNull()
  })
})

describe('ProviderRoleCard — option sublabels', () => {
  it('renders sublabels when provided', () => {
    const mockOnChange = vi.fn()
    render(
      <ProviderRoleCard
        roleTitle="Audio"
        groups={[
          {
            label: 'Cloud',
            options: [
              { value: 'deepgram', label: 'Deepgram', sublabel: 'Real-time speech recognition' },
            ],
          },
        ]}
        selectedValue="deepgram"
        configPanel={null}
        disclosure={<p>Test disclosure</p>}
        onChange={mockOnChange}
        testId="test-select"
      />,
    )

    const select = screen.getByTestId('test-select')
    const option = select.querySelector('option[value="deepgram"]')
    expect(option?.textContent).toContain('Real-time speech recognition')
  })
})
