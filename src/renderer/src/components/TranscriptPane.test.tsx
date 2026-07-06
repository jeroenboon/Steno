/**
 * TranscriptPane tests (A1 — re-homed from LiveScreen.test.tsx).
 *
 * The pane is store-connected: it reads transcriptSpans + transcriptOpen from
 * the Zustand store and owns the collapse toggle. Tests drive the store
 * directly and assert the rendered DOM.
 */

import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'

import type { TranscriptSpan } from '@shared/domain/types'

import { useAppStore } from '../store/appStore'

import { TranscriptPane } from './TranscriptPane'

const FINAL_SPAN: TranscriptSpan = {
  id: 'span-1',
  text: 'We beslissen de release te plannen voor Q4',
  startMs: 0,
  endMs: 2000,
  isFinal: true,
  confidence: 0.9,
}

const INTERIM_SPAN: TranscriptSpan = {
  id: 'span-interim',
  text: 'nog niet af',
  startMs: 2000,
  endMs: 3000,
  isFinal: false,
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

function setSpans(spans: TranscriptSpan[]) {
  act(() => {
    useAppStore.setState({ transcriptSpans: spans })
  })
}

beforeEach(() => {
  useAppStore.setState({ transcriptSpans: [], transcriptOpen: true })
})

describe('TranscriptPane', () => {
  it('is open by default: a span shows without any interaction', () => {
    setSpans([FINAL_SPAN])
    render(<TranscriptPane />)

    expect(screen.getByTestId('transcript-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('transcript-list')).toBeInTheDocument()
    expect(screen.getByText(FINAL_SPAN.text)).toBeInTheDocument()
  })

  it('shows the empty state when there are no spans', () => {
    render(<TranscriptPane />)
    expect(screen.getByTestId('transcript-empty')).toBeInTheDocument()
  })

  it('clicking the toggle collapses the pane', async () => {
    const user = userEvent.setup()
    setSpans([FINAL_SPAN])
    render(<TranscriptPane />)

    expect(screen.getByTestId('transcript-list')).toBeInTheDocument()
    await user.click(screen.getByTestId('transcript-toggle'))

    await waitFor(() => {
      expect(screen.queryByTestId('transcript-list')).not.toBeInTheDocument()
    })
  })

  it('flags a low-confidence final span', () => {
    setSpans([LOW_CONFIDENCE_SPAN])
    render(<TranscriptPane />)

    const spanEl = screen.getByTestId(`transcript-span-${LOW_CONFIDENCE_SPAN.id}`)
    expect(spanEl).toHaveAttribute('data-low-confidence', 'true')
  })

  it('marks an interim span as interim', () => {
    setSpans([INTERIM_SPAN])
    render(<TranscriptPane />)

    const spanEl = screen.getByTestId(`transcript-span-${INTERIM_SPAN.id}`)
    expect(spanEl).toHaveClass('transcript__span--interim')
  })
})
