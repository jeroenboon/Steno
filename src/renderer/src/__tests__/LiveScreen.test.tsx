/**
 * Live screen component tests (item 0018).
 *
 * Tests verify:
 * - Proposed items rendered under their agenda groups with source span text
 * - Proposed vs Confirmed styling distinct
 * - confirm / dismiss / edit dispatch correct IPC calls
 * - Retracted/removed item disappears from the list
 * - Manual add dispatches item:createConfirmed
 * - Keyboard shortcut: Enter confirms, Delete/Backspace dismisses focused item
 * - Transcript pane is collapsed by default
 * - Low-confidence span receives a visual flag
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import type { TranscriptSpan } from '@shared/domain/types'
import type { ItemsChangedPayload } from '@shared/ipc'

import { LiveScreen } from '../screens/LiveScreen'
import { useAppStore } from '../store/appStore'

// ---------------------------------------------------------------------------
// Mock window.api
// ---------------------------------------------------------------------------

const mockUnsub = vi.fn()

const mockApi = {
  audioStart: vi.fn().mockResolvedValue({ ok: true }),
  audioStop: vi.fn().mockResolvedValue({ ok: true }),
  audioSendFrame: vi.fn(),
  onTranscriptSpan: vi.fn().mockReturnValue(mockUnsub),
  onItemsChanged: vi.fn().mockReturnValue(mockUnsub),
  onItemsSummaries: vi.fn().mockReturnValue(mockUnsub),
  onNudgesChanged: vi.fn().mockReturnValue(mockUnsub),
  onSummaryChanged: vi.fn().mockReturnValue(mockUnsub),
  summaryQuery: vi.fn().mockResolvedValue({ answer: '' }),
  itemConfirm: vi.fn().mockResolvedValue({ state: 'confirmed' }),
  itemEditAndConfirm: vi.fn().mockResolvedValue({ state: 'confirmed' }),
  itemDismiss: vi.fn().mockResolvedValue({ ok: true }),
  itemCreateConfirmed: vi.fn().mockResolvedValue({ state: 'confirmed' }),
  onAgendaChanged: vi.fn().mockReturnValue(mockUnsub),
  agendaItemConfirm: vi.fn(),
  agendaItemEditAndConfirm: vi.fn(),
  meetingEnd: vi.fn().mockResolvedValue({ ok: true }),
  meetingPause: vi.fn().mockResolvedValue({ id: 'active-session', paused: true }),
  meetingResume: vi.fn().mockResolvedValue({ id: 'active-session', paused: false }),
  meetingCreate: vi.fn(),
  agendaItemAdd: vi.fn(),
  agendaItemRemove: vi.fn().mockResolvedValue({ ok: true }),
  participantAdd: vi.fn(),
  participantRemove: vi.fn(),
  ping: vi.fn(),
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  egressState: vi.fn(),
  secretSet: vi.fn(),
  secretHas: vi.fn(),
}

Object.assign(window, { api: mockApi })

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const AGENDA_1 = { id: 'agenda-1', title: 'Q3 Review', topic: 'Q3', state: 'confirmed' as const }
const PROPOSED_AGENDA = {
  id: 'agenda-prop',
  title: 'Begroting',
  topic: 'Q3-begroting',
  state: 'proposed' as const,
}
const PARTICIPANT_1 = { id: 'p-1', name: 'Alice' }

const SPAN_1: TranscriptSpan = {
  id: 'span-1',
  text: 'We beslissen de release te plannen voor Q4',
  startMs: 0,
  endMs: 2000,
  isFinal: true,
  confidence: 0.9,
}

const PROPOSED_DECISION: ItemsChangedPayload['decisions'][number] = {
  id: 'd-1',
  rationale: 'Release in Q4',
  agendaItemId: 'agenda-1',
  sourceSpanId: 'span-1',
  state: 'proposed',
}

// PROPOSED_ACTION available for future tests (actions panel)
const _PROPOSED_ACTION: ItemsChangedPayload['actions'][number] = {
  id: 'a-1',
  agendaItemId: 'agenda-1',
  sourceSpanId: 'span-1',
  status: 'open',
  state: 'proposed',
}
void _PROPOSED_ACTION

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simulate main pushing the authoritative item set for the focused meeting
 * (ADR 0033): reconcile straight into the store, the way App's onItemsChanged
 * subscription does. The meetingId matches activeMeeting so the guard passes.
 */
function pushItems(payload: Partial<Omit<ItemsChangedPayload, 'meetingId'>>) {
  act(() => {
    useAppStore.getState().reconcileItems({
      meetingId: useAppStore.getState().activeMeeting ?? '',
      decisions: [],
      actions: [],
      ...payload,
    })
  })
}

/** Push a transcript span via the onTranscriptSpan callback. */
function pushSpan(span: TranscriptSpan) {
  const raw: unknown = mockApi.onTranscriptSpan.mock.calls[0]?.[0]
  const cb = raw as ((s: TranscriptSpan) => void) | undefined
  cb?.(span)
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.onTranscriptSpan.mockReturnValue(mockUnsub)
  mockApi.onItemsChanged.mockReturnValue(mockUnsub)
  mockApi.onItemsSummaries.mockReturnValue(mockUnsub)
  mockApi.itemConfirm.mockResolvedValue({
    id: 'd-1',
    rationale: 'Release in Q4',
    agendaItemId: 'agenda-1',
    sourceSpanId: 'span-1',
    state: 'confirmed',
  })
  mockApi.itemDismiss.mockResolvedValue({ ok: true })
  mockApi.itemEditAndConfirm.mockResolvedValue({
    id: 'd-1',
    rationale: 'Updated',
    agendaItemId: 'agenda-1',
    sourceSpanId: 'span-1',
    state: 'confirmed',
  })
  mockApi.itemCreateConfirmed.mockResolvedValue({
    id: 'd-new',
    rationale: 'Nieuw besluit',
    agendaItemId: '__off-agenda__',
    sourceSpanId: 'span-manual',
    state: 'confirmed',
  })

  useAppStore.setState({
    route: 'live',
    activeMeeting: 'active-session',
    liveMeetingId: 'active-session',
    micPermission: 'unknown',
    transcriptSpans: [],
    transcriptOpen: true,
    captureMode: 'remote',
    loopbackState: null,
    proposedDecisions: [],
    proposedActions: [],
    confirmedDecisions: [],
    confirmedActions: [],
    agendaItems: [AGENDA_1],
    participants: [PARTICIPANT_1],
  })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LiveScreen — finalising the meeting', () => {
  it('shows a generating-notes overlay while the final pass runs', async () => {
    // meetingEnd resolves only after the whole final pass; hold it open so the
    // overlay is observable (in production it clears when we navigate to Review).
    let resolveEnd!: (v: { ok: true }) => void
    mockApi.meetingEnd.mockReturnValueOnce(
      new Promise<{ ok: true }>((res) => {
        resolveEnd = res
      }),
    )

    const user = userEvent.setup()
    render(<LiveScreen />)

    expect(screen.queryByTestId('live-ending-overlay')).not.toBeInTheDocument()
    await user.click(await screen.findByTestId('end-meeting-btn'))

    expect(await screen.findByTestId('live-ending-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('end-meeting-btn')).toBeDisabled()

    // Let the pass finish so the promise settles cleanly.
    await act(async () => {
      resolveEnd({ ok: true })
      await Promise.resolve()
    })
  })

  it('clears a stale finalising overlay when a new live session begins', async () => {
    // LiveScreen is mounted permanently, so the endingMeeting flag from a
    // finished meeting must not leak into the next one. End a meeting (overlay
    // shows), then resume/start another (liveMeetingId changes): the overlay
    // must clear so the new session is not blocked.
    mockApi.meetingEnd.mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<LiveScreen />)

    await user.click(await screen.findByTestId('end-meeting-btn'))
    expect(await screen.findByTestId('live-ending-overlay')).toBeInTheDocument()

    await act(async () => {
      useAppStore.setState({ activeMeeting: 'resumed-session', liveMeetingId: 'resumed-session' })
      await Promise.resolve()
    })

    expect(screen.queryByTestId('live-ending-overlay')).not.toBeInTheDocument()
  })
})

describe('LiveScreen — guard: no active meeting', () => {
  it('shows empty state when activeMeeting is null', async () => {
    useAppStore.setState({ activeMeeting: null, route: 'live' })
    render(<LiveScreen />)

    expect(await screen.findByTestId('live-noactive')).toBeInTheDocument()
    expect(screen.queryByTestId('end-meeting-btn')).not.toBeInTheDocument()
  })

  it('does not start audio capture when no live meeting is in progress', async () => {
    useAppStore.setState({ activeMeeting: null, liveMeetingId: null, route: 'live' })
    render(<LiveScreen />)

    await screen.findByTestId('live-noactive')
    expect(mockApi.audioStart).not.toHaveBeenCalled()
  })

  // Regression (item 0024): App mounts LiveScreen permanently — its audio-start
  // effect first runs at startup with no live meeting and bails. When a meeting
  // later goes live the effect MUST re-fire and call start(). It only does so if
  // the live-meeting id is in the effect's dependency array.
  it('starts audio capture when a meeting goes live after mount', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error('no media device in jsdom'))
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    })

    // Mount with no live meeting, exactly as App does at startup.
    useAppStore.setState({ activeMeeting: null, liveMeetingId: null, route: 'live' })
    render(<LiveScreen />)
    await screen.findByTestId('live-noactive')
    expect(getUserMedia).not.toHaveBeenCalled()

    // Meeting goes live (Draft → "Start vergadering" sets both ids).
    act(() => {
      useAppStore.setState({ activeMeeting: 'active-session', liveMeetingId: 'active-session' })
    })

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalled()
    })
  })

  // Regression (import / reopen bug): loading a meeting for Review sets
  // activeMeeting but NOT liveMeetingId. Capture must stay off — otherwise an
  // import (or reopening a past meeting) silently starts a live mic session.
  it('does not start audio capture when a meeting is only loaded for review', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error('no media device in jsdom'))
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    })

    useAppStore.setState({
      activeMeeting: 'imported-meeting',
      liveMeetingId: null,
      route: 'review',
    })
    render(<LiveScreen />)

    // Give any (incorrect) start effect a chance to fire.
    await Promise.resolve()
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(mockApi.audioStart).not.toHaveBeenCalled()
  })
})

describe('LiveScreen — item 0018 items UI', () => {
  it('renders the live screen', () => {
    render(<LiveScreen />)
    expect(screen.getByTestId('screen-live')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Proposed item rendering under agenda group
  // -------------------------------------------------------------------------

  it('renders a proposed decision under its agenda group with source span text', async () => {
    render(<LiveScreen />)

    pushSpan(SPAN_1)
    pushItems({ decisions: [PROPOSED_DECISION] })

    // Agenda group heading
    expect(await screen.findByText(/Q3 Review/i)).toBeInTheDocument()

    // The item text
    expect(await screen.findByText(/Release in Q4/i)).toBeInTheDocument()

    // Source span text shown (or a subset of it). The transcript is open by
    // default, so this text legitimately appears both there and in the item's
    // source quote — assert at least one occurrence.
    expect(screen.getAllByText(/We beslissen de release/i).length).toBeGreaterThan(0)
  })

  it('proposed items are visually distinct from confirmed items', async () => {
    render(<LiveScreen />)

    pushSpan(SPAN_1)
    pushItems({ decisions: [PROPOSED_DECISION] })

    const itemEl = await screen.findByTestId('item-d-1')
    expect(itemEl).toHaveAttribute('data-state', 'proposed')
  })

  // -------------------------------------------------------------------------
  // Confirm via IPC
  // -------------------------------------------------------------------------

  it('clicking confirm button dispatches item:confirm with the correct id', async () => {
    const user = userEvent.setup()
    render(<LiveScreen />)

    pushSpan(SPAN_1)
    pushItems({ decisions: [PROPOSED_DECISION] })

    const confirmBtn = await screen.findByTestId('confirm-d-1')
    await user.click(confirmBtn)

    expect(mockApi.itemConfirm).toHaveBeenCalledWith({ kind: 'decision', id: 'd-1' })
  })

  // -------------------------------------------------------------------------
  // Dismiss via IPC
  // -------------------------------------------------------------------------

  it('clicking dismiss button dispatches item:dismiss with the correct id', async () => {
    const user = userEvent.setup()
    render(<LiveScreen />)

    pushSpan(SPAN_1)
    pushItems({ decisions: [PROPOSED_DECISION] })

    const dismissBtn = await screen.findByTestId('dismiss-d-1')
    await user.click(dismissBtn)

    expect(mockApi.itemDismiss).toHaveBeenCalledWith({ kind: 'decision', id: 'd-1' })
  })

  // -------------------------------------------------------------------------
  // Retract — item disappears
  // -------------------------------------------------------------------------

  it('retracted item is removed from the list', async () => {
    render(<LiveScreen />)

    pushSpan(SPAN_1)
    pushItems({ decisions: [PROPOSED_DECISION] })

    expect(await screen.findByTestId('item-d-1')).toBeInTheDocument()

    // Push update with no decisions (agent retracted it)
    pushItems({ decisions: [] })

    await waitFor(() => {
      expect(screen.queryByTestId('item-d-1')).not.toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Inline edit + confirm
  // -------------------------------------------------------------------------

  it('edit button reveals inline edit form; saving dispatches item:editAndConfirm', async () => {
    const user = userEvent.setup()
    render(<LiveScreen />)

    pushSpan(SPAN_1)
    pushItems({ decisions: [PROPOSED_DECISION] })

    const editBtn = await screen.findByTestId('edit-d-1')
    await user.click(editBtn)

    // Edit form appears
    const textarea = await screen.findByTestId('edit-textarea-d-1')
    await user.clear(textarea)
    await user.type(textarea, 'Updated rationale')

    const saveBtn = screen.getByTestId('save-d-1')
    await user.click(saveBtn)

    expect(mockApi.itemEditAndConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'decision',
        id: 'd-1',
        updates: expect.objectContaining({ rationale: 'Updated rationale' }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      }),
    )
  })

  // -------------------------------------------------------------------------
  // Manual add dispatches createConfirmed
  // -------------------------------------------------------------------------

  it('manual add button opens form; submitting dispatches item:createConfirmed', async () => {
    const user = userEvent.setup()
    render(<LiveScreen />)

    const addBtn = await screen.findByTestId('add-decision-btn')
    await user.click(addBtn)

    const input = await screen.findByTestId('new-decision-input')
    await user.type(input, 'Nieuw besluit')

    const submitBtn = screen.getByTestId('submit-new-decision')
    await user.click(submitBtn)

    expect(mockApi.itemCreateConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'decision',
        meetingId: 'active-session',
        item: expect.objectContaining({ rationale: 'Nieuw besluit' }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      }),
    )
  })

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------

  it('pressing Enter on a focused proposed item confirms it', async () => {
    render(<LiveScreen />)

    pushSpan(SPAN_1)
    pushItems({ decisions: [PROPOSED_DECISION] })

    const itemEl = await screen.findByTestId('item-d-1')
    itemEl.focus()
    fireEvent.keyDown(itemEl, { key: 'Enter' })

    await waitFor(() => {
      expect(mockApi.itemConfirm).toHaveBeenCalledWith({ kind: 'decision', id: 'd-1' })
    })
  })

  it('pressing Delete on a focused proposed item dismisses it', async () => {
    render(<LiveScreen />)

    pushSpan(SPAN_1)
    pushItems({ decisions: [PROPOSED_DECISION] })

    const itemEl = await screen.findByTestId('item-d-1')
    itemEl.focus()
    fireEvent.keyDown(itemEl, { key: 'Delete' })

    await waitFor(() => {
      expect(mockApi.itemDismiss).toHaveBeenCalledWith({ kind: 'decision', id: 'd-1' })
    })
  })

  // -------------------------------------------------------------------------
  // Transcript pane collapsed by default
  // -------------------------------------------------------------------------

  // Transcript-pane behaviour (open-by-default, collapse, interim/low-confidence
  // flags) is covered in TranscriptPane.test.tsx now that the pane is its own
  // store-connected component (A1).

  // -------------------------------------------------------------------------
  // Recording-gated bleed class (D4)
  // -------------------------------------------------------------------------

  it('does NOT have screen--live--recording when micPermission is unknown', () => {
    useAppStore.setState({ micPermission: 'unknown' })
    render(<LiveScreen />)
    const el = screen.getByTestId('screen-live')
    expect(el).not.toHaveClass('screen--live--recording')
  })

  it('does NOT have screen--live--recording when micPermission is denied', () => {
    useAppStore.setState({ micPermission: 'denied' })
    render(<LiveScreen />)
    const el = screen.getByTestId('screen-live')
    expect(el).not.toHaveClass('screen--live--recording')
  })

  it('adds screen--live--recording when micPermission is granted', async () => {
    render(<LiveScreen />)
    // Simulate audio capture grant arriving after mount
    useAppStore.setState({ micPermission: 'granted' })
    // findBy* re-evaluates after re-render
    await waitFor(() => {
      expect(screen.getByTestId('screen-live')).toHaveClass('screen--live--recording')
    })
  })
})

// ---------------------------------------------------------------------------
// Pause / resume
// ---------------------------------------------------------------------------

describe('LiveScreen — pause/resume', () => {
  it('pauses the meeting and toggles to a resume control', async () => {
    const user = userEvent.setup()
    render(<LiveScreen />)

    await user.click(screen.getByRole('button', { name: /pauzeren/i }))
    expect(mockApi.meetingPause).toHaveBeenCalledWith({ meetingId: 'active-session' })

    // The control flips to resume.
    const resumeBtn = await screen.findByRole('button', { name: /hervatten/i })
    await user.click(resumeBtn)
    expect(mockApi.meetingResume).toHaveBeenCalledWith({ meetingId: 'active-session' })
  })
})

// ---------------------------------------------------------------------------
// Live agenda grooming (ADR 0029)
// ---------------------------------------------------------------------------

describe('LiveScreen — live agenda grooming (ADR 0029)', () => {
  beforeEach(() => {
    mockApi.agendaItemConfirm.mockResolvedValue({ ...PROPOSED_AGENDA, state: 'confirmed' })
    mockApi.agendaItemEditAndConfirm.mockResolvedValue({
      ...PROPOSED_AGENDA,
      title: 'Bijgewerkt',
      state: 'confirmed',
    })
    useAppStore.setState({ agendaItems: [AGENDA_1, PROPOSED_AGENDA] })
  })

  it('renders a Proposed agenda item distinctly with confirm, edit and dismiss controls', () => {
    render(<LiveScreen />)

    const group = screen.getByTestId('proposed-agenda-agenda-prop')
    expect(group).toBeInTheDocument()
    expect(group).toHaveTextContent('Begroting')
    // All three controls are present and keyboard-reachable (real buttons).
    expect(screen.getByRole('button', { name: /agendapunt bevestigen/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /agendapunt bewerken/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /agendapunt verwijderen/i })).toBeInTheDocument()
  })

  it('confirms a Proposed agenda item via the agenda-confirm IPC', async () => {
    const user = userEvent.setup()
    render(<LiveScreen />)

    await user.click(screen.getByRole('button', { name: /agendapunt bevestigen/i }))

    expect(mockApi.agendaItemConfirm).toHaveBeenCalledWith({ agendaItemId: 'agenda-prop' })
  })

  it('dismisses a Proposed agenda item, removing it from the list', async () => {
    const user = userEvent.setup()
    render(<LiveScreen />)

    await user.click(screen.getByRole('button', { name: /agendapunt verwijderen/i }))

    expect(mockApi.agendaItemRemove).toHaveBeenCalledWith({ agendaItemId: 'agenda-prop' })
    await waitFor(() => {
      expect(screen.queryByTestId('proposed-agenda-agenda-prop')).not.toBeInTheDocument()
    })
  })
})
