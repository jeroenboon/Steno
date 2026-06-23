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

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest'

import { HomeScreen } from '../screens/HomeScreen'
import { useAppStore } from '../store/appStore'

const mockApi = {
  meetingList: vi.fn(),
  meetingLoad: vi.fn(),
  meetingDelete: vi.fn().mockResolvedValue({ ok: true }),
}

Object.assign(window, {
  api: mockApi,
})

describe('HomeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ route: 'home' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the new meeting button', () => {
    mockApi.meetingList.mockResolvedValue({ meetings: [] })
    render(<HomeScreen />)
    expect(screen.getByTestId('home-new-meeting')).toBeInTheDocument()
  })

  it("renders today's date as page header", () => {
    mockApi.meetingList.mockResolvedValue({ meetings: [] })
    render(<HomeScreen />)

    const header = screen.getByTestId('home-date-header')
    const expected = new Date().toLocaleDateString('nl-NL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    expect(header).toHaveTextContent(expected)
  })

  it('"Nieuwe vergadering" navigates to draft', async () => {
    const user = userEvent.setup()
    mockApi.meetingList.mockResolvedValue({ meetings: [] })
    render(<HomeScreen />)

    await user.click(screen.getByTestId('home-new-meeting'))

    expect(useAppStore.getState().route).toBe('draft')
  })

  it('"Importeer opname" navigates to import', async () => {
    const user = userEvent.setup()
    mockApi.meetingList.mockResolvedValue({ meetings: [] })
    render(<HomeScreen />)

    await user.click(screen.getByTestId('home-import'))

    expect(useAppStore.getState().route).toBe('import')
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

    // Anchored so it matches the reopen button, not the "Verwijderen …" button.
    const btn = await screen.findByRole('button', { name: /^Q3 Planning/ })
    await user.click(btn)

    expect(mockApi.meetingLoad).toHaveBeenCalledWith({ meetingId: 'mtg-1' })
    await waitFor(() => {
      expect(useAppStore.getState().route).toBe('review')
    })
  })

  it('deletes an ended meeting after a full hold-to-confirm', async () => {
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
      ],
    })
    render(<HomeScreen />)

    const del = await screen.findByTestId('home-delete')

    // Hold for the full 1.5s: the delete fires (no confirm dialog, no red).
    vi.useFakeTimers()
    fireEvent.pointerDown(del)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    vi.useRealTimers()

    expect(mockApi.meetingDelete).toHaveBeenCalledWith({ meetingId: 'mtg-1' })
    await waitFor(() => {
      expect(screen.queryByTestId('home-meeting-item')).not.toBeInTheDocument()
    })
  })

  it('releasing the hold early keeps the meeting', async () => {
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
      ],
    })
    render(<HomeScreen />)

    const del = await screen.findByTestId('home-delete')

    vi.useFakeTimers()
    fireEvent.pointerDown(del)
    vi.advanceTimersByTime(800)
    fireEvent.pointerUp(del)
    vi.advanceTimersByTime(2000)
    vi.useRealTimers()

    expect(mockApi.meetingDelete).not.toHaveBeenCalled()
    expect(screen.getByTestId('home-meeting-item')).toBeInTheDocument()
  })

  it('interrupted meeting is shown in a callout, not in the history list', async () => {
    useAppStore.setState({ activeMeeting: null })
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

    const callout = await screen.findByTestId('home-interrupted-callout')
    expect(callout).toHaveTextContent('Interrupted meeting')
    expect(screen.queryByTestId('home-meeting-item')).not.toBeInTheDocument()
  })

  it('Hervat button in interrupted callout is disabled', async () => {
    useAppStore.setState({ activeMeeting: null })
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

    const callout = await screen.findByTestId('home-interrupted-callout')
    const hervat = within(callout).getByRole('button', { name: /hervat/i })
    expect(hervat).toBeDisabled()
  })

  it('shows active callout when meeting is currently running in this session', async () => {
    useAppStore.setState({ activeMeeting: 'mtg-live' })
    mockApi.meetingList.mockResolvedValue({
      meetings: [
        {
          id: 'mtg-live',
          title: 'Q4 Kick-off',
          state: 'live',
          paused: false,
          createdAt: '2026-06-10T09:00:00.000Z',
          primaryLanguage: 'nl',
        },
      ],
    })
    render(<HomeScreen />)

    const callout = await screen.findByTestId('home-active-callout')
    expect(callout).toHaveTextContent('Q4 Kick-off')
    expect(screen.queryByTestId('home-interrupted-callout')).not.toBeInTheDocument()
  })

  it('Terug button in active callout navigates to live screen', async () => {
    const user = userEvent.setup()
    useAppStore.setState({ activeMeeting: 'mtg-live' })
    mockApi.meetingList.mockResolvedValue({
      meetings: [
        {
          id: 'mtg-live',
          title: 'Q4 Kick-off',
          state: 'live',
          paused: false,
          createdAt: '2026-06-10T09:00:00.000Z',
          primaryLanguage: 'nl',
        },
      ],
    })
    render(<HomeScreen />)

    const callout = await screen.findByTestId('home-active-callout')
    const terug = within(callout).getByRole('button', { name: /terug/i })
    await user.click(terug)

    expect(useAppStore.getState().route).toBe('live')
  })
})
