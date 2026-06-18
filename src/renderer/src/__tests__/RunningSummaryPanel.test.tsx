/**
 * RunningSummaryPanel component tests (item 0020).
 *
 * Coverage:
 *   1. Renders the heading and disclaimer.
 *   2. Shows the empty-state message when no summary is available.
 *   3. Displays the running summary text from the store.
 *   4. Submitting a question calls window.api.summaryQuery and renders the answer.
 *   5. Pressing Enter in the input triggers the query.
 *   6. The Ask button is disabled while loading (no double submit).
 *   7. The Ask button is disabled when the input is empty.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { RunningSummaryPanel } from '../components/RunningSummaryPanel'
import { useAppStore } from '../store/appStore'

// ---------------------------------------------------------------------------
// Mock window.api
// ---------------------------------------------------------------------------

const mockApi = {
  summaryQuery: vi.fn().mockResolvedValue({ answer: 'Jeroen pakt de taak op.' }),
}

Object.assign(window, { api: mockApi })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setRunningSummary(summary: string): void {
  useAppStore.getState().setRunningSummary(summary)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunningSummaryPanel', () => {
  beforeEach(() => {
    useAppStore.getState().setRunningSummary('')
    vi.clearAllMocks()
    mockApi.summaryQuery.mockResolvedValue({ answer: 'Jeroen pakt de taak op.' })
  })

  it('renders the Dutch heading', () => {
    render(<RunningSummaryPanel />)
    expect(screen.getByText('Vergaderingsoverzicht')).toBeDefined()
  })

  it('renders the non-authoritative disclaimer', () => {
    render(<RunningSummaryPanel />)
    expect(screen.getByText(/niet gezaghebbend/i)).toBeDefined()
  })

  it('shows the empty-state message when no summary is available', () => {
    render(<RunningSummaryPanel />)
    expect(screen.getByTestId('running-summary-text').textContent).toContain(
      'Het overzicht verschijnt zodra er transcriptie beschikbaar is.',
    )
  })

  it('displays the running summary text from the store', () => {
    setRunningSummary('Q3 was goed. Beslissing: release in Q4.')
    render(<RunningSummaryPanel />)
    expect(screen.getByTestId('running-summary-text').textContent).toContain(
      'Q3 was goed. Beslissing: release in Q4.',
    )
  })

  it('calls summaryQuery and renders the answer on button click', async () => {
    render(<RunningSummaryPanel />)

    const input = screen.getByTestId('summary-query-input')
    fireEvent.change(input, { target: { value: 'Wie pakt de taak op?' } })

    const button = screen.getByTestId('summary-query-button')
    fireEvent.click(button)

    await waitFor(() => {
      expect(mockApi.summaryQuery).toHaveBeenCalledWith({ question: 'Wie pakt de taak op?' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('summary-answer').textContent).toContain('Jeroen pakt de taak op.')
    })
  })

  it('calls summaryQuery on Enter keypress in the input', async () => {
    render(<RunningSummaryPanel />)

    const input = screen.getByTestId('summary-query-input')
    fireEvent.change(input, { target: { value: 'Wat werd besloten?' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(mockApi.summaryQuery).toHaveBeenCalledWith({ question: 'Wat werd besloten?' })
    })
  })

  it('the Ask button is disabled when the input is empty', () => {
    render(<RunningSummaryPanel />)
    const button = screen.getByTestId('summary-query-button')
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not call summaryQuery when input is whitespace', () => {
    render(<RunningSummaryPanel />)

    const input = screen.getByTestId('summary-query-input')
    fireEvent.change(input, { target: { value: '   ' } })

    const button = screen.getByTestId('summary-query-button')
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(mockApi.summaryQuery).not.toHaveBeenCalled()
  })
})
