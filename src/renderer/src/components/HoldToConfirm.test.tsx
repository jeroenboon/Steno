/**
 * HoldToConfirm tests.
 *
 * The destructive-action friction pattern (Cahier Final Master Spec): the user
 * must press and hold for `holdMs` before the action fires. Releasing early
 * cancels. There is a keyboard path (hold Enter/Space). Red is never used; the
 * fill is Myrtle (styled in app.css).
 *
 * Timers are faked so the 1.5s hold is deterministic (no real wall-clock wait).
 */

import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'

import { HoldToConfirm } from './HoldToConfirm'

afterEach(() => {
  vi.useRealTimers()
})

describe('HoldToConfirm', () => {
  it('renders its label', () => {
    render(<HoldToConfirm label="Verwijderen" onConfirm={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Verwijderen' })).toBeInTheDocument()
  })

  it('fires onConfirm only after the full hold duration', () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    render(<HoldToConfirm label="Verwijderen" holdMs={1000} onConfirm={onConfirm} />)
    const btn = screen.getByRole('button')

    fireEvent.pointerDown(btn)
    vi.advanceTimersByTime(999)
    expect(onConfirm).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('does not fire if released before the hold completes', () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    render(<HoldToConfirm label="Verwijderen" holdMs={1000} onConfirm={onConfirm} />)
    const btn = screen.getByRole('button')

    fireEvent.pointerDown(btn)
    vi.advanceTimersByTime(500)
    fireEvent.pointerUp(btn)
    vi.advanceTimersByTime(1000)

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('cancels when the pointer leaves the button mid-hold', () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    render(<HoldToConfirm label="Verwijderen" holdMs={1000} onConfirm={onConfirm} />)
    const btn = screen.getByRole('button')

    fireEvent.pointerDown(btn)
    vi.advanceTimersByTime(500)
    fireEvent.pointerLeave(btn)
    vi.advanceTimersByTime(1000)

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirms via a held Enter key (keyboard path)', () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    render(<HoldToConfirm label="Verwijderen" holdMs={1000} onConfirm={onConfirm} />)
    const btn = screen.getByRole('button')

    fireEvent.keyDown(btn, { key: 'Enter' })
    vi.advanceTimersByTime(1000)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('cancels when Enter is released before completion', () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    render(<HoldToConfirm label="Verwijderen" holdMs={1000} onConfirm={onConfirm} />)
    const btn = screen.getByRole('button')

    fireEvent.keyDown(btn, { key: 'Enter' })
    vi.advanceTimersByTime(500)
    fireEvent.keyUp(btn, { key: 'Enter' })
    vi.advanceTimersByTime(1000)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('does nothing when disabled', () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    render(<HoldToConfirm label="Verwijderen" holdMs={1000} disabled onConfirm={onConfirm} />)
    const btn = screen.getByRole('button')

    fireEvent.pointerDown(btn)
    vi.advanceTimersByTime(1000)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('passes through data-testid, aria-label and className', () => {
    render(
      <HoldToConfirm
        label="Verwijderen"
        onConfirm={vi.fn()}
        data-testid="hold-delete"
        aria-label="Verwijder Q3"
        className="extra"
      />,
    )
    const btn = screen.getByTestId('hold-delete')
    expect(btn).toHaveAccessibleName('Verwijder Q3')
    expect(btn).toHaveClass('extra')
  })
})
