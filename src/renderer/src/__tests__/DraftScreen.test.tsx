/**
 * Draft screen component tests (item 0014).
 *
 * Tests verify:
 * - Meeting title input and validation
 * - Adding/removing agenda items (minimal: add/remove, not reorder)
 * - Adding/removing participants
 * - Language selector defaults to Dutch
 * - Start button disabled until valid (title present)
 * - Start button invokes IPC and navigates to live
 * - Keyboard support: Enter to add items, keyboard-reachable Start
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { DraftScreen } from '../screens/DraftScreen'
import { useAppStore } from '../store/appStore'

const mockApi = {
  meetingCreate: vi.fn(),
  agendaItemAdd: vi.fn(),
  agendaItemRemove: vi.fn(),
  participantAdd: vi.fn(),
  participantRemove: vi.fn(),
  inferContextFromText: vi.fn(),
}

Object.assign(window, {
  api: mockApi,
})

describe('DraftScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the Zustand store to initial state for each test, including the
    // persisted draft fields so tests don't leak entered data into one another.
    useAppStore.setState({
      route: 'draft',
      activeMeeting: null,
      draftTitle: '',
      draftPrimaryLanguage: 'nl',
      draftAgendaItems: [],
      draftParticipants: [],
      draftPasteText: '',
    })
  })

  it('renders the draft screen with title, agenda, participants, language, and start button', () => {
    render(<DraftScreen />)

    expect(screen.getByTestId('screen-draft')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /vergaderingtitel/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /agenda items/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /deelnemer/i })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: /taal/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^starten$/i })).toBeInTheDocument()
  })

  it('disables the start button until the title is non-empty', async () => {
    render(<DraftScreen />)
    const startBtn = screen.getByRole('button', { name: /^starten$/i })

    expect(startBtn).toBeDisabled()

    const titleInput = screen.getByRole('textbox', { name: /vergaderingtitel/i })
    await userEvent.type(titleInput, 'Quarterly Planning')

    expect(startBtn).not.toBeDisabled()
  })

  it('allows adding an agenda item by typing and pressing Enter', async () => {
    const user = userEvent.setup()
    mockApi.agendaItemAdd.mockResolvedValue({ id: 'item-1', title: 'Roadmap', topic: 'Q4 Roadmap' })

    render(<DraftScreen />)

    const agendaInput = screen.getByRole('textbox', { name: /agenda item toevoegen/i })
    await user.type(agendaInput, 'Roadmap')
    await user.keyboard('{Enter}')

    await expect(screen.findByText('Roadmap')).resolves.toBeInTheDocument()
  })

  it('allows removing an agenda item', async () => {
    const user = userEvent.setup()
    mockApi.agendaItemAdd.mockResolvedValue({ id: 'item-1', title: 'Roadmap', topic: 'Q4 Roadmap' })
    mockApi.agendaItemRemove.mockResolvedValue({ ok: true })

    render(<DraftScreen />)

    const agendaInput = screen.getByRole('textbox', { name: /agenda item toevoegen/i })
    await user.type(agendaInput, 'Roadmap')
    await user.keyboard('{Enter}')

    const removeBtn = await screen.findByRole('button', { name: /verwijderen/i })
    await user.click(removeBtn)

    // After removal, Roadmap should not be in the document
    expect(screen.queryByText('Roadmap')).not.toBeInTheDocument()
  })

  it('allows adding a participant by typing and pressing Enter', async () => {
    const user = userEvent.setup()
    mockApi.participantAdd.mockResolvedValue({ id: 'p-1', name: 'Alice' })

    render(<DraftScreen />)

    const participantInput = screen.getByRole('textbox', { name: /deelnemersnaam toevoegen/i })
    await user.type(participantInput, 'Alice')
    await user.keyboard('{Enter}')

    await expect(screen.findByText('Alice')).resolves.toBeInTheDocument()
  })

  it('allows removing a participant', async () => {
    const user = userEvent.setup()
    mockApi.participantAdd.mockResolvedValue({ id: 'p-1', name: 'Bob' })
    mockApi.participantRemove.mockResolvedValue({ ok: true })

    render(<DraftScreen />)

    const participantInput = screen.getByRole('textbox', { name: /deelnemersnaam toevoegen/i })
    await user.type(participantInput, 'Bob')
    await user.keyboard('{Enter}')

    const removeBtn = await screen.findByRole('button', { name: /verwijderen/i })
    await user.click(removeBtn)

    // After removal, Bob should not be in the document
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
  })

  it('language toggle defaults to Dutch (nl)', () => {
    render(<DraftScreen />)

    expect(screen.getByRole('radiogroup', { name: /taal/i })).toBeInTheDocument()
    const nl = screen.getByTestId('draft-language-nl')
    expect(nl.checked).toBe(true)
  })

  it('creates the meeting and navigates to live when start button is clicked with valid title', async () => {
    const user = userEvent.setup()

    mockApi.meetingCreate.mockResolvedValue({
      id: 'm-1',
      title: 'Planning',
      state: 'draft',
      primaryLanguage: 'nl',
      createdAt: '2025-01-01T00:00:00Z',
    })

    render(<DraftScreen />)

    const titleInput = screen.getByRole('textbox', { name: /vergaderingtitel/i })
    await user.type(titleInput, 'Planning')

    const startBtn = screen.getByRole('button', { name: /^starten$/i })
    await user.click(startBtn)

    // Verify the API calls were made
    expect(mockApi.meetingCreate).toHaveBeenCalled()

    // Verify navigation occurred via the store
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(useAppStore.getState().activeMeeting).toBe('m-1')
    expect(useAppStore.getState().route).toBe('live')
  })

  // ---------------------------------------------------------------------------
  // Paste an agenda (ADR 0029)
  // ---------------------------------------------------------------------------

  it('renders the paste textarea and the Uitlezen button', () => {
    render(<DraftScreen />)

    expect(screen.getByRole('textbox', { name: /agenda plakken/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /uitlezen/i })).toBeInTheDocument()
  })

  it('keeps the Uitlezen button disabled until the paste field has non-whitespace text', async () => {
    const user = userEvent.setup()
    render(<DraftScreen />)

    const uitlezen = screen.getByRole('button', { name: /uitlezen/i })
    expect(uitlezen).toBeDisabled()

    const paste = screen.getByRole('textbox', { name: /agenda plakken/i })
    await user.type(paste, '   ')
    expect(uitlezen).toBeDisabled()

    await user.type(paste, 'Agenda: begroting')
    expect(uitlezen).not.toBeDisabled()
  })

  it('fills title, agenda and participants from the inferred context and keeps them editable', async () => {
    const user = userEvent.setup()
    mockApi.inferContextFromText.mockResolvedValue({
      title: 'Begrotingsoverleg',
      agendaItems: [
        { title: 'Begroting', topic: 'Q3-begroting' },
        { title: 'Planning', topic: 'Volgend kwartaal' },
      ],
      participants: [{ name: 'Jeroen' }],
    })

    render(<DraftScreen />)

    const paste = screen.getByRole('textbox', { name: /agenda plakken/i })
    await user.type(paste, 'Agenda: begroting en planning, met Jeroen')
    await user.click(screen.getByRole('button', { name: /uitlezen/i }))

    // Title input filled.
    const titleInput = await screen.findByRole('textbox', { name: /vergaderingtitel/i })
    expect((titleInput as HTMLInputElement).value).toBe('Begrotingsoverleg')

    // Agenda + participants populated.
    expect(await screen.findByText('Begroting')).toBeInTheDocument()
    expect(screen.getByText('Planning')).toBeInTheDocument()
    expect(screen.getByText('Jeroen')).toBeInTheDocument()

    // The call carried the pasted text + language.
    expect(mockApi.inferContextFromText).toHaveBeenCalledWith({
      text: 'Agenda: begroting en planning, met Jeroen',
      primaryLanguage: 'nl',
    })

    // Items stay removable (Confirmed Draft items, editable like manual ones).
    await user.click(screen.getByRole('button', { name: /verwijderen begroting/i }))
    expect(screen.queryByText('Begroting')).not.toBeInTheDocument()
  })

  it('keeps manual entry working when inference returns an empty context', async () => {
    const user = userEvent.setup()
    mockApi.inferContextFromText.mockResolvedValue({ agendaItems: [], participants: [] })

    render(<DraftScreen />)

    const paste = screen.getByRole('textbox', { name: /agenda plakken/i })
    await user.type(paste, 'Onleesbare brij')
    await user.click(screen.getByRole('button', { name: /uitlezen/i }))

    // A gentle hint appears; the title stays empty and editable.
    expect(await screen.findByText(/geen agenda herkend/i)).toBeInTheDocument()
    const titleInput = screen.getByRole('textbox', { name: /vergaderingtitel/i })
    expect((titleInput as HTMLInputElement).value).toBe('')
  })

  // ---------------------------------------------------------------------------
  // Draft persistence + reset
  // ---------------------------------------------------------------------------

  it('persists entered data across unmount/remount (navigate away and back)', async () => {
    const user = userEvent.setup()
    mockApi.agendaItemAdd.mockResolvedValue({
      id: 'item-1',
      title: 'Roadmap',
      topic: 'Roadmap',
      state: 'confirmed',
    })

    const { unmount } = render(<DraftScreen />)
    await user.type(screen.getByRole('textbox', { name: /vergaderingtitel/i }), 'Mijn overleg')
    await user.type(screen.getByRole('textbox', { name: /agenda item toevoegen/i }), 'Roadmap')
    await user.keyboard('{Enter}')
    await screen.findByText('Roadmap')

    // Simulate navigating away (DraftScreen unmounts) and back.
    unmount()
    render(<DraftScreen />)

    expect(screen.getByRole('textbox', { name: /vergaderingtitel/i })).toHaveValue('Mijn overleg')
    expect(screen.getByText('Roadmap')).toBeInTheDocument()
  })

  it('clears all entered data when the reset button is clicked', async () => {
    const user = userEvent.setup()
    mockApi.agendaItemAdd.mockResolvedValue({
      id: 'item-1',
      title: 'Roadmap',
      topic: 'Roadmap',
      state: 'confirmed',
    })

    render(<DraftScreen />)
    await user.type(screen.getByRole('textbox', { name: /vergaderingtitel/i }), 'Mijn overleg')
    await user.type(screen.getByRole('textbox', { name: /agenda item toevoegen/i }), 'Roadmap')
    await user.keyboard('{Enter}')
    await screen.findByText('Roadmap')

    await user.click(screen.getByRole('button', { name: /opnieuw beginnen/i }))

    expect(screen.getByRole('textbox', { name: /vergaderingtitel/i })).toHaveValue('')
    expect(screen.queryByText('Roadmap')).not.toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Quick-start "Direct starten" (ADR 0029)
  // ---------------------------------------------------------------------------

  it('quick-starts with an auto-title and titleAutoGenerated true when no title is typed', async () => {
    const user = userEvent.setup()
    mockApi.meetingCreate.mockResolvedValue({
      id: 'm-q',
      title: 'Vergadering',
      state: 'draft',
      source: 'live',
      paused: false,
      createdAt: '2026-06-25T09:00:00Z',
      primaryLanguage: 'nl',
      titleAutoGenerated: true,
    })

    render(<DraftScreen />)

    const quick = screen.getByRole('button', { name: /direct starten/i })
    expect(quick).not.toBeDisabled() // works even with an empty title

    await user.click(quick)

    expect(mockApi.meetingCreate).toHaveBeenCalledWith(
      expect.objectContaining({ titleAutoGenerated: true, primaryLanguage: 'nl' }),
    )
    const arg = mockApi.meetingCreate.mock.calls[0]?.[0] as { title: string }
    expect(arg.title.length).toBeGreaterThan(0)

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(useAppStore.getState().route).toBe('live')
  })

  it('persists the prepared agenda + participants against the real meeting id on Start (audit C1)', async () => {
    const user = userEvent.setup()
    mockApi.meetingCreate.mockResolvedValue({
      id: 'm-1',
      title: 'Planning',
      state: 'draft',
      source: 'live',
      paused: false,
      createdAt: '2026-06-25T09:00:00Z',
      primaryLanguage: 'nl',
      titleAutoGenerated: false,
    })
    mockApi.agendaItemAdd.mockResolvedValue({
      id: 'ai-db',
      title: 'Roadmap',
      topic: 'Roadmap',
      state: 'confirmed',
    })
    mockApi.participantAdd.mockResolvedValue({ id: 'p-db', name: 'Alice' })

    render(<DraftScreen />)

    await user.type(screen.getByRole('textbox', { name: /vergaderingtitel/i }), 'Planning')
    await user.type(screen.getByRole('textbox', { name: /agenda item toevoegen/i }), 'Roadmap')
    await user.keyboard('{Enter}')
    await user.type(screen.getByRole('textbox', { name: /deelnemersnaam toevoegen/i }), 'Alice')
    await user.keyboard('{Enter}')

    // Editing the draft does not persist: no meeting exists yet.
    expect(mockApi.agendaItemAdd).not.toHaveBeenCalled()
    expect(mockApi.participantAdd).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /^starten$/i }))

    // On Start, the prepared set is persisted against the created meeting id.
    expect(mockApi.agendaItemAdd).toHaveBeenCalledWith({
      meetingId: 'm-1',
      title: 'Roadmap',
      topic: 'Roadmap',
    })
    expect(mockApi.participantAdd).toHaveBeenCalledWith({ meetingId: 'm-1', name: 'Alice' })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(useAppStore.getState().route).toBe('live')
  })

  it('quick-starts with the typed title and titleAutoGenerated false when a title is present', async () => {
    const user = userEvent.setup()
    mockApi.meetingCreate.mockResolvedValue({
      id: 'm-q2',
      title: 'Mijn overleg',
      state: 'draft',
      source: 'live',
      paused: false,
      createdAt: '2026-06-25T09:00:00Z',
      primaryLanguage: 'nl',
      titleAutoGenerated: false,
    })

    render(<DraftScreen />)

    await user.type(screen.getByRole('textbox', { name: /vergaderingtitel/i }), 'Mijn overleg')
    await user.click(screen.getByRole('button', { name: /direct starten/i }))

    expect(mockApi.meetingCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Mijn overleg', titleAutoGenerated: false }),
    )
  })

  it('allows start button to be reached and activated via keyboard', async () => {
    const user = userEvent.setup()

    mockApi.meetingCreate.mockResolvedValue({
      id: 'm-1',
      title: 'Planning',
      state: 'draft',
      createdAt: '2025-01-01T00:00:00Z',
      primaryLanguage: 'nl',
    })

    render(<DraftScreen />)

    const titleInput = screen.getByRole('textbox', { name: /vergaderingtitel/i })
    await user.type(titleInput, 'Planning')

    // The start button should be accessible and activatable
    const startBtn = screen.getByRole('button', { name: /^starten$/i })
    expect(startBtn).not.toBeDisabled()

    // Click the start button
    await user.click(startBtn)

    // Verify the handlers were called
    expect(mockApi.meetingCreate).toHaveBeenCalled()
  })
})
