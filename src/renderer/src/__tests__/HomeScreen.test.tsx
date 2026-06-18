/**
 * HomeScreen component tests (item 0023).
 *
 * Tests verify:
 * - "Nieuwe vergadering" button navigates to draft
 * - Empty state when no past meetings exist
 * - Past ended meetings render with title and date
 * - Interrupted (live) meetings are shown greyed and not clickable
 * - Clicking an ended meeting loads it and navigates to review
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { HomeScreen } from '../screens/HomeScreen'
import { useAppStore } from '../store/appStore'

const mockApi = {
  meetingList: vi.fn(),
  meetingLoad: vi.fn(),
}

Object.assign(window, {
  api: mockApi,
})

describe('HomeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ route: 'home' })
  })

  it('renders the new meeting button', () => {
    mockApi.meetingList.mockResolvedValue({ meetings: [] })
    render(<HomeScreen />)
    expect(screen.getByTestId('home-new-meeting')).toBeInTheDocument()
  })

  it('"Nieuwe vergadering" navigates to draft', async () => {
    const user = userEvent.setup()
    mockApi.meetingList.mockResolvedValue({ meetings: [] })
    render(<HomeScreen />)

    await user.click(screen.getByTestId('home-new-meeting'))

    expect(useAppStore.getState().route).toBe('draft')
  })
  it('shows empty state when no past meetings exist', async () => {
    mockApi.meetingList.mockResolvedValue({ meetings: [] })
    render(<HomeScreen />)

    await screen.findByTestId('home-empty-state')
    expect(screen.getByTestId('home-empty-state')).toBeInTheDocument()
  })

  it('renders a list of ended meetings', async () => {
    mockApi.meetingList.mockResolvedValue({
      meetings: [
        {
          id: 'mtg-1',
          title: 'Q3 Planning',
          state: 'ended',
          paused: false,
          createdAt: '2026-06-01T10:00:00.000Z',
          primaryLanguage: 'nl',
        },
        {
          id: 'mtg-2',
          title: 'Retrospective',
          state: 'ended',
          paused: false,
          createdAt: '2026-06-05T14:00:00.000Z',
          primaryLanguage: 'nl',
        },
      ],
    })
    render(<HomeScreen />)

    await waitFor(() => {
      expect(screen.getAllByTestId('home-meeting-item')).toHaveLength(2)
    })
    expect(screen.getByText('Q3 Planning')).toBeInTheDocument()
    expect(screen.getByText('Retrospective')).toBeInTheDocument()
  })

  it('clicking an ended meeting loads it and navigates to review', async () => {
    const user = userEvent.setup()
    const meeting = {
      id: 'mtg-1',
      title: 'Q3 Planning',
      state: 'ended',
      paused: false,
      createdAt: '2026-06-01T10:00:00.000Z',
      primaryLanguage: 'nl',
      endedAt: '2026-06-01T11:00:00.000Z',
    }
    mockApi.meetingList.mockResolvedValue({ meetings: [meeting] })
    mockApi.meetingLoad.mockResolvedValue({
      meeting,
      decisions: [],
      actions: [],
      agendaItems: [],
      participants: [],
      summaries: [],
    })

    render(<HomeScreen />)

    const btn = await screen.findByRole('button', { name: /Q3 Planning/i })
    await user.click(btn)

    expect(mockApi.meetingLoad).toHaveBeenCalledWith({ meetingId: 'mtg-1' })
    await waitFor(() => {
      expect(useAppStore.getState().route).toBe('review')
    })
  })

  it('interrupted meetings are shown but their button is disabled', async () => {
    mockApi.meetingList.mockResolvedValue({
      meetings: [
        {
          id: 'mtg-live',
          title: 'Interrupted meeting',
          state: 'live',
          paused: false,
          createdAt: '2026-06-10T09:00:00.000Z',
          primaryLanguage: 'nl',
        },
      ],
    })
    render(<HomeScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('home-meeting-item')).toBeInTheDocument()
    })
    const btn = screen.getByRole('button', { name: /Interrupted meeting/i })
    expect(btn).toBeDisabled()
  })
})
