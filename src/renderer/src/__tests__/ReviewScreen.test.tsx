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

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
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
  exportMarkdown: vi.fn().mockResolvedValue({ ok: true }),
  exportCopyMarkdown: vi.fn().mockResolvedValue({ ok: true }),
  transcriptCopy: vi.fn().mockResolvedValue({ ok: true }),
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

  it('shows an imported badge when the meeting came from a file', () => {
    useAppStore.setState({ meetingSource: 'import' })
    renderReview()
    expect(screen.getByTestId('review-imported-badge')).toBeInTheDocument()
  })

  it('does not show the imported badge for a live meeting', () => {
    useAppStore.setState({ meetingSource: 'live' })
    renderReview()
    expect(screen.queryByTestId('review-imported-badge')).not.toBeInTheDocument()
  })
})

describe('ReviewScreen — Markdown export', () => {
  it('shows a saving state while exporting, then restores when done', async () => {
    let resolveSave: (v: { ok: true }) => void = () => undefined
    mockApi.exportMarkdown.mockReturnValueOnce(
      new Promise<{ ok: true }>((resolve) => {
        resolveSave = resolve
      }),
    )

    renderReview()
    const btn = screen.getByTestId('review-export-markdown-btn')
    fireEvent.click(btn)

    expect(await screen.findByText('Bezig met opslaan...')).toBeInTheDocument()
    expect(btn).toBeDisabled()

    resolveSave({ ok: true })

    await waitFor(() => {
      expect(screen.getByTestId('review-export-markdown-btn')).not.toBeDisabled()
    })
  })

  it('does not get stuck in the saving state when the dialog is cancelled', async () => {
    mockApi.exportMarkdown.mockResolvedValueOnce({ ok: false, reason: 'cancelled' })

    renderReview()
    const btn = screen.getByTestId('review-export-markdown-btn')
    fireEvent.click(btn)

    await waitFor(() => {
      expect(screen.getByTestId('review-export-markdown-btn')).not.toBeDisabled()
    })
  })
})

describe('ReviewScreen — copy transcript', () => {
  it('copies the transcript of the active meeting via IPC', async () => {
    useAppStore.setState({ activeMeeting: 'mtg-1' })
    renderReview()

    fireEvent.click(screen.getByTestId('review-copy-transcript-btn'))

    await waitFor(() => {
      expect(mockApi.transcriptCopy).toHaveBeenCalledWith({ meetingId: 'mtg-1' })
    })
  })

  it('shows copied feedback after copying the transcript', async () => {
    useAppStore.setState({ activeMeeting: 'mtg-1' })
    renderReview()

    fireEvent.click(screen.getByTestId('review-copy-transcript-btn'))

    expect(await screen.findByText('Transcript gekopieerd!')).toBeInTheDocument()
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

describe('ReviewScreen — Proposed items', () => {
  const PROPOSED_DECISION = {
    id: 'd-p1',
    rationale: 'Voorstel: release naar Q4',
    agendaItemId: 'ai-1',
    sourceSpanId: 'span-x',
    state: 'proposed' as const,
  }

  const PROPOSED_ACTION = {
    id: 'a-p1',
    agendaItemId: 'ai-1',
    sourceSpanId: 'span-x',
    status: 'open' as const,
    state: 'proposed' as const,
  }

  it('renders a proposed decision with confirm and dismiss controls', () => {
    useAppStore.setState({ agendaItems: [AGENDA_1], proposedDecisions: [PROPOSED_DECISION] })
    renderReview()

    expect(screen.getByText('Voorstel: release naar Q4')).toBeInTheDocument()
    expect(screen.getByTestId('review-confirm-decision-d-p1')).toBeInTheDocument()
    expect(screen.getByTestId('review-dismiss-decision-d-p1')).toBeInTheDocument()
  })

  it('is not treated as an empty group when only proposed items exist', () => {
    useAppStore.setState({ agendaItems: [AGENDA_1], proposedActions: [PROPOSED_ACTION] })
    renderReview()

    // The Off-agenda group is still empty, but the AGENDA_1 group is not.
    expect(screen.getByTestId('review-action-a-p1')).toBeInTheDocument()
  })

  // The screen only dispatches the IPC; main is authoritative and pushes the
  // reconciled set back (ADR 0033). The tests assert the dispatch, then simulate
  // that authoritative items:changed to verify the resulting lane state.
  it('confirms a proposed decision via IPC and moves it into the confirmed lane', async () => {
    useAppStore.setState({ agendaItems: [AGENDA_1], proposedDecisions: [PROPOSED_DECISION] })
    renderReview()

    fireEvent.click(screen.getByTestId('review-confirm-decision-d-p1'))

    await waitFor(() => {
      expect(mockApi.itemConfirm).toHaveBeenCalledWith({ kind: 'decision', id: 'd-p1' })
    })

    act(() => {
      useAppStore.getState().reconcileItems({
        meetingId: 'mtg-1',
        decisions: [{ ...PROPOSED_DECISION, state: 'confirmed' }],
        actions: [],
      })
    })
    const s = useAppStore.getState()
    expect(s.proposedDecisions).toHaveLength(0)
    expect(s.confirmedDecisions.map((d) => d.id)).toContain('d-p1')
  })

  it('dismisses a proposed decision via IPC and removes it from the proposed lane', async () => {
    useAppStore.setState({ agendaItems: [AGENDA_1], proposedDecisions: [PROPOSED_DECISION] })
    renderReview()

    fireEvent.click(screen.getByTestId('review-dismiss-decision-d-p1'))

    await waitFor(() => {
      expect(mockApi.itemDismiss).toHaveBeenCalledWith({ kind: 'decision', id: 'd-p1' })
    })

    act(() => {
      useAppStore.getState().reconcileItems({ meetingId: 'mtg-1', decisions: [], actions: [] })
    })
    expect(useAppStore.getState().proposedDecisions).toHaveLength(0)
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
