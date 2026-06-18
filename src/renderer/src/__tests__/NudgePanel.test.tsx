/**
 * NudgePanel component tests (item 0019).
 *
 * Coverage:
 *   1. Renders nothing when there are no nudges.
 *   2. Renders all visible nudges with the correct Dutch message.
 *   3. Dismissed nudge IDs are filtered out before render.
 *   4. Clicking the dismiss button calls onDismiss with the nudge id.
 *   5. Keyboard dismiss (D / Escape) calls onDismiss.
 *   6. All three nudge kinds render their correct i18n message.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, vi } from 'vitest'

import type { Nudge, NudgeId } from '@shared/domain/types'

import { NudgePanel } from '../components/NudgePanel'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNudge(overrides: Partial<Nudge>): Nudge {
  return {
    id: 'nudge-1',
    kind: 'action-no-owner',
    relatedItemIds: ['act-1'],
    message: 'nudge.action-no-owner',
    ...overrides,
  }
}

const noOwnerNudge = makeNudge({ id: 'n1', kind: 'action-no-owner' })
const conflictingNudge = makeNudge({
  id: 'n2',
  kind: 'conflicting-decisions',
  relatedItemIds: ['dec-1', 'dec-2'],
})
const emptyAgendaNudge = makeNudge({
  id: 'n3',
  kind: 'empty-agenda-item',
  relatedItemIds: ['ag-1'],
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NudgePanel', () => {
  it('renders nothing when there are no nudges', () => {
    const { container } = render(
      <NudgePanel nudges={[]} dismissedNudgeIds={new Set()} onDismiss={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when all nudges are dismissed', () => {
    const dismissed = new Set<NudgeId>(['n1'])
    const { container } = render(
      <NudgePanel nudges={[noOwnerNudge]} dismissedNudgeIds={dismissed} onDismiss={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the nudge panel when there are visible nudges', () => {
    render(<NudgePanel nudges={[noOwnerNudge]} dismissedNudgeIds={new Set()} onDismiss={vi.fn()} />)
    expect(screen.getByTestId('nudge-panel')).toBeDefined()
  })

  it('renders the action-no-owner nudge with Dutch message', () => {
    render(<NudgePanel nudges={[noOwnerNudge]} dismissedNudgeIds={new Set()} onDismiss={vi.fn()} />)
    expect(screen.getByTestId(`nudge-${noOwnerNudge.id}`)).toBeDefined()
    expect(screen.getByText(/actie heeft geen eigenaar/i)).toBeDefined()
  })

  it('renders the conflicting-decisions nudge with Dutch message', () => {
    render(
      <NudgePanel nudges={[conflictingNudge]} dismissedNudgeIds={new Set()} onDismiss={vi.fn()} />,
    )
    expect(screen.getByText(/tegenstrijdig/i)).toBeDefined()
  })

  it('renders the empty-agenda-item nudge with Dutch message', () => {
    render(
      <NudgePanel nudges={[emptyAgendaNudge]} dismissedNudgeIds={new Set()} onDismiss={vi.fn()} />,
    )
    expect(screen.getByText(/geen beslissingen of acties/i)).toBeDefined()
  })

  it('does NOT render dismissed nudges', () => {
    const dismissed = new Set<NudgeId>(['n2'])
    render(
      <NudgePanel
        nudges={[noOwnerNudge, conflictingNudge]}
        dismissedNudgeIds={dismissed}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.queryByTestId(`nudge-${conflictingNudge.id}`)).toBeNull()
    expect(screen.getByTestId(`nudge-${noOwnerNudge.id}`)).toBeDefined()
  })

  it('calls onDismiss with the nudge id when the dismiss button is clicked', () => {
    const onDismiss = vi.fn()
    render(
      <NudgePanel nudges={[noOwnerNudge]} dismissedNudgeIds={new Set()} onDismiss={onDismiss} />,
    )
    const btn = screen.getByTestId(`dismiss-nudge-${noOwnerNudge.id}`)
    fireEvent.click(btn)
    expect(onDismiss).toHaveBeenCalledWith(noOwnerNudge.id)
  })

  it('calls onDismiss when D is pressed on a focused nudge', () => {
    const onDismiss = vi.fn()
    render(
      <NudgePanel nudges={[noOwnerNudge]} dismissedNudgeIds={new Set()} onDismiss={onDismiss} />,
    )
    const card = screen.getByTestId(`nudge-${noOwnerNudge.id}`)
    fireEvent.keyDown(card, { key: 'D' })
    expect(onDismiss).toHaveBeenCalledWith(noOwnerNudge.id)
  })

  it('calls onDismiss when Escape is pressed on a focused nudge', () => {
    const onDismiss = vi.fn()
    render(
      <NudgePanel nudges={[noOwnerNudge]} dismissedNudgeIds={new Set()} onDismiss={onDismiss} />,
    )
    const card = screen.getByTestId(`nudge-${noOwnerNudge.id}`)
    fireEvent.keyDown(card, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledWith(noOwnerNudge.id)
  })

  it('renders multiple nudges when none are dismissed', () => {
    render(
      <NudgePanel
        nudges={[noOwnerNudge, conflictingNudge, emptyAgendaNudge]}
        dismissedNudgeIds={new Set()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByTestId(`nudge-${noOwnerNudge.id}`)).toBeDefined()
    expect(screen.getByTestId(`nudge-${conflictingNudge.id}`)).toBeDefined()
    expect(screen.getByTestId(`nudge-${emptyAgendaNudge.id}`)).toBeDefined()
  })
})
