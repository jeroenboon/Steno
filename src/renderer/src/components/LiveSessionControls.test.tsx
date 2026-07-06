/**
 * LiveSessionControls tests (A1). The capture-mode selector, loopback status
 * line and mic-permission/meter block were previously untested inside the
 * LiveScreen monolith; extracting them gives them a focused surface.
 */

import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'

import { useAppStore } from '../store/appStore'

import { LiveSessionControls } from './LiveSessionControls'

beforeEach(() => {
  act(() => {
    useAppStore.setState({
      captureMode: 'remote',
      loopbackState: null,
      micPermission: 'unknown',
    })
  })
})

describe('LiveSessionControls', () => {
  it('reflects the store capture mode and is editable while permission is unknown', async () => {
    const user = userEvent.setup()
    render(<LiveSessionControls audioLevel={0} />)

    const select = screen.getByTestId('capture-mode-select')
    expect(select.value).toBe('remote')
    expect(select.disabled).toBe(false)

    await user.selectOptions(select, 'mic-only')
    expect(useAppStore.getState().captureMode).toBe('mic-only')
  })

  it('locks the capture mode once permission has resolved', () => {
    act(() => {
      useAppStore.setState({ micPermission: 'granted' })
    })
    render(<LiveSessionControls audioLevel={0} />)
    expect(screen.getByTestId('capture-mode-select').disabled).toBe(true)
  })

  it('shows the active loopback status line when loopback is active', () => {
    act(() => {
      useAppStore.setState({ loopbackState: 'active' })
    })
    render(<LiveSessionControls audioLevel={0} />)
    expect(screen.getByTestId('loopback-active-message')).toBeInTheDocument()
  })

  it('shows the mic-active meter when permission is granted', () => {
    act(() => {
      useAppStore.setState({ micPermission: 'granted' })
    })
    render(<LiveSessionControls audioLevel={0.1} />)
    expect(screen.getByTestId('mic-active-message')).toBeInTheDocument()
    expect(screen.getByTestId('mic-status')).toHaveAttribute('data-mic-permission', 'granted')
  })

  it('shows the denied message when mic permission is denied', () => {
    act(() => {
      useAppStore.setState({ micPermission: 'denied' })
    })
    render(<LiveSessionControls audioLevel={0} />)
    expect(screen.getByTestId('mic-denied-message')).toBeInTheDocument()
  })
})
