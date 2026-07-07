/**
 * Import screen component tests (item 0026).
 *
 * The AudioFileImportService is mocked so the test drives the screen's
 * orchestration without real Web Audio: picking a file + title enables Start,
 * starting calls streamFile with the right request, a successful run loads the
 * meeting and navigates to Review, and an error progress event surfaces an error
 * without navigating.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import type { ImportProgressEvent } from '@shared/ipc'

import { ImportScreen } from '../screens/ImportScreen'
import { useAppStore } from '../store/appStore'

// Mock the import service so no real decode/stream happens.
const mockStreamFile = vi.fn()
vi.mock('../services/AudioFileImportService', () => ({
  AudioFileImportService: vi.fn().mockImplementation(function () {
    return {
      streamFile: mockStreamFile,
    }
  }),
}))

let progressCb: ((evt: ImportProgressEvent) => void) | null = null

const mockApi = {
  onImportProgress: vi.fn((cb: (evt: ImportProgressEvent) => void) => {
    progressCb = cb
    return () => {
      progressCb = null
    }
  }),
  meetingLoad: vi.fn(),
}

Object.assign(window, { api: mockApi })

function pickFile() {
  const input = screen.getByTestId('import-file')
  const file = new File([new Uint8Array([1, 2, 3, 4])], 'meeting.mp3', { type: 'audio/mpeg' })
  return userEvent.upload(input, file)
}

describe('ImportScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    progressCb = null
    mockStreamFile.mockResolvedValue('imp-1')
    mockApi.meetingLoad.mockResolvedValue(null)
    useAppStore.setState({ route: 'import', activeMeeting: null })
    // loadMeeting reads from window.api.meetingLoad; stub it to a minimal payload.
    useAppStore.setState({
      loadMeeting: (id: string) => {
        useAppStore.setState({ activeMeeting: id })
        return Promise.resolve()
      },
    })
  })

  it('renders a file picker, title, language, and an agenda-source toggle', () => {
    render(<ImportScreen />)
    expect(screen.getByTestId('import-file')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /titel/i })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: /agenda/i })).toBeInTheDocument()
  })

  it('disables Start until both a file and a title are present', async () => {
    const user = userEvent.setup()
    render(<ImportScreen />)

    const startBtn = screen.getByRole('button', { name: /importeren/i })
    expect(startBtn).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: /titel/i }), 'Bestuursvergadering')
    expect(startBtn).toBeDisabled()

    await pickFile()
    expect(startBtn).not.toBeDisabled()
  })

  it('starts the import and navigates to Review on success', async () => {
    const user = userEvent.setup()
    render(<ImportScreen />)

    await user.type(screen.getByRole('textbox', { name: /titel/i }), 'Bestuursvergadering')
    await pickFile()
    await user.click(screen.getByRole('button', { name: /importeren/i }))

    await waitFor(() => {
      expect(mockStreamFile).toHaveBeenCalledTimes(1)
    })
    const req = mockStreamFile.mock.calls[0]?.[1] as { title: string; inferContext: boolean }
    expect(req.title).toBe('Bestuursvergadering')

    await waitFor(() => {
      expect(useAppStore.getState().route).toBe('review')
    })
    expect(useAppStore.getState().activeMeeting).toBe('imp-1')
  })

  it('shows an error and does not navigate when an error progress event arrives', async () => {
    const user = userEvent.setup()
    // Hold streamFile open so the error event lands before it resolves.
    let resolveStream: (id: string) => void = () => undefined
    mockStreamFile.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveStream = resolve
      }),
    )

    render(<ImportScreen />)
    await user.type(screen.getByRole('textbox', { name: /titel/i }), 'Bestuursvergadering')
    await pickFile()
    await user.click(screen.getByRole('button', { name: /importeren/i }))

    await waitFor(() => {
      expect(progressCb).not.toBeNull()
    })
    progressCb?.({ stage: 'error', error: 'no asr key' })
    resolveStream('imp-1')

    await screen.findByTestId('import-error')
    expect(useAppStore.getState().route).toBe('import')
  })
})
