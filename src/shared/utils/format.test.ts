import { describe, expect, it } from 'vitest'

import { formatDuration } from './format'

describe('formatDuration', () => {
  it('formats zero seconds as 0:00', () => {
    expect(formatDuration(0)).toBe('0:00')
  })

  it('formats seconds below a minute', () => {
    expect(formatDuration(45)).toBe('0:45')
  })

  it('formats whole minutes', () => {
    expect(formatDuration(60)).toBe('1:00')
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(90)).toBe('1:30')
  })

  it('formats hours', () => {
    expect(formatDuration(3661)).toBe('1:01:01')
  })

  it('pads seconds to two digits', () => {
    expect(formatDuration(65)).toBe('1:05')
  })
})
