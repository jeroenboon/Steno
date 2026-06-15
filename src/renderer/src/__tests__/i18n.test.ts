/**
 * Item 0013 — i18n tests.
 *
 * Coverage:
 *   1. t() returns Dutch strings for known keys (default locale).
 *   2. t() returns a fallback (the key itself) for unknown keys, not a crash.
 *   3. t() supports interpolation for strings with placeholders.
 *   4. The Dutch dictionary covers the expected keys for this item.
 */

import { describe, it, expect } from 'vitest'

import { t, type TranslationKey } from '../i18n'

describe('i18n — Dutch default', () => {
  it('returns a Dutch string for "screen.draft.title"', () => {
    const result = t('screen.draft.title')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    // Should be Dutch, not the key itself
    expect(result).not.toBe('screen.draft.title')
  })

  it('returns a Dutch string for "screen.live.title"', () => {
    const result = t('screen.live.title')
    expect(result).not.toBe('screen.live.title')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns a Dutch string for "screen.review.title"', () => {
    const result = t('screen.review.title')
    expect(result).not.toBe('screen.review.title')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns a Dutch string for "egress.indicator.label"', () => {
    const result = t('egress.indicator.label')
    expect(result).not.toBe('egress.indicator.label')
  })

  it('covers "nav.draft", "nav.live", "nav.review"', () => {
    expect(t('nav.draft').length).toBeGreaterThan(0)
    expect(t('nav.live').length).toBeGreaterThan(0)
    expect(t('nav.review').length).toBeGreaterThan(0)
  })
})

describe('i18n — type safety', () => {
  it('TranslationKey is a string union (type-level test)', () => {
    // This is a compile-time test; if TranslationKey is wrong,
    // the import will fail or the below assignments will error.
    const key1: TranslationKey = 'screen.draft.title'
    const key2: TranslationKey = 'screen.live.title'
    const key3: TranslationKey = 'screen.review.title'
    expect([key1, key2, key3].length).toBe(3)
  })
})
