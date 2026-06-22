/**
 * ReviewScreen component tests (item 0021).
 *
 * Coverage:
 *   - Renders the review screen with data-testid="screen-review"
 *   - Shows Discussion Summaries per agenda item
 *   - Shows empty state when no summaries available
 *   - Shows confirmed decisions and actions from the store
 *   - Edits to decisions/actions persist via IPC (item:editAndConfirm)
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { ReviewScreen } from '../screens/ReviewScreen'
import { useAppStore } from '../store/appStore'

// ---------------------------------------------------------------------------
// Mock window.api
// ---------------------------------------------------------------------------

const mockApi = {
  ping: vi.fn(),
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  egressState: vi.fn(),
  meetingCreate: vi.fn(),
  meetingStart: vi.fn(),
  meetingEnd: vi.fn().mockResolvedValue({ ok: true }),
  agendaItemAdd: vi.fn(),
  agendaItemRemove: vi.fn(),
  participantAdd: vi.fn(),
  participantRemove: vi.fn(),
  audioStart: vi.fn(),
  audioStop: vi.fn(),
  audioSendFrame: vi.fn(),
  secretSet: vi.fn(),
  secretHas: vi.fn(),
  onTranscriptSpan: vi.fn().mockReturnValue(() => undefined),
  onItemsChanged: vi.fn().mockReturnValue(() => undefined),
  onItemsSummaries: vi.fn().mockReturnValue(() => undefined),
  onNudgesChanged: vi.fn().mockReturnValue(() => undefined),
  onSummaryChanged: vi.fn().mockReturnValue(() => undefined),
  summaryQuery: vi.fn().mockResolvedValue({ answer: '' }),
  itemConfirm: vi.fn().mockResolvedValue({ state: 'confirmed' }),
  itemEditAndConfirm: vi.fn().mockResolvedValue({ state: 'confirmed' }),
  itemDismiss: vi.fn().mockResolvedValue({ ok: true }),
  itemCreateConfirmed: vi.fn().mockResolvedValue({ state: 'confirmed' }),
}

Object.assign(window, { api: mockApi })

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const AGENDA_1 = { id: 'ai-1', title: 'Q3 Review', topic: 'Q3' }

const SUMMARY_1 = {
  id: 's-1',
  agendaItemId: 'ai-1',
  text: 'De groep heeft de Q3-resultaten besproken en besloten door te gaan met het plan.',
}

const CONFIRMED_DECISION = {
  id: 'd-1',
  rationale: 'Release gepland voor Q4',
  agendaItemId: 'ai-1',
  sourceSpanId: 'span-1',
  state: 'confirmed' as const,
}

const CONFIRMED_ACTION = {
  id: 'a-1',
  agendaItemId: 'ai-1',
  sourceSpanId: 'span-1',
  status: 'open' as const,
  state: 'confirmed' as const,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderReview(): ReturnType<typeof render> {
  return render(<ReviewScreen />)
}

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({
    route: 'review',
    activeMeeting: 'mtg-1',
    agendaItems: [],
    participants: [],
    confirmedDecisions: [],
    confirmedActions: [],
    proposedDecisions: [],
    proposedActions: [],
    discussionSummaries: [],
  })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReviewScreen — basic rendering', () => {
  it('renders the screen-review element', () => {
    renderReview()
    expect(screen.getByTestId('screen-review')).toBeInTheDocument()
  })

  it('shows the screen title in Dutch', () => {
    renderReview()
    expect(screen.getByText('Vergadering bekijken')).toBeInTheDocument()
  })

  it('shows the meeting title in the header when one is loaded', () => {
    useAppStore.setState({ meetingTitle: 'Roadmap Q3' })
    renderReview()
    expect(screen.getByText('Notulen — Roadmap Q3')).toBeInTheDocument()
  })
})

describe('ReviewScreen — Discussion Summaries', () => {
  it('shows an empty-state message when no summaries exist', () => {
    renderReview()
    expect(screen.getByTestId('review-no-summaries')).toBeInTheDocument()
  })

  it('renders a discussion summary under its agenda item', () => {
    useAppStore.setState({
      agendaItems: [AGENDA_1],
      discussionSummaries: [SUMMARY_1],
    })
    renderReview()
    expect(screen.getByText('Q3 Review')).toBeInTheDocument()
    expect(
      screen.getByText(
        'De groep heeft de Q3-resultaten besproken en besloten door te gaan met het plan.',
      ),
    ).toBeInTheDocument()
  })

  it('shows the summary section heading', () => {
    useAppStore.setState({ discussionSummaries: [SUMMARY_1], agendaItems: [AGENDA_1] })
    renderReview()
    expect(screen.getAllByText('Discussiesamenvatting').length).toBeGreaterThan(0)
  })
})

describe('ReviewScreen — Decisions and Actions', () => {
  it('renders a confirmed decision', () => {
    useAppStore.setState({
      agendaItems: [AGENDA_1],
      confirmedDecisions: [CONFIRMED_DECISION],
    })
    renderReview()
    expect(screen.getByText('Release gepland voor Q4')).toBeInTheDocument()
  })

  it('renders a confirmed action', () => {
    useAppStore.setState({
      agendaItems: [AGENDA_1],
      confirmedActions: [CONFIRMED_ACTION],
    })
    renderReview()
    // The action card should be present
    expect(screen.getByTestId(`review-action-${CONFIRMED_ACTION.id}`)).toBeInTheDocument()
  })

  it('shows empty-items state when no decisions and no actions', () => {
    renderReview()
    expect(screen.getAllByTestId('review-items-empty').length).toBeGreaterThan(0)
  })
})

describe('ReviewScreen — editing a decision', () => {
  it('opens an edit form when the edit button is clicked', () => {
    useAppStore.setState({
      agendaItems: [AGENDA_1],
      confirmedDecisions: [CONFIRMED_DECISION],
    })
    renderReview()

    const editBtn = screen.getByTestId(`review-edit-decision-${CONFIRMED_DECISION.id}`)
    fireEvent.click(editBtn)

    expect(screen.getByTestId(`review-edit-form-${CONFIRMED_DECISION.id}`)).toBeInTheDocument()
  })

  it('calls itemEditAndConfirm when the save button is clicked', async () => {
    mockApi.itemEditAndConfirm.mockResolvedValue({ ...CONFIRMED_DECISION, rationale: 'Gewijzigd' })
    useAppStore.setState({
      agendaItems: [AGENDA_1],
      confirmedDecisions: [CONFIRMED_DECISION],
    })
    renderReview()

    fireEvent.click(screen.getByTestId(`review-edit-decision-${CONFIRMED_DECISION.id}`))
    const input = screen.getByTestId(`review-edit-input-${CONFIRMED_DECISION.id}`)
    fireEvent.change(input, { target: { value: 'Gewijzigd' } })
    fireEvent.click(screen.getByTestId(`review-save-${CONFIRMED_DECISION.id}`))

    await waitFor(() => {
      expect(mockApi.itemEditAndConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'decision',
          id: CONFIRMED_DECISION.id,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          updates: expect.objectContaining({ rationale: 'Gewijzigd' }),
        }),
      )
    })
  })
})
