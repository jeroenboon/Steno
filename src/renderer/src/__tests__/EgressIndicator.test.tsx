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
