import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, it, expect } from 'vitest'

import { Wordmark } from './Wordmark'

describe('Wordmark', () => {
  it('renders the Steno wordmark as an accessible image', () => {
    render(<Wordmark />)
    const img = screen.getByRole('img', { name: 'Steno' })
    expect(img).toBeInTheDocument()
    expect(img.tagName).toBe('IMG')
  })

  it('points at the bundled wordmark asset', () => {
    render(<Wordmark />)
    const img = screen.getByRole('img', { name: 'Steno' })
    expect(img.getAttribute('src')).toMatch(/steno-wordmark\.svg/)
  })
})
