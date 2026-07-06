/**
 * Settings screen (item 0016, refactored Phase 0.4).
 *
 * Allows the user to:
 *   - Switch ASR between Lokaal (Whisper, on-device) and Cloud (Deepgram)
 *   - Switch extraction between Anthropic and a custom OpenAI-compatible endpoint
 *   - Enter API keys — each key calls secret:set exactly once; the value is
 *     never stored in the settings object or sent to settings:set
 *   - Set the primary meeting language
 *
 * UX: Phase 0.4 refactored provider selection from SegmentedControl to role-card
 * pattern with grouped select. Each provider role (Audio, Notulen) shows only the
 * selected provider's config panel (progressive disclosure), ready to scale to many
 * providers without overwhelming the page.
 *
 * Per ADR 0003: disclosure copy (buildDisclosureCopy) is shown at the point
 * of choice whenever a cloud provider is selected.
 *
 * Principle #9/#10: renderer is UI only. Keys travel to main via secret:set
 * and are never retrieved back in plaintext — there is no secret:get channel.
 */

import React, { useEffect, useState } from 'react'

import { extractionPresets } from '../../../shared/providers'
import { buildDisclosureCopy, computeEgressState } from '../../../shared/settings/egressState'
import { DEFAULT_SETTINGS, type AppSettings } from '../../../shared/settings/settingsSchema'
import { AudioAsrCard } from '../components/AudioAsrCard'
import { AzureExtractionCard } from '../components/AzureExtractionCard'
import { LocalExtractionCard, LOCAL_KEY_REF } from '../components/LocalExtractionCard'
import { OpenAICompatibleCard } from '../components/OpenAICompatibleCard'
import { ProviderKeyCard } from '../components/ProviderKeyCard'
import { ProviderRoleCard, type ProviderGroup } from '../components/ProviderRoleCard'
import { t } from '../i18n'

import {
  isValidUrl,
  type AudioAsrFields,
  type AudioAsrProvider,
  type AzureFields,
  type CustomFields,
  type LocalFields,
} from './settingsValidation'
import { useSecretKeyField } from './useSecretKeyField'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Empty Azure extraction form (used until a config is persisted). */
const AZURE_DEFAULT_FIELDS: AzureFields = {
  endpoint: '',
  deployment: '',
  apiVersion: '2024-12-01-preview',
  model: '',
  displayName: 'Azure OpenAI',
  keyRef: 'azure',
}

/** Seed values for the Azure card: the persisted config when present, else defaults. */
function azureInitialFields(settings: AppSettings): AzureFields {
  if (settings.extractionProvider !== 'azure-openai') return AZURE_DEFAULT_FIELDS
  const c = settings.azureOpenAI
  return {
    endpoint: c.endpoint,
    deployment: c.deployment,
    apiVersion: c.apiVersion,
    model: c.model,
    displayName: c.displayName,
    keyRef: c.keyRef,
  }
}

/** Empty OpenAI-compatible extraction form (used until a config is persisted). */
const CUSTOM_DEFAULT_FIELDS: CustomFields = {
  baseUrl: '',
  model: '',
  displayName: '',
  keyRef: 'openai-custom',
}

/** Seed values for the OpenAI-compatible card: the persisted config, else defaults. */
function customInitialFields(settings: AppSettings): CustomFields {
  if (settings.extractionProvider !== 'openai-compatible') return CUSTOM_DEFAULT_FIELDS
  const c = settings.openaiCompatible
  return { baseUrl: c.baseUrl, model: c.model, displayName: c.displayName, keyRef: c.keyRef }
}

/** Empty local extraction form (used until a config is persisted). */
const LOCAL_DEFAULT_FIELDS: LocalFields = {
  preset: 'local-custom',
  baseUrl: 'http://localhost:1234/v1',
  model: '',
}

/** Seed values for the local card: the persisted config, else defaults. */
function localInitialFields(settings: AppSettings): LocalFields {
  if (settings.extractionProvider !== 'local') return LOCAL_DEFAULT_FIELDS
  const c = settings.local
  return { preset: c.preset, baseUrl: c.baseUrl, model: c.model }
}

/** Default model id per cloud audio vendor (user-overridable). */
const AUDIO_DEFAULTS: Record<
  'openai-audio' | 'mistral-voxtral' | 'azure-speech',
  { model: string; keyRef: string; displayName: string }
> = {
  'openai-audio': { model: 'gpt-4o-mini-transcribe', keyRef: 'openai', displayName: 'OpenAI' },
  'mistral-voxtral': { model: 'voxtral-mini-2507', keyRef: 'mistral', displayName: 'Mistral' },
  'azure-speech': { model: 'whisper', keyRef: 'azure', displayName: 'Azure Speech' },
}

/** The AppSettings config-block key for a simple (non-Azure) audio provider. */
function keyForProvider(
  provider: 'openai-audio' | 'mistral-voxtral',
): 'openaiAudio' | 'mistralVoxtral' {
  return provider === 'openai-audio' ? 'openaiAudio' : 'mistralVoxtral'
}

/** Seed values for the audio card: the persisted config when it matches, else vendor defaults. */
function audioInitialFields(settings: AppSettings, provider: AudioAsrProvider): AudioAsrFields {
  const d = AUDIO_DEFAULTS[provider]
  const base: AudioAsrFields = {
    model: d.model,
    endpoint: '',
    deployment: '',
    apiVersion: '2024-06-01',
    keyRef: d.keyRef,
    displayName: d.displayName,
  }
  if (provider === 'openai-audio' && settings.asrProvider === 'openai-audio') {
    const c = settings.openaiAudio
    return { ...base, model: c.model, keyRef: c.keyRef, displayName: c.displayName }
  }
  if (provider === 'mistral-voxtral' && settings.asrProvider === 'mistral-voxtral') {
    const c = settings.mistralVoxtral
    return { ...base, model: c.model, keyRef: c.keyRef, displayName: c.displayName }
  }
  if (provider === 'azure-speech' && settings.asrProvider === 'azure-speech') {
    const c = settings.azureSpeech
    return {
      model: c.model,
      endpoint: c.endpoint,
      deployment: c.deployment,
      apiVersion: c.apiVersion ?? base.apiVersion,
      keyRef: c.keyRef,
      displayName: c.displayName,
    }
  }
  return base
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsScreen(): React.JSX.Element {
  // ---- settings state ----
  const [settings, setSettings] = useState<AppSettings | null>(null)

  // ---- local model state ----
  const [modelDownloaded, setModelDownloaded] = useState(false)
  const [modelProgress, setModelProgress] = useState<{ received: number; total: number } | null>(
    null,
  )
  const [modelError, setModelError] = useState<string | null>(null)

  // ---- per-vendor secret keys (entry / save / editing / present lifecycle) ----
  const deepgramKey = useSecretKeyField()
  const anthropicKey = useSecretKeyField()
  const customKey = useSecretKeyField()
  const azureKey = useSecretKeyField()
  const audioKey = useSecretKeyField()
  const localKey = useSecretKeyField()

  // ---- OpenAI-compatible extraction — form state lives in OpenAICompatibleCard.
  // Only the reveal-dirty flag stays here (true once the panel is revealed via a
  // preset/custom switch); the card re-seeds from settings on a preset switch.
  const [customInitiallyDirty, setCustomInitiallyDirty] = useState(false)

  // ---- Local extraction (ADR 0040) — form state lives in LocalExtractionCard.
  // Only the reveal-dirty flag stays here (true once revealed via the local switch).
  const [localInitiallyDirty, setLocalInitiallyDirty] = useState(false)

  // ---- Azure OpenAI (Phase 2.2) — form state lives in AzureExtractionCard ----
  // Only the reveal-dirty flag stays here: true once the user switches to Azure,
  // so the card mounts with Save enabled (vs a fresh load, which starts clean).
  const [azureInitiallyDirty, setAzureInitiallyDirty] = useState(false)

  // ---- cloud audio ASR (Phase 3.4) — form state lives in AudioAsrCard ----
  // Only the reveal-dirty flag stays here (true once switched to a cloud audio
  // provider, so the card mounts with Save enabled).
  const [audioInitiallyDirty, setAudioInitiallyDirty] = useState(false)

  // ---- load on mount ----
  useEffect(() => {
    void (async () => {
      let s: AppSettings
      try {
        s = await window.api.settingsGet()
      } catch (err) {
        // IPC failed (e.g. handler not ready). Fall back to defaults so the
        // screen renders and stays usable instead of hanging on "laden...".
        console.error('[Settings] settingsGet failed, using defaults:', err)
        s = DEFAULT_SETTINGS
      }
      setSettings(s)

      // OpenAI-compatible, Azure and cloud-audio form values are seeded by their
      // cards from settings itself; no separate mount seed needed.

      // Check key presence (never retrieves the value). Tolerate failure.
      // Keyed by ref name so shared keys (a vendor key serving ASR + extraction)
      // and the active audio provider all resolve from one lookup.
      try {
        const extractionKeyRef =
          s.extractionProvider === 'openai-compatible'
            ? s.openaiCompatible.keyRef
            : s.extractionProvider === 'azure-openai'
              ? s.azureOpenAI.keyRef
              : s.extractionProvider === 'local'
                ? s.local.keyRef
                : null
        const audioKeyRef =
          s.asrProvider === 'openai-audio'
            ? s.openaiAudio.keyRef
            : s.asrProvider === 'mistral-voxtral'
              ? s.mistralVoxtral.keyRef
              : s.asrProvider === 'azure-speech'
                ? s.azureSpeech.keyRef
                : null

        const refs = new Set<string>(['deepgram', 'anthropic'])
        if (extractionKeyRef !== null) refs.add(extractionKeyRef)
        if (audioKeyRef !== null) refs.add(audioKeyRef)

        const entries = await Promise.all(
          [...refs].map(async (key) => [key, (await window.api.secretHas({ key })).has] as const),
        )
        const present = new Map<string, boolean>(entries)

        deepgramKey.setPresent(present.get('deepgram') ?? false)
        anthropicKey.setPresent(present.get('anthropic') ?? false)
        if (extractionKeyRef !== null) {
          const has = present.get(extractionKeyRef) ?? false
          if (s.extractionProvider === 'openai-compatible') customKey.setPresent(has)
          else if (s.extractionProvider === 'azure-openai') azureKey.setPresent(has)
          else if (s.extractionProvider === 'local') localKey.setPresent(has)
        }
        if (audioKeyRef !== null) audioKey.setPresent(present.get(audioKeyRef) ?? false)
      } catch (err) {
        console.error('[Settings] secretHas failed:', err)
      }

      // Check local model status
      try {
        const status = await window.api.modelStatus({
          modelId: 'whisper-small-sherpa',
        })
        setModelDownloaded(status.downloaded)
      } catch (err) {
        console.error('[Settings] modelStatus failed:', err)
      }
    })()
    // Mount-once: load settings + probe key presence and model status a single
    // time. The useSecretKeyField `setPresent` setters are stable (raw useState
    // dispatchers), but exhaustive-deps sees them via the per-render key objects
    // (deepgramKey, …) and would demand those in the array — which would re-run
    // this probe on every render. It must run once, so the array stays empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Subscribe to model download progress events
  useEffect(() => {
    const unsub = window.api.onModelProgress((evt) => {
      if (evt.done) {
        setModelProgress(null)
        if (evt.error !== undefined) {
          setModelError(evt.error)
        } else {
          setModelDownloaded(true)
          setModelError(null)
        }
      } else {
        setModelProgress({ received: evt.bytesReceived, total: evt.bytesTotal })
      }
    })
    return unsub
  }, [])

  if (settings === null) {
    return (
      <main data-testid="screen-settings" className="screen screen--settings">
        <p className="placeholder-text">Instellingen laden...</p>
      </main>
    )
  }

  // ---- derived disclosure ----
  const egressState = computeEgressState(settings)
  const disclosure = buildDisclosureCopy(egressState)

  // ---- handlers ----

  async function persistSettings(next: AppSettings): Promise<void> {
    setSettings(next)
    try {
      await window.api.settingsSet(next)
    } catch (err) {
      console.error('[Settings] settingsSet failed:', err)
    }
  }

  type AsrSelectValue =
    'deepgram' | 'local-parakeet' | 'openai-audio' | 'mistral-voxtral' | 'azure-speech'

  function handleAsrChange(provider: AsrSelectValue): void {
    if (provider === 'deepgram' || provider === 'local-parakeet') {
      void persistSettings({
        ...settings,
        asrProvider: provider,
        openaiAudio: undefined,
        mistralVoxtral: undefined,
        azureSpeech: undefined,
      } as AppSettings)
      return
    }
    // Cloud audio: reveal the config panel (the card mounts with Save enabled via
    // initiallyDirty). Persist only on explicit Save (like the extraction cards),
    // so switching alone no longer writes settings.
    audioKey.resetSaveState()
    setAudioInitiallyDirty(true)
    setSettings(buildAudioSettings(provider, audioInitialFields(settings, provider)))
  }

  /** Build the AppSettings for a cloud audio provider from its fields. */
  function buildAudioSettings(provider: AudioAsrProvider, fields: AudioAsrFields): AppSettings {
    const base = {
      ...settings,
      deepgram: undefined,
      openaiAudio: undefined,
      mistralVoxtral: undefined,
      azureSpeech: undefined,
      primaryLanguage: settings.primaryLanguage,
    }
    const common = {
      model: fields.model.trim(),
      keyRef: fields.keyRef,
      displayName: fields.displayName.trim(),
      language: settings.primaryLanguage,
    }
    if (provider === 'azure-speech') {
      return {
        ...base,
        asrProvider: 'azure-speech',
        azureSpeech: {
          ...common,
          endpoint: fields.endpoint,
          deployment: fields.deployment.trim(),
          apiVersion: fields.apiVersion.trim(),
        },
      } as AppSettings
    }
    return { ...base, asrProvider: provider, [keyForProvider(provider)]: common } as AppSettings
  }

  /** Persist a validated cloud audio config emitted by AudioAsrCard. */
  async function persistAudio(provider: AudioAsrProvider, fields: AudioAsrFields): Promise<void> {
    await persistSettings(buildAudioSettings(provider, fields))
  }

  function handleExtractionChange(
    provider: 'anthropic' | 'openai' | 'mistral' | 'azure' | 'openai-compatible' | 'local',
  ): void {
    if (provider === 'anthropic') {
      void persistSettings({
        ...settings,
        extractionProvider: 'anthropic',
        openaiCompatible: undefined,
        azureOpenAI: undefined,
        local: undefined,
      } as AppSettings)
    } else if (provider === 'local') {
      // Reveal the local config panel (the card mounts with Save enabled via
      // initiallyDirty); persist only on explicit Save. Seed a default local
      // block so egress/key-presence can read it before the first save. The
      // displayName + keyRef are fixed here; the card edits only baseUrl + model.
      localKey.resetSaveState()
      setLocalInitiallyDirty(true)
      const init = localInitialFields(settings)
      setSettings({
        ...settings,
        extractionProvider: 'local',
        openaiCompatible: undefined,
        azureOpenAI: undefined,
        local: {
          preset: init.preset,
          baseUrl: init.baseUrl,
          model: init.model,
          keyRef: LOCAL_KEY_REF,
          displayName: 'Lokaal',
        },
      } as AppSettings)
    } else if (provider === 'openai' || provider === 'mistral') {
      // Prefill from the preset catalog and reveal the panel. The card remounts
      // (its key is the preset) and seeds from the openaiCompatible block below.
      const preset = extractionPresets[provider]
      setCustomInitiallyDirty(true)
      setSettings({
        ...settings,
        extractionProvider: 'openai-compatible',
        openaiCompatible: {
          preset: provider,
          baseUrl: preset.defaultBaseUrl,
          model: preset.defaultModel,
          displayName: preset.displayName,
          keyRef: provider, // keyRef is the vendor ID: 'openai', 'mistral'
        },
        azureOpenAI: undefined,
        local: undefined,
      } as AppSettings)
    } else if (provider === 'azure') {
      // Reveal the Azure config panel (the card mounts with Save enabled via
      // initiallyDirty); persist only on explicit save. Seed a default config
      // block so egress/shared-key can read it before the first save.
      setAzureInitiallyDirty(true)
      const init = azureInitialFields(settings)
      setSettings({
        ...settings,
        extractionProvider: 'azure-openai',
        openaiCompatible: undefined,
        local: undefined,
        azureOpenAI: {
          endpoint: init.endpoint,
          deployment: init.deployment,
          apiVersion: init.apiVersion,
          model: init.model,
          keyRef: init.keyRef,
          displayName: init.displayName,
        },
      } as AppSettings)
    } else {
      // 'openai-compatible' (custom). Reveal the panel seeded from the persisted
      // config (or empty defaults); the card owns the fields and persists on Save.
      const { baseUrl, model, displayName, keyRef } = customInitialFields(settings)
      const valid = isValidUrl(baseUrl) && model.trim().length > 0 && displayName.trim().length > 0
      setCustomInitiallyDirty(true)
      const next = {
        ...settings,
        extractionProvider: 'openai-compatible',
        openaiCompatible: { preset: 'custom' as const, baseUrl, model, keyRef, displayName },
        azureOpenAI: undefined,
        local: undefined,
      } as AppSettings
      if (valid) void persistSettings(next)
      else setSettings(next)
    }
  }

  function handleLanguageChange(lang: string): void {
    void persistSettings({ ...settings, primaryLanguage: lang })
  }

  /** Persist a validated OpenAI-compatible config emitted by OpenAICompatibleCard. */
  async function persistCustom(fields: CustomFields): Promise<void> {
    const { baseUrl, model, displayName, keyRef } = fields
    // Determine the preset from the keyRef (the vendor id for OpenAI/Mistral).
    const preset: 'openai' | 'mistral' | 'custom' =
      keyRef === 'openai' ? 'openai' : keyRef === 'mistral' ? 'mistral' : 'custom'

    await persistSettings({
      ...settings,
      extractionProvider: 'openai-compatible',
      openaiCompatible: {
        preset,
        baseUrl,
        model: model.trim(),
        keyRef,
        displayName: displayName.trim(),
      },
    })
  }

  /** Persist a validated local extraction config emitted by LocalExtractionCard. */
  async function persistLocal(fields: LocalFields): Promise<void> {
    await persistSettings({
      ...settings,
      extractionProvider: 'local',
      openaiCompatible: undefined,
      azureOpenAI: undefined,
      local: {
        preset: fields.preset,
        baseUrl: fields.baseUrl.trim(),
        model: fields.model.trim(),
        keyRef: LOCAL_KEY_REF,
        displayName: 'Lokaal',
      },
    } as AppSettings)
  }

  /** Persist a validated Azure config emitted by AzureExtractionCard. */
  async function persistAzure(fields: AzureFields): Promise<void> {
    const { endpoint, deployment, apiVersion, model, displayName, keyRef } = fields
    await persistSettings({
      ...settings,
      extractionProvider: 'azure-openai',
      openaiCompatible: undefined,
      azureOpenAI: {
        endpoint,
        deployment: deployment.trim(),
        apiVersion: apiVersion.trim(),
        model: model.trim(),
        keyRef,
        displayName: displayName.trim(),
      },
    } as AppSettings)
  }

  async function handleDownloadModel(): Promise<void> {
    setModelError(null)
    setModelProgress({ received: 0, total: 1 })
    try {
      await window.api.modelDownload({ modelId: 'whisper-small-sherpa' })
    } catch (err) {
      setModelProgress(null)
      setModelError(err instanceof Error ? err.message : String(err))
    }
  }

  const isCustomOpenAI = settings.extractionProvider === 'openai-compatible'
  const isAzure = settings.extractionProvider === 'azure-openai'
  const isLocalExtraction = settings.extractionProvider === 'local'
  const isLocalAsr = settings.asrProvider === 'local-parakeet'
  // Narrowed to the import-only cloud audio union (or null), so the config panel
  // can index AUDIO_DEFAULTS and call applyAudioProvider type-safely.
  const audioProvider: 'openai-audio' | 'mistral-voxtral' | 'azure-speech' | null =
    settings.asrProvider === 'openai-audio' ||
    settings.asrProvider === 'mistral-voxtral' ||
    settings.asrProvider === 'azure-speech'
      ? settings.asrProvider
      : null

  // Derive the extraction provider select value: if openai-compatible, use the preset;
  // azure-openai maps to the 'azure' option; otherwise use the provider.
  // Direct narrowing (not via the `isCustomOpenAI` boolean) so TypeScript propagates the discriminant.
  const extractionProviderSelectValue =
    settings.extractionProvider === 'openai-compatible'
      ? settings.openaiCompatible.preset
      : settings.extractionProvider === 'azure-openai'
        ? 'azure'
        : settings.extractionProvider

  // ---- render ----

  return (
    <main data-testid="screen-settings" className="screen screen--settings">
      <header className="screen__header">
        <h1 className="screen__title">{t('screen.settings.title')}</h1>
        <p className="screen__subtitle">{t('screen.settings.subtitle')}</p>
      </header>

      <section className="screen__body settings-body">
        {/* ----------------------------------------------------------------
            ASR provider (Audio role card with grouped select)
        ---------------------------------------------------------------- */}
        <ProviderRoleCard
          roleTitle={t('settings.asr.heading')}
          groups={
            [
              {
                label: t('settings.asr.group.device'),
                options: [
                  {
                    value: 'local-parakeet',
                    label: t('settings.asr.mode.local'),
                    sublabel: t('settings.asr.mode.local.sub'),
                  },
                ],
              },
              {
                label: t('settings.asr.group.cloud'),
                options: [
                  {
                    value: 'deepgram',
                    label: t('settings.asr.mode.cloud'),
                    sublabel: t('settings.asr.mode.cloud.sub'),
                  },
                  {
                    value: 'openai-audio',
                    label: t('settings.asr.mode.openai'),
                    sublabel: t('settings.asr.mode.openai.sub'),
                  },
                  {
                    value: 'mistral-voxtral',
                    label: t('settings.asr.mode.mistral'),
                    sublabel: t('settings.asr.mode.mistral.sub'),
                  },
                  {
                    value: 'azure-speech',
                    label: t('settings.asr.mode.azure'),
                    sublabel: t('settings.asr.mode.azure.sub'),
                  },
                ],
              },
            ] as ProviderGroup[]
          }
          selectedValue={settings.asrProvider}
          onChange={(v) => {
            handleAsrChange(v as AsrSelectValue)
          }}
          configPanel={
            isLocalAsr ? (
              <>
                {/* Local model card */}
                {!modelDownloaded && (
                  <div className="settings-model-card" data-testid="model-download-section">
                    <div className="settings-model-card__info">
                      <span className="settings-model-card__name">
                        {t('settings.asr.model.name')}
                      </span>
                      <span className="settings-model-card__meta">
                        {t('settings.asr.model.size')} · {t('settings.asr.model.notDownloaded')}
                      </span>
                    </div>
                    {modelProgress === null ? (
                      <button
                        type="button"
                        className="btn btn--primary"
                        data-testid="download-model-btn"
                        onClick={() => {
                          void handleDownloadModel()
                        }}
                      >
                        {t('settings.asr.model.download')}
                      </button>
                    ) : (
                      <div className="settings-model-progress" data-testid="model-progress">
                        <progress
                          value={modelProgress.received}
                          max={modelProgress.total}
                          aria-label={t('settings.asr.model.downloading')}
                        />
                        <span>
                          {modelProgress.total > 0
                            ? `${String(Math.round((modelProgress.received / modelProgress.total) * 100))}%`
                            : '0%'}
                        </span>
                      </div>
                    )}
                    {modelError !== null && (
                      <p className="form-error" role="alert">
                        {modelError}
                      </p>
                    )}
                  </div>
                )}

                {/* Local model installed */}
                {modelDownloaded && (
                  <div
                    className="settings-model-card settings-model-card--installed"
                    data-testid="model-installed-section"
                  >
                    <div className="settings-model-card__info">
                      <span className="settings-model-card__name">
                        {t('settings.asr.model.name')}
                      </span>
                      <span className="settings-model-card__meta">
                        {t('settings.asr.model.size')}
                      </span>
                    </div>
                    <span className="settings-model-card__badge">
                      {t('settings.asr.model.installed')}
                    </span>
                  </div>
                )}
              </>
            ) : audioProvider !== null ? (
              /* Cloud audio (OpenAI / Mistral / Azure Speech) — form owned by
                 AudioAsrCard, remounted per provider. */
              <AudioAsrCard
                key={audioProvider}
                keyField={audioKey}
                settings={settings}
                provider={audioProvider}
                initialFields={audioInitialFields(settings, audioProvider)}
                modelPlaceholder={AUDIO_DEFAULTS[audioProvider].model}
                initiallyDirty={audioInitiallyDirty}
                onSave={persistAudio}
              />
            ) : (
              /* Deepgram key entry */
              <ProviderKeyCard
                keyField={deepgramKey}
                keyRef="deepgram"
                role="asr"
                label={t('settings.asr.key.label')}
                placeholder={t('settings.asr.key.placeholder')}
                missingText={t('settings.asr.key.missing')}
              />
            )
          }
          disclosure={
            <p data-testid="asr-disclosure" className="settings-disclosure">
              <span className="settings-disclosure__label">
                {t('settings.disclosure.audio.label')}
              </span>{' '}
              {disclosure.audioDisclosure}
            </p>
          }
          testId="asr-provider-select"
        />

        {/* ----------------------------------------------------------------
            Extraction provider (Notulen role card with grouped select)
        ---------------------------------------------------------------- */}
        <ProviderRoleCard
          roleTitle={t('settings.extraction.heading')}
          groups={
            [
              {
                label: t('settings.extraction.group.cloud'),
                options: [
                  {
                    value: 'anthropic',
                    label: t('settings.extraction.mode.anthropic'),
                    sublabel: t('settings.extraction.mode.anthropic.sub'),
                  },
                  {
                    value: 'openai',
                    label: t('settings.extraction.mode.openai'),
                    sublabel: t('settings.extraction.mode.openai.sub'),
                  },
                  {
                    value: 'mistral',
                    label: t('settings.extraction.mode.mistral'),
                    sublabel: t('settings.extraction.mode.mistral.sub'),
                  },
                  {
                    value: 'azure',
                    label: t('settings.extraction.mode.azure'),
                    sublabel: t('settings.extraction.mode.azure.sub'),
                  },
                  {
                    value: 'openai-compatible',
                    label: t('settings.extraction.mode.custom'),
                    sublabel: t('settings.extraction.mode.custom.sub'),
                  },
                ],
              },
              {
                label: t('settings.extraction.group.device'),
                options: [
                  {
                    value: 'local',
                    label: t('settings.extraction.mode.local'),
                    sublabel: t('settings.extraction.mode.local.sub'),
                  },
                ],
              },
            ] as ProviderGroup[]
          }
          selectedValue={extractionProviderSelectValue}
          onChange={(v) => {
            handleExtractionChange(
              v as 'anthropic' | 'openai' | 'mistral' | 'azure' | 'openai-compatible' | 'local',
            )
          }}
          configPanel={
            isAzure ? (
              <AzureExtractionCard
                keyField={azureKey}
                settings={settings}
                initialFields={azureInitialFields(settings)}
                initiallyDirty={azureInitiallyDirty}
                onSave={persistAzure}
              />
            ) : isLocalExtraction ? (
              <LocalExtractionCard
                keyField={localKey}
                initialFields={localInitialFields(settings)}
                initiallyDirty={localInitiallyDirty}
                onSave={persistLocal}
              />
            ) : !isCustomOpenAI ? (
              /* Anthropic key entry */
              <ProviderKeyCard
                keyField={anthropicKey}
                keyRef="anthropic"
                role="extraction"
                label={t('settings.extraction.anthropic.key.label')}
                placeholder={t('settings.extraction.anthropic.key.placeholder')}
                missingText={t('settings.extraction.anthropic.key.missing')}
              />
            ) : (
              /* Custom OpenAI fields — form owned by OpenAICompatibleCard. A
                 preset switch changes the keyRef, remounting the card so it
                 re-seeds from the new preset. */
              <OpenAICompatibleCard
                key={customInitialFields(settings).keyRef}
                keyField={customKey}
                settings={settings}
                initialFields={customInitialFields(settings)}
                initiallyDirty={customInitiallyDirty}
                onSave={persistCustom}
              />
            )
          }
          disclosure={
            <p data-testid="extraction-disclosure" className="settings-disclosure">
              <span className="settings-disclosure__label">
                {t('settings.disclosure.notes.label')}
              </span>{' '}
              {disclosure.notesDisclosure}
            </p>
          }
          testId="extraction-provider-select"
        />

        {/* ----------------------------------------------------------------
            Primary language
        ---------------------------------------------------------------- */}
        <div className="settings-section">
          <h2 className="settings-section__heading">{t('settings.language.heading')}</h2>

          <select
            className="settings-language-select"
            value={settings.primaryLanguage}
            onChange={(e) => {
              handleLanguageChange(e.currentTarget.value)
            }}
            data-testid="language-select"
          >
            <option value="nl">{t('draft.language.nl')}</option>
            <option value="en">{t('draft.language.en')}</option>
          </select>
        </div>
      </section>
    </main>
  )
}
