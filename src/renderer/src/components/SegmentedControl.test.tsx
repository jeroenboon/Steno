/**
 * Tests for SegmentedControl — a keyboard-accessible two-or-more option toggle.
 *
 * Rendered as a radiogroup so arrow keys move between segments (rule #15:
 * keyboard-first). No real IPC; pure component test.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { SegmentedControl } from './SegmentedControl'

const options = [
  { value: 'local', label: 'Lokaal', sublabel: 'Whisper' },
  { value: 'cloud', label: 'Cloud', sublabel: 'Deepgram' },
]

describe('SegmentedControl', () => {
  it('renders every option label', () => {
    render(
      <SegmentedControl
        name="asr"
        ariaLabel="ASR"
        value="local"
        options={options}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('Lokaal')).toBeDefined()
    expect(screen.getByText('Cloud')).toBeDefined()
  })

  it('exposes a radiogroup with the current value checked', () => {
    render(
      <SegmentedControl
        name="asr"
        ariaLabel="ASR"
        value="cloud"
        options={options}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('radiogroup')).toBeDefined()
    const cloud = screen.getByDisplayValue('cloud')
    expect(cloud.checked).toBe(true)
    const local = screen.getByDisplayValue('local')
    expect(local.checked).toBe(false)
  })

  it('calls onChange with the selected value', () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl
        name="asr"
        ariaLabel="ASR"
        value="local"
        options={options}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByDisplayValue('cloud'))
    expect(onChange).toHaveBeenCalledWith('cloud')
  })
})
