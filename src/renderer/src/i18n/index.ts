/**
 * Lightweight i18n (item 0013).
 *
 * Dutch is the default (and only) locale for V1. The structure is
 * deliberately simple: a typed dictionary keyed by dot-path strings.
 * Adding English means adding a second dictionary and a locale switcher
 * — the types already force coverage parity.
 *
 * Principles:
 *   - No runtime i18n library dependency (keeps the bundle lean).
 *   - TranslationKey is a union of every key in the Dutch dictionary.
 *     The TypeScript compiler enforces that all keys are translated.
 *   - Strings are plain Dutch (no markdown, no HTML).
 */

// ---------------------------------------------------------------------------
// Dictionary
// ---------------------------------------------------------------------------

const nl = {
  // Screens
  'screen.draft.title': 'Vergadering instellen',
  'screen.draft.subtitle': 'Voeg agenda en deelnemers toe om te beginnen.',

  'screen.live.title': 'Vergadering loopt',
  'screen.live.subtitle': 'Acties en beslissingen worden live bijgehouden.',

  'screen.review.title': 'Vergadering bekijken',
  'screen.review.subtitle': 'Controleer en bewerk de notulen.',

  // Navigation
  'nav.draft': 'Voorbereiding',
  'nav.live': 'Live',
  'nav.review': 'Bekijken',

  // Egress indicator
  'egress.indicator.label': 'Gegevensverwerking',

  // Generic
  'app.name': 'LiveTranscriber',
} as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TranslationKey = keyof typeof nl

// ---------------------------------------------------------------------------
// Translate function
// ---------------------------------------------------------------------------

/**
 * Return the Dutch translation for a key.
 *
 * The key parameter is typed as TranslationKey, so unknown keys are a
 * compile-time error. The function never throws at runtime.
 */
export function t(key: TranslationKey): string {
  return nl[key]
}
