/**
 * LiveHeader tests (A1 — re-homed from LiveScreen.test.tsx).
 *
 * The header owns the pause/resume + end-meeting controls and the finalising
 * overlay they raise. Store-connected; setCapturePaused is a prop from the
 * useLiveSession hook.
 */

import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { useAppStore } from '../store/appStore'

import { LiveHeader } from './LiveHeader'

const mockApi = {
  meetingEnd: vi.fn().mockResolvedValue({ ok: true }),
  meetingPause: vi.fn().mockResolvedValue({ id: 'active-session', paused: true }),
  meetingResume: vi.fn().mockResolvedValue({ id: 'active-session', paused: false }),
}

Object.assign(window, { api: mockApi })

const setCapturePaused = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  act(() => {
    useAppStore.setState({
      route: 'live',
      activeMeeting: 'active-session',
      liveMeetingId: 'active-session',
      meetingTitle: 'Sprint review',
      micPermission: 'granted',
    })
  })
})

describe('LiveHeader', () => {
  it('renders the meeting title', () => {
    render(<LiveHeader setCapturePaused={setCapturePaused} />)
    expect(screen.getByText('Sprint review')).toBeInTheDocument()
  })

  it('pauses the meeting and toggles to a resume control', async () => {
    const user = userEvent.setup()
    render(<LiveHeader setCapturePaused={setCapturePaused} />)

    await user.click(screen.getByRole('button', { name: /pauzeren/i }))
    expect(mockApi.meetingPause).toHaveBeenCalledWith({ meetingId: 'active-session' })
    expect(setCapturePaused).toHaveBeenCalledWith(true)

    const resumeBtn = await screen.findByRole('button', { name: /hervatten/i })
    await user.click(resumeBtn)
    expect(mockApi.meetingResume).toHaveBeenCalledWith({ meetingId: 'active-session' })
    expect(setCapturePaused).toHaveBeenCalledWith(false)
  })

  it('shows a generating-notes overlay while the final pass runs', async () => {
    let resolveEnd!: (v: { ok: true }) => void
    mockApi.meetingEnd.mockReturnValueOnce(
      new Promise<{ ok: true }>((res) => {
        resolveEnd = res
      }),
    )

    const user = userEvent.setup()
    render(<LiveHeader setCapturePaused={setCapturePaused} />)

    expect(screen.queryByTestId('live-ending-overlay')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('end-meeting-btn'))

    expect(await screen.findByTestId('live-ending-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('end-meeting-btn')).toBeDisabled()

    await act(async () => {
      resolveEnd({ ok: true })
      await Promise.resolve()
    })
  })

  it('clears a stale finalising overlay when a new live session begins', async () => {
    mockApi.meetingEnd.mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<LiveHeader setCapturePaused={setCapturePaused} />)

    await user.click(screen.getByTestId('end-meeting-btn'))
    expect(await screen.findByTestId('live-ending-overlay')).toBeInTheDocument()

    await act(async () => {
      useAppStore.setState({ activeMeeting: 'resumed-session', liveMeetingId: 'resumed-session' })
      await Promise.resolve()
    })

    expect(screen.queryByTestId('live-ending-overlay')).not.toBeInTheDocument()
  })
})
