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

  // Live screen — loopback toggle (item 0017)
  'live.loopback.toggle.label': 'Vergaderingsmodus',
  'live.loopback.mode.remote': 'Videovergadering (systeem + microfoon)',
  'live.loopback.mode.mic-only': 'Persoonlijk (alleen microfoon)',
  'live.loopback.state.active': 'Systeemaudio actief',
  'live.loopback.state.denied': 'Systeemaudio niet beschikbaar — alleen microfoon wordt opgenomen.',
  'live.loopback.state.off': 'Alleen microfoon',

  // Settings screen (item 0016)
  'nav.settings': 'Instellingen',
  'screen.settings.title': 'Instellingen',
  'screen.settings.subtitle': 'Kies providers, voer API-sleutels in en stel de taal in.',

  'settings.asr.heading': 'Spraakherkenning (ASR)',
  'settings.asr.deepgram.label': 'Deepgram (cloud)',
  'settings.asr.parakeet.label': 'Lokaal Parakeet (binnenkort)',
  'settings.asr.key.label': 'Deepgram API-sleutel',
  'settings.asr.key.placeholder': 'dg-...',
  'settings.asr.key.save': 'Opslaan',
  'settings.asr.key.saved': 'Opgeslagen',
  'settings.asr.key.missing': 'Geen sleutel ingesteld. Vul je Deepgram API-sleutel in.',

  'settings.extraction.heading': 'Extractieprovider (LLM)',
  'settings.extraction.anthropic.label': 'Anthropic (cloud)',
  'settings.extraction.custom.label': 'Aangepast OpenAI-compatibel eindpunt',
  'settings.extraction.anthropic.key.label': 'Anthropic API-sleutel',
  'settings.extraction.anthropic.key.placeholder': 'sk-ant-...',
  'settings.extraction.anthropic.key.save': 'Opslaan',
  'settings.extraction.anthropic.key.saved': 'Opgeslagen',
  'settings.extraction.anthropic.key.missing':
    'Geen sleutel ingesteld. Vul je Anthropic API-sleutel in.',

  'settings.custom.baseUrl.label': 'Basis-URL',
  'settings.custom.baseUrl.placeholder': 'https://api.openai.com/v1',
  'settings.custom.model.label': 'Model',
  'settings.custom.model.placeholder': 'gpt-4o',
  'settings.custom.displayName.label': 'Weergavenaam',
  'settings.custom.displayName.placeholder': 'Mijn LLM',
  'settings.custom.key.label': 'API-sleutel',
  'settings.custom.key.placeholder': 'sk-...',
  'settings.custom.key.save': 'Opslaan',
  'settings.custom.save': 'Instellingen opslaan',

  'settings.language.heading': 'Vergadertaal',

  'settings.disclosure.audio.label': 'Audiogegevens:',
  'settings.disclosure.notes.label': 'Tekstgegevens:',

  'settings.validation.baseUrl': 'Voer een geldige URL in (bijv. https://api.example.com/v1)',
  'settings.validation.model': 'Voer een modelnaam in',
  'settings.validation.displayName': 'Voer een weergavenaam in',

  // No-key banner (item 0016)
  'nokey.banner.title': 'API-sleutels niet ingesteld',
  'nokey.banner.body':
    'Ga naar Instellingen om je API-sleutels in te voeren voordat je een vergadering start.',
  'nokey.banner.action': 'Naar instellingen',

  // Live screen — items panel (item 0018)
  'live.items.decisions.heading': 'Beslissingen',
  'live.items.actions.heading': 'Acties',
  'live.items.offagenda.heading': 'Buiten agenda',
  'live.items.confirm': 'Bevestigen',
  'live.items.dismiss': 'Verwerpen',
  'live.items.edit': 'Bewerken',
  'live.items.save': 'Opslaan',
  'live.items.cancel': 'Annuleren',
  'live.items.source': 'Bron',
  'live.items.owner': 'Eigenaar',
  'live.items.owner.none': 'Geen eigenaar',
  'live.items.empty': 'Nog geen items.',
  'live.items.add.decision': 'Beslissing toevoegen',
  'live.items.add.action': 'Actie toevoegen',
  'live.items.add.decision.placeholder': 'Beschrijf de beslissing...',
  'live.items.add.action.placeholder': 'Beschrijf de actie...',
  'live.items.shortcuts': 'Enter = bevestigen · Delete = verwerpen · E = bewerken',
  'live.items.state.proposed': 'Voorgesteld',
  'live.items.state.confirmed': 'Bevestigd',
  'live.items.low-confidence': 'Lage betrouwbaarheid',
  'live.transcript.toggle.show': 'Transcriptie tonen',
  'live.transcript.toggle.hide': 'Transcriptie verbergen',
  'live.agenda.current': 'Huidig agendapunt',
  'live.agenda.none': 'Geen agendapunt',

  // Nudges (item 0019)
  'nudge.action-no-owner':
    'Deze actie heeft geen eigenaar. Wijs iemand toe voordat de vergadering eindigt.',
  'nudge.conflicting-decisions':
    'Twee beslissingen onder hetzelfde agendapunt lijken tegenstrijdig. Controleer en bevestig de juiste.',
  'nudge.empty-agenda-item':
    'Dit agendapunt heeft nog geen beslissingen of acties na meer dan 5 minuten.',
  'nudge.dismiss': 'Sluiten',

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
