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

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
  meetingCreate: vi.fn(),
  agendaItemAdd: vi.fn(),
  agendaItemRemove: vi.fn(),
  participantAdd: vi.fn(),
  participantRemove: vi.fn(),
  meetingStart: vi.fn(),
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

const AGENDA_1 = { id: 'agenda-1', title: 'Q3 Review', topic: 'Q3' }
const PARTICIPANT_1 = { id: 'p-1', name: 'Alice' }

const SPAN_1: TranscriptSpan = {
  id: 'span-1',
  text: 'We beslissen de release te plannen voor Q4',
  startMs: 0,
  endMs: 2000,
  isFinal: true,
  confidence: 0.9,
}

const LOW_CONFIDENCE_SPAN: TranscriptSpan = {
  id: 'span-low',
  text: 'Iets onduidelijks',
  startMs: 2000,
  endMs: 4000,
  isFinal: true,
  confidence: 0.45,
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

/** Push items via the onItemsChanged callback (simulates main pushing items). */
function pushItems(payload: Partial<ItemsChangedPayload>) {
  const raw: unknown = mockApi.onItemsChanged.mock.calls[0]?.[0]
  const cb = raw as ((p: ItemsChangedPayload) => void) | undefined
  cb?.({ decisions: [], actions: [], ...payload })
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
    micPermission: 'unknown',
    transcriptSpans: [],
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

describe('LiveScreen — guard: no active meeting', () => {
  it('shows empty state when activeMeeting is null', async () => {
    useAppStore.setState({ activeMeeting: null, route: 'live' })
    render(<LiveScreen />)

    expect(await screen.findByTestId('live-noactive')).toBeInTheDocument()
    expect(screen.queryByTestId('end-meeting-btn')).not.toBeInTheDocument()
  })

  it('does not start audio capture when activeMeeting is null', async () => {
    useAppStore.setState({ activeMeeting: null, route: 'live' })
    render(<LiveScreen />)

    await screen.findByTestId('live-noactive')
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

    // Source span text shown (or a subset of it)
    expect(screen.getByText(/We beslissen de release/i)).toBeInTheDocument()
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

  it('transcript pane is collapsed by default', () => {
    render(<LiveScreen />)

    // The transcript list should not be visible initially
    expect(screen.queryByTestId('transcript-list')).not.toBeInTheDocument()

    // But a toggle button to expand it should be present
    expect(screen.getByTestId('transcript-toggle')).toBeInTheDocument()
  })

  it('clicking transcript toggle expands the pane', async () => {
    const user = userEvent.setup()
    render(<LiveScreen />)

    pushSpan(SPAN_1)

    const toggle = screen.getByTestId('transcript-toggle')
    await user.click(toggle)

    expect(await screen.findByTestId('transcript-list')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Low-confidence span flag
  // -------------------------------------------------------------------------

  it('low-confidence span gets a visual low-confidence flag', async () => {
    const user = userEvent.setup()
    render(<LiveScreen />)

    pushSpan(LOW_CONFIDENCE_SPAN)

    // Expand transcript
    const toggle = screen.getByTestId('transcript-toggle')
    await user.click(toggle)

    const spanEl = await screen.findByTestId(`transcript-span-${LOW_CONFIDENCE_SPAN.id}`)
    expect(spanEl).toHaveAttribute('data-low-confidence', 'true')
  })

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
