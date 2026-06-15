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

  // Draft screen (item 0014)
  'draft.meeting.title.label': 'Vergaderingtitel',
  'draft.meeting.title.placeholder': 'Bijv. Q3 Planning',
  'draft.agenda.heading': 'Agenda items',
  'draft.agenda.add.placeholder': 'Agenda item toevoegen',
  'draft.agenda.remove': 'Verwijderen',
  'draft.participants.heading': 'Deelnemers',
  'draft.participants.add.placeholder': 'Deelnemersnaam toevoegen',
  'draft.participants.remove': 'Verwijderen',
  'draft.language.label': 'Taal',
  'draft.language.nl': 'Nederlands',
  'draft.language.en': 'English',
  'draft.start.button': 'Starten',
  'draft.start.disabled.reason': 'Voeg een titel in om te kunnen starten',

  // Live screen — audio capture (item 0015)
  'live.mic.starting': 'Microfoon starten...',
  'live.mic.active': 'Microfoon actief',
  'live.mic.denied':
    'Toegang tot microfoon geweigerd. Controleer de machtigingen en herstart de app.',
  'live.transcript.heading': 'Transcriptie',
  'live.transcript.empty': 'Zodra je praat verschijnt de transcriptie hier.',
  'live.transcript.interim': '(wordt bijgewerkt)',

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
