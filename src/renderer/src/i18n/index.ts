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
  'nav.home': 'Overzicht',
  'nav.draft': 'Voorbereiding',
  'nav.live': 'Live',
  'nav.review': 'Bekijken',

  // Egress indicator
  'egress.indicator.label': 'Gegevensverwerking',

  // Draft screen (item 0014)
  'draft.paste.heading': 'Agenda plakken',
  'draft.paste.placeholder':
    'Plak hier een agenda uit Word, Outlook of e-mail. We lezen de titel, agendapunten en deelnemers eruit.',
  'draft.paste.button': 'Uitlezen',
  'draft.paste.loading': 'Bezig met uitlezen...',
  'draft.paste.hint': 'Geen agenda herkend. Vul de velden hieronder handmatig in.',
  'draft.meeting.title.label': 'Vergaderingtitel',
  'draft.meeting.title.placeholder': 'Bijv. Q3 Planning',
  'draft.agenda.heading': 'Agenda items',
  'draft.agenda.add.placeholder': 'Agenda item toevoegen',
  'draft.agenda.remove': 'Verwijderen',
  'draft.participants.heading': 'Deelnemers',
  'draft.participants.add.placeholder': 'Deelnemersnaam toevoegen',
  'draft.participants.remove': 'Verwijderen',
  'draft.add': 'Toevoegen',
  'draft.language.label': 'Taal',
  'draft.language.nl': 'Nederlands',
  'draft.language.en': 'English',
  'draft.start.button': 'Starten',
  'draft.start.disabled.reason': 'Voeg een titel in om te kunnen starten',
  'draft.reset.button': 'Opnieuw beginnen',
  'draft.quickstart.button': 'Direct starten',
  'draft.quickstart.hint': 'Begin meteen; titel en agenda vullen we later automatisch aan.',
  'draft.quickstart.autotitle': 'Vergadering',

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
  'live.loopback.state.denied': 'Systeemaudio niet beschikbaar, alleen microfoon wordt opgenomen.',
  'live.loopback.state.off': 'Alleen microfoon',

  // Home screen (item 0023)
  'home.new.button': 'Nieuwe vergadering',
  'home.meetings.heading': 'Eerdere vergaderingen',
  'home.meetings.empty': 'Nog geen vergaderingen.',
  'home.meeting.interrupted': 'onderbroken',
  'home.interrupted.callout': 'Vergadering onderbroken',
  'home.interrupted.resume': 'Hervat',
  'home.active.callout': 'Vergadering loopt',
  'home.active.back': 'Terug',
  'home.import.button': 'Importeer opname',
  'home.delete.action': 'Verwijderen',
  'home.delete.holding': 'Blijf vasthouden…',
  'home.delete.hint': 'Houd ingedrukt om te verwijderen',

  // Import screen (item 0026)
  'nav.import': 'Importeren',
  'screen.import.title': 'Opname importeren',
  'screen.import.subtitle': 'Kies een audiobestand en maak er notulen van.',
  'import.file.label': 'Audiobestand',
  'import.file.hint': 'mp3, wav, m4a, flac of ogg',
  'import.title.label': 'Titel',
  'import.title.placeholder': 'Bijv. Bestuursvergadering',
  'import.language.label': 'Taal',
  'import.agenda.source.label': 'Agenda en deelnemers',
  'import.agenda.source.upload': 'Zelf invoeren',
  'import.agenda.source.infer': 'Laten afleiden',
  'import.agenda.heading': 'Agenda items',
  'import.agenda.add.placeholder': 'Agenda item toevoegen',
  'import.participants.heading': 'Deelnemers',
  'import.participants.add.placeholder': 'Deelnemersnaam toevoegen',
  'import.add': 'Toevoegen',
  'import.remove': 'Verwijderen',
  'import.start.button': 'Importeren',
  'import.start.disabled.reason': 'Kies een bestand en voer een titel in',
  'import.progress.transcribing': 'Transcriberen...',
  'import.progress.inferring': 'Agenda afleiden...',
  'import.progress.extracting': 'Notulen opstellen...',
  'import.progress.done': 'Klaar',
  'import.error': 'Importeren mislukt. Controleer je instellingen en probeer opnieuw.',

  // Settings screen (item 0016)
  'nav.settings': 'Instellingen',
  'screen.settings.title': 'Instellingen',
  'screen.settings.subtitle': 'Kies providers, voer API-sleutels in en stel de taal in.',

  'settings.asr.heading': 'Spraakherkenning (ASR)',
  // ASR provider groups (Phase 0.4)
  'settings.asr.group.device': 'Op dit apparaat',
  'settings.asr.group.cloud': 'Cloud',
  // ASR mode labels
  'settings.asr.mode.local': 'Lokaal',
  'settings.asr.mode.local.sub': 'Whisper, on-device',
  'settings.asr.mode.cloud': 'Deepgram',
  'settings.asr.mode.cloud.sub': 'Deepgram',
  'settings.asr.mode.openai': 'OpenAI',
  'settings.asr.mode.openai.sub': 'Live en import',
  'settings.asr.mode.mistral': 'Mistral Voxtral',
  'settings.asr.mode.mistral.sub': 'Live en import',
  'settings.asr.mode.azure': 'Azure Speech',
  'settings.asr.mode.azure.sub': 'Live en import',
  'settings.asr.audio.model.label': 'Model',
  'settings.asr.audio.key.label': 'API-sleutel',
  'settings.asr.audio.key.placeholder': '...',
  'settings.asr.audio.key.missing': 'Geen sleutel ingesteld. Vul je API-sleutel in.',
  'settings.asr.audio.save': 'Instellingen opslaan',
  'settings.asr.audio.saved': 'Opgeslagen',
  'settings.asr.azure.endpoint.label': 'Endpoint',
  'settings.asr.azure.endpoint.placeholder': 'https://mijn-resource.openai.azure.com/',
  'settings.asr.azure.deployment.label': 'Deployment',
  'settings.asr.azure.deployment.placeholder': 'whisper',
  'settings.asr.azure.apiVersion.label': 'API-versie',
  'settings.asr.azure.apiVersion.placeholder': '2024-06-01',
  // Local model card
  'settings.asr.model.name': 'Whisper small',
  'settings.asr.model.size': '~357 MB',
  'settings.asr.model.installed': 'Geïnstalleerd',
  'settings.asr.model.notDownloaded': 'Nog niet gedownload',
  'settings.asr.model.download': 'Downloaden',
  'settings.asr.model.downloading': 'Downloaden…',
  'settings.asr.key.label': 'Deepgram API-sleutel',
  'settings.asr.key.placeholder': 'dg-...',
  'settings.asr.key.save': 'Opslaan',
  'settings.asr.key.saved': 'Opgeslagen',
  'settings.asr.key.missing': 'Geen sleutel ingesteld. Vul je Deepgram API-sleutel in.',

  'settings.extraction.heading': 'Extractieprovider (LLM)',
  // Extraction provider groups (Phase 0.4)
  'settings.extraction.group.cloud': 'Cloud',
  // Extraction provider labels
  'settings.extraction.mode.anthropic': 'Anthropic',
  'settings.extraction.mode.anthropic.sub': 'Cloud',
  'settings.extraction.mode.openai': 'OpenAI',
  'settings.extraction.mode.openai.sub': 'Cloud',
  'settings.extraction.mode.mistral': 'Mistral',
  'settings.extraction.mode.mistral.sub': 'Cloud',
  'settings.extraction.mode.azure': 'Azure OpenAI',
  'settings.extraction.mode.azure.sub': 'Cloud',
  'settings.extraction.mode.custom': 'Aangepast',
  'settings.extraction.mode.custom.sub': 'OpenAI-compatibel',
  'settings.extraction.anthropic.key.label': 'Anthropic API-sleutel',
  'settings.extraction.anthropic.key.placeholder': 'sk-ant-...',
  'settings.extraction.anthropic.key.save': 'Opslaan',
  'settings.extraction.anthropic.key.saved': 'Opgeslagen',
  'settings.extraction.anthropic.key.missing':
    'Geen sleutel ingesteld. Vul je Anthropic API-sleutel in.',

  // Shared key-status affordances
  'settings.key.saved.status': 'API-sleutel opgeslagen',
  'settings.key.replace': 'Vervangen',
  'settings.key.cancel': 'Annuleren',

  // Test connection affordance (Phase 5.1)
  'settings.test.button': 'Verbinding testen',
  'settings.test.testing': 'Bezig met testen...',
  'settings.test.ok': 'Verbinding gelukt',
  'settings.test.noKey': 'Sla eerst de API-sleutel op',
  'settings.test.network': 'Geen verbinding. Controleer de URL en je internet.',
  'settings.test.unavailable': 'Testen is hier niet beschikbaar',
  'settings.test.failed': 'Afgewezen',

  // Shared vendor key notice (Phase 5.2)
  'settings.sharedKey.notice':
    'Deze API-sleutel geldt voor zowel audio als notulen. Vervangen werkt voor beide rollen.',

  // Where to get a vendor key/endpoint (Phase 5.3)
  'settings.keyHelp.label': 'Sleutel ophalen:',

  'settings.custom.baseUrl.label': 'Basis-URL',
  'settings.custom.baseUrl.placeholder': 'https://api.openai.com/v1',
  'settings.custom.model.label': 'Model',
  'settings.custom.model.placeholder': 'gpt-4o',
  'settings.custom.displayName.label': 'Weergavenaam',
  'settings.custom.displayName.placeholder': 'Mijn LLM',
  'settings.custom.key.label': 'API-sleutel',
  'settings.custom.key.placeholder': 'sk-...',
  'settings.custom.key.save': 'Opslaan',
  'settings.custom.key.saved': 'Opgeslagen',
  'settings.custom.key.missing': 'Geen sleutel ingesteld. Vul je API-sleutel in.',
  'settings.custom.save': 'Instellingen opslaan',
  'settings.custom.saved': 'Opgeslagen',

  // Azure OpenAI extraction config (Phase 2.2)
  'settings.azure.endpoint.label': 'Endpoint',
  'settings.azure.endpoint.placeholder': 'https://mijn-resource.openai.azure.com/',
  'settings.azure.deployment.label': 'Deployment',
  'settings.azure.deployment.placeholder': 'mijn-gpt-deployment',
  'settings.azure.apiVersion.label': 'API-versie',
  'settings.azure.apiVersion.placeholder': '2024-12-01-preview',
  'settings.azure.model.label': 'Model',
  'settings.azure.model.placeholder': 'gpt-4o-mini',
  'settings.azure.displayName.label': 'Weergavenaam',
  'settings.azure.displayName.placeholder': 'Azure OpenAI',
  'settings.azure.key.label': 'API-sleutel',
  'settings.azure.key.placeholder': '...',
  'settings.azure.key.missing': 'Geen sleutel ingesteld. Vul je Azure API-sleutel in.',
  'settings.azure.save': 'Instellingen opslaan',
  'settings.azure.saved': 'Opgeslagen',

  'settings.language.heading': 'Vergadertaal',

  'settings.disclosure.audio.label': 'Audiogegevens:',
  'settings.disclosure.notes.label': 'Tekstgegevens:',

  'settings.validation.baseUrl': 'Voer een geldige URL in (bijv. https://api.example.com/v1)',
  'settings.validation.model': 'Voer een modelnaam in',
  'settings.validation.displayName': 'Voer een weergavenaam in',
  'settings.validation.endpoint':
    'Voer een geldige endpoint-URL in (bijv. https://mijn-resource.openai.azure.com/)',
  'settings.validation.deployment': 'Voer een deployment-naam in',
  'settings.validation.apiVersion': 'Voer een API-versie in',

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
  'live.agenda.proposed.label': '(voorgesteld)',
  'live.agenda.confirm': 'Agendapunt bevestigen',
  'live.agenda.edit': 'Agendapunt bewerken',
  'live.agenda.dismiss': 'Agendapunt verwijderen',
  'live.agenda.edit.save': 'Opslaan',
  'live.agenda.edit.cancel': 'Annuleren',
  'live.agenda.edit.titleLabel': 'Titel agendapunt',
  'live.items.edit': 'Bewerken',
  'live.items.save': 'Opslaan',
  'live.items.cancel': 'Annuleren',
  'live.items.source': 'Bron',
  'live.items.owner': 'Eigenaar',
  'live.items.owner.none': 'Geen eigenaar',
  'live.items.empty': 'Nog geen items.',
  'live.items.action.untitled': 'Actie (geen omschrijving)',
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

  // Running Summary panel (item 0020)
  'live.summary.heading': 'Vergaderingsoverzicht',
  'live.summary.disclaimer': 'Informatief: niet gezaghebbend over beslissingen en acties.',
  'live.summary.empty': 'Het overzicht verschijnt zodra er transcriptie beschikbaar is.',
  'live.summary.query.placeholder': 'Stel een vraag over de vergadering…',
  'live.summary.query.button': 'Vraag',
  'live.summary.answer.label': 'Antwoord',
  'live.summary.loading': 'Bezig met ophalen…',

  // Live screen — end meeting (item 0021)
  'live.end.button': 'Vergadering beëindigen',
  'live.end.busy': 'Afronden…',
  'live.ending.title': 'Notulen worden gegenereerd…',
  'live.ending.subtitle':
    'De vergadering wordt afgerond en de notulen per agendapunt worden opgesteld. Even geduld.',
  'live.pause.button': 'Pauzeren',
  'live.resume.button': 'Hervatten',
  'live.noactive.message': 'Ga naar Voorbereiding om een vergadering te starten.',
  'live.noactive.action': 'Naar voorbereiding',

  // Review screen (item 0021)
  'review.title.prefix': 'Notulen',
  'review.imported.badge': 'Geïmporteerd',
  'review.meta.participant': 'deelnemer',
  'review.meta.participants': 'deelnemers',
  'review.summary.heading': 'Discussiesamenvatting',
  'review.summary.empty': 'Geen samenvatting beschikbaar.',
  'review.items.decisions.heading': 'Beslissingen',
  'review.items.actions.heading': 'Acties',
  'review.items.empty': 'Geen items.',
  'review.items.confirm': 'Bevestigen',
  'review.items.dismiss': 'Verwerpen',
  'review.items.edit': 'Bewerken',
  'review.items.save': 'Opslaan',
  'review.items.cancel': 'Annuleren',
  'review.items.owner': 'Eigenaar',
  'review.items.owner.none': 'Geen eigenaar',
  'review.items.offagenda.heading': 'Buiten agenda',

  // Export actions (item 0022)
  'review.export.markdown': 'Exporteer als Markdown',
  'review.export.saving': 'Bezig met opslaan...',
  'review.export.saved': 'Opgeslagen',
  'review.export.copy': 'Kopieer als Markdown',
  'review.export.copied': 'Gekopieerd!',
  'review.export.error': 'Export mislukt',
  'review.transcript.copy': 'Kopieer transcript',
  'review.transcript.copied': 'Transcript gekopieerd!',

  // Generic
  'app.name': 'Steno',
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

/** The raw Dutch dictionary — exported for guard tests only. */
export const dictionary: Record<string, string> = nl
