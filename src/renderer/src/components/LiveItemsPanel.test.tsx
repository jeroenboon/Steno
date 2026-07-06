/**
 * LiveItemsPanel tests (A1 — re-homed from LiveScreen.test.tsx).
 *
 * The panel is store-connected: items arrive via reconcileItems (the way App's
 * onItemsChanged subscription pushes the authoritative set, ADR 0033) and
 * mutations round-trip through window.api. Agenda grooming updates the store
 * optimistically.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import type { TranscriptSpan } from '@shared/domain/types'
import type { ItemsChangedPayload } from '@shared/ipc'

import { useAppStore } from '../store/appStore'

import { LiveItemsPanel } from './LiveItemsPanel'

const mockApi = {
  itemConfirm: vi.fn().mockResolvedValue({ state: 'confirmed' }),
  itemEditAndConfirm: vi.fn().mockResolvedValue({ state: 'confirmed' }),
  itemDismiss: vi.fn().mockResolvedValue({ ok: true }),
  itemCreateConfirmed: vi.fn().mockResolvedValue({ state: 'confirmed' }),
  agendaItemConfirm: vi.fn(),
  agendaItemEditAndConfirm: vi.fn(),
  agendaItemRemove: vi.fn().mockResolvedValue({ ok: true }),
}

Object.assign(window, { api: mockApi })

// ---------------------------------------------------------------------------
// Fixtures
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

function setItems(payload: Partial<Omit<ItemsChangedPayload, 'meetingId'>>) {
  act(() => {
    useAppStore.getState().reconcileItems({
      meetingId: useAppStore.getState().activeMeeting ?? '',
      decisions: [],
      actions: [],
      ...payload,
    })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
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

  act(() => {
    useAppStore.setState({
      activeMeeting: 'active-session',
      transcriptSpans: [SPAN_1],
      proposedDecisions: [],
      proposedActions: [],
      confirmedDecisions: [],
      confirmedActions: [],
      agendaItems: [AGENDA_1],
      participants: [PARTICIPANT_1],
    })
  })
})

// ---------------------------------------------------------------------------
// Item rendering + mutations
// ---------------------------------------------------------------------------

describe('LiveItemsPanel — items', () => {
  it('renders a proposed decision under its agenda group with source span text', async () => {
    render(<LiveItemsPanel />)
    setItems({ decisions: [PROPOSED_DECISION] })

    expect(await screen.findByText(/Q3 Review/i)).toBeInTheDocument()
    expect(await screen.findByText(/Release in Q4/i)).toBeInTheDocument()
    expect(screen.getByText(/We beslissen de release/i)).toBeInTheDocument()
  })

  it('marks proposed items as proposed', async () => {
    render(<LiveItemsPanel />)
    setItems({ decisions: [PROPOSED_DECISION] })

    const itemEl = await screen.findByTestId('item-d-1')
    expect(itemEl).toHaveAttribute('data-state', 'proposed')
  })

  it('clicking confirm dispatches item:confirm with the correct id', async () => {
    const user = userEvent.setup()
    render(<LiveItemsPanel />)
    setItems({ decisions: [PROPOSED_DECISION] })

    await user.click(await screen.findByTestId('confirm-d-1'))
    expect(mockApi.itemConfirm).toHaveBeenCalledWith({ kind: 'decision', id: 'd-1' })
  })

  it('clicking dismiss dispatches item:dismiss with the correct id', async () => {
    const user = userEvent.setup()
    render(<LiveItemsPanel />)
    setItems({ decisions: [PROPOSED_DECISION] })

    await user.click(await screen.findByTestId('dismiss-d-1'))
    expect(mockApi.itemDismiss).toHaveBeenCalledWith({ kind: 'decision', id: 'd-1' })
  })

  it('removes a retracted item from the list', async () => {
    render(<LiveItemsPanel />)
    setItems({ decisions: [PROPOSED_DECISION] })
    expect(await screen.findByTestId('item-d-1')).toBeInTheDocument()

    setItems({ decisions: [] })
    await waitFor(() => {
      expect(screen.queryByTestId('item-d-1')).not.toBeInTheDocument()
    })
  })

  it('edit reveals the inline form; saving dispatches item:editAndConfirm', async () => {
    const user = userEvent.setup()
    render(<LiveItemsPanel />)
    setItems({ decisions: [PROPOSED_DECISION] })

    await user.click(await screen.findByTestId('edit-d-1'))
    const textarea = await screen.findByTestId('edit-textarea-d-1')
    await user.clear(textarea)
    await user.type(textarea, 'Updated rationale')
    await user.click(screen.getByTestId('save-d-1'))

    expect(mockApi.itemEditAndConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'decision',
        id: 'd-1',
        updates: expect.objectContaining({ rationale: 'Updated rationale' }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      }),
    )
  })

  it('manual add opens the form; submitting dispatches item:createConfirmed', async () => {
    const user = userEvent.setup()
    render(<LiveItemsPanel />)

    await user.click(await screen.findByTestId('add-decision-btn'))
    await user.type(await screen.findByTestId('new-decision-input'), 'Nieuw besluit')
    await user.click(screen.getByTestId('submit-new-decision'))

    expect(mockApi.itemCreateConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'decision',
        meetingId: 'active-session',
        item: expect.objectContaining({ rationale: 'Nieuw besluit' }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      }),
    )
  })

  it('pressing Enter on a focused proposed item confirms it', async () => {
    render(<LiveItemsPanel />)
    setItems({ decisions: [PROPOSED_DECISION] })

    const itemEl = await screen.findByTestId('item-d-1')
    itemEl.focus()
    fireEvent.keyDown(itemEl, { key: 'Enter' })

    await waitFor(() => {
      expect(mockApi.itemConfirm).toHaveBeenCalledWith({ kind: 'decision', id: 'd-1' })
    })
  })

  it('pressing Delete on a focused proposed item dismisses it', async () => {
    render(<LiveItemsPanel />)
    setItems({ decisions: [PROPOSED_DECISION] })

    const itemEl = await screen.findByTestId('item-d-1')
    itemEl.focus()
    fireEvent.keyDown(itemEl, { key: 'Delete' })

    await waitFor(() => {
      expect(mockApi.itemDismiss).toHaveBeenCalledWith({ kind: 'decision', id: 'd-1' })
    })
  })
})

// ---------------------------------------------------------------------------
// Live agenda grooming (ADR 0029)
// ---------------------------------------------------------------------------

describe('LiveItemsPanel — agenda grooming', () => {
  beforeEach(() => {
    mockApi.agendaItemConfirm.mockResolvedValue({ ...PROPOSED_AGENDA, state: 'confirmed' })
    mockApi.agendaItemEditAndConfirm.mockResolvedValue({
      ...PROPOSED_AGENDA,
      title: 'Bijgewerkt',
      state: 'confirmed',
    })
    act(() => {
      useAppStore.setState({ agendaItems: [AGENDA_1, PROPOSED_AGENDA] })
    })
  })

  it('renders a Proposed agenda item distinctly with confirm, edit and dismiss controls', () => {
    render(<LiveItemsPanel />)

    const group = screen.getByTestId('proposed-agenda-agenda-prop')
    expect(group).toHaveTextContent('Begroting')
    expect(screen.getByRole('button', { name: /agendapunt bevestigen/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /agendapunt bewerken/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /agendapunt verwijderen/i })).toBeInTheDocument()
  })

  it('confirms a Proposed agenda item via the agenda-confirm IPC', async () => {
    const user = userEvent.setup()
    render(<LiveItemsPanel />)

    await user.click(screen.getByRole('button', { name: /agendapunt bevestigen/i }))
    expect(mockApi.agendaItemConfirm).toHaveBeenCalledWith({ agendaItemId: 'agenda-prop' })
  })

  it('dismisses a Proposed agenda item, removing it from the list', async () => {
    const user = userEvent.setup()
    render(<LiveItemsPanel />)

    await user.click(screen.getByRole('button', { name: /agendapunt verwijderen/i }))
    expect(mockApi.agendaItemRemove).toHaveBeenCalledWith({ agendaItemId: 'agenda-prop' })
    await waitFor(() => {
      expect(screen.queryByTestId('proposed-agenda-agenda-prop')).not.toBeInTheDocument()
    })
  })
})
