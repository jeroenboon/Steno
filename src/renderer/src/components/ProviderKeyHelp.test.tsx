/**
 * Tests for ProviderKeyHelp (Phase 5.3).
 *
 * Renders an in-app pointer to where the user obtains a vendor's API key. Shows
 * nothing for a custom/unknown keyRef (we have no canonical page for those).
 */

import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'

import { ProviderKeyHelp } from './ProviderKeyHelp'

describe('ProviderKeyHelp', () => {
  it('shows the OpenAI key page for the openai keyRef', () => {
    render(<ProviderKeyHelp keyRef="openai" testId="help-openai" />)
    expect(screen.getByTestId('help-openai').textContent).toContain(
      'https://platform.openai.com/api-keys',
    )
  })

  it('renders nothing for an unknown/custom keyRef', () => {
    render(<ProviderKeyHelp keyRef="openai-custom" testId="help-custom" />)
    expect(screen.queryByTestId('help-custom')).toBeNull()
  })
})
