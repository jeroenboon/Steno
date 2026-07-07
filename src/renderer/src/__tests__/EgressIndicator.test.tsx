/**
 * Item 0013 — EgressIndicator component tests.
 *
 * Coverage:
 *   1. Renders correct badge text for each EgressState combination:
 *      - all-local (local ASR + Anthropic notes)  → "audio lokaal · notulen via Anthropic"
 *      - cloud-ASR  (Deepgram + Anthropic)         → "audio via Deepgram · notulen via Anthropic"
 *      - cloud-LLM  (local ASR + custom endpoint)  → "audio lokaal · notulen via Acme"
 *      - both cloud (Deepgram + Anthropic)          → "audio via Deepgram · notulen via Anthropic"
 *   2. Has the correct data-testid.
 *   3. Does not crash when the state updates.
 */

import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, it, expect } from 'vitest'

import type { EgressState } from '@shared/ipc'

import { EgressIndicator } from '../components/EgressIndicator'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderIndicator(state: EgressState): ReturnType<typeof render> {
  return render(<EgressIndicator egressState={state} />)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EgressIndicator — badge text', () => {
  it('shows "audio lokaal · notulen via Anthropic" for local ASR + Anthropic', () => {
    renderIndicator({ audio: 'local', notes: 'cloud:Anthropic' })
    expect(screen.getByTestId('egress-indicator')).toHaveTextContent(
      'audio lokaal · notulen via Anthropic',
    )
  })

  it('shows "audio via Deepgram · notulen via Anthropic" for cloud ASR + Anthropic', () => {
    renderIndicator({ audio: 'cloud:Deepgram', notes: 'cloud:Anthropic' })
    expect(screen.getByTestId('egress-indicator')).toHaveTextContent(
      'audio via Deepgram · notulen via Anthropic',
    )
  })

  it('shows "audio lokaal · notulen via Acme" for local ASR + custom endpoint named Acme', () => {
    renderIndicator({ audio: 'local', notes: 'cloud:custom:Acme' })
    expect(screen.getByTestId('egress-indicator')).toHaveTextContent(
      'audio lokaal · notulen via Acme',
    )
  })

  it('shows "audio via Deepgram · notulen via Anthropic" when both are cloud', () => {
    renderIndicator({ audio: 'cloud:Deepgram', notes: 'cloud:Anthropic' })
    expect(screen.getByTestId('egress-indicator')).toHaveTextContent(
      'audio via Deepgram · notulen via Anthropic',
    )
  })
})

describe('EgressIndicator — data-testid', () => {
  it('has data-testid="egress-indicator"', () => {
    renderIndicator({ audio: 'local', notes: 'cloud:Anthropic' })
    expect(screen.getByTestId('egress-indicator')).toBeInTheDocument()
  })
})

describe('EgressIndicator — ASR terminal state (audit C4)', () => {
  const state: EgressState = { audio: 'cloud:Deepgram', notes: 'cloud:Anthropic' }

  it('shows the Dutch "sleutel geweigerd" message for reason auth', () => {
    render(<EgressIndicator egressState={state} terminalReason="auth" />)
    expect(screen.getByTestId('egress-terminal')).toHaveTextContent(
      'Transcriptie gestopt: sleutel geweigerd',
    )
  })

  it('shows the Dutch "verbinding verbroken" message for reason max-retries', () => {
    render(<EgressIndicator egressState={state} terminalReason="max-retries" />)
    expect(screen.getByTestId('egress-terminal')).toHaveTextContent(
      'Transcriptie gestopt: verbinding verbroken',
    )
  })

  it('exposes the terminal message as a live status region (accessibility)', () => {
    render(<EgressIndicator egressState={state} terminalReason="auth" />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'assertive')
    expect(status).toHaveTextContent('Transcriptie gestopt: sleutel geweigerd')
  })

  it('keeps the normal egress badge visible alongside the terminal message', () => {
    render(<EgressIndicator egressState={state} terminalReason="auth" />)
    expect(screen.getByTestId('egress-indicator')).toHaveTextContent(
      'audio via Deepgram · notulen via Anthropic',
    )
  })

  it('shows no terminal message when terminalReason is null (normal state)', () => {
    render(<EgressIndicator egressState={state} terminalReason={null} />)
    expect(screen.queryByTestId('egress-terminal')).not.toBeInTheDocument()
  })

  it('returns to normal (no terminal message) when the reason clears on rerender', () => {
    const { rerender } = render(<EgressIndicator egressState={state} terminalReason="auth" />)
    expect(screen.getByTestId('egress-terminal')).toBeInTheDocument()
    rerender(<EgressIndicator egressState={state} terminalReason={null} />)
    expect(screen.queryByTestId('egress-terminal')).not.toBeInTheDocument()
  })

  // Extraction terminal state (ADR 0042)

  it('shows the extraction terminal message additively as an assertive live region', () => {
    render(<EgressIndicator egressState={state} extractionTerminalReason="output-truncated" />)
    const el = screen.getByTestId('egress-extraction-terminal')
    expect(el).toHaveTextContent('Notulen gestopt: model ongeschikt')
    expect(el).toHaveAttribute('role', 'status')
    expect(el).toHaveAttribute('aria-live', 'assertive')
    // The normal badge is still present.
    expect(screen.getByTestId('egress-indicator')).toBeInTheDocument()
  })

  it('shows no extraction terminal message when the reason is null', () => {
    render(<EgressIndicator egressState={state} extractionTerminalReason={null} />)
    expect(screen.queryByTestId('egress-extraction-terminal')).not.toBeInTheDocument()
  })
})
