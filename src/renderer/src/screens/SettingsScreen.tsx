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
import { AzureExtractionCard } from '../components/AzureExtractionCard'
import { KeyField } from '../components/KeyField'
import { ProviderKeyCard } from '../components/ProviderKeyCard'
import { ProviderKeyHelp } from '../components/ProviderKeyHelp'
import { ProviderRoleCard, type ProviderGroup } from '../components/ProviderRoleCard'
import { SharedKeyNotice } from '../components/SharedKeyNotice'
import { TestConnectionButton } from '../components/TestConnectionButton'
import { t } from '../i18n'

import {
  isValidUrl,
  validateCustomFields,
  type AzureFields,
  type CustomFields,
  type CustomValidationErrors,
} from './settingsValidation'
import { useSecretKeyField, type KeySaveState } from './useSecretKeyField'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Fields for the import-only cloud ASR providers (Phase 3.4). One object serves
 * the active audio provider; only the relevant fields are shown (OpenAI/Mistral
 * need just `model`, Azure Speech also needs endpoint/deployment/apiVersion).
 */
interface AudioAsrFields {
  model: string
  endpoint: string
  deployment: string
  apiVersion: string
  keyRef: string
  displayName: string
}

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

// ---------------------------------------------------------------------------
// TextField — a single labelled text input (config fields)
// ---------------------------------------------------------------------------

interface TextFieldProps {
  id: string
  label: string
  placeholder: string
  value: string
  type?: 'text' | 'url'
  onChange: (v: string) => void
}

function TextField(props: TextFieldProps): React.JSX.Element {
  return (
    <div className="form-group">
      <label htmlFor={props.id} className="form-label">
        {props.label}
      </label>
      <input
        id={props.id}
        data-testid={props.id}
        type={props.type ?? 'text'}
        className="form-input"
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => {
          props.onChange(e.currentTarget.value)
        }}
      />
    </div>
  )
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

  // ---- custom OpenAI fields ----
  const [customFields, setCustomFields] = useState<CustomFields>({
    baseUrl: '',
    model: '',
    displayName: '',
    keyRef: 'openai-custom',
  })
  const [customErrors, setCustomErrors] = useState<CustomValidationErrors>({})
  const [customOpenAISaveState, setCustomOpenAISaveState] = useState<KeySaveState>('idle')
  const [customDirty, setCustomDirty] = useState(false)

  // ---- Azure OpenAI (Phase 2.2) — form state lives in AzureExtractionCard ----
  // Only the reveal-dirty flag stays here: true once the user switches to Azure,
  // so the card mounts with Save enabled (vs a fresh load, which starts clean).
  const [azureInitiallyDirty, setAzureInitiallyDirty] = useState(false)

  // ---- import-only cloud ASR fields (Phase 3.4) ----
  const [audioFields, setAudioFields] = useState<AudioAsrFields>({
    model: '',
    endpoint: '',
    deployment: '',
    apiVersion: '2024-06-01',
    keyRef: '',
    displayName: '',
  })

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

      if (s.extractionProvider === 'openai-compatible') {
        setCustomFields({
          baseUrl: s.openaiCompatible.baseUrl,
          model: s.openaiCompatible.model,
          displayName: s.openaiCompatible.displayName,
          keyRef: s.openaiCompatible.keyRef,
        })
      }

      // Azure form values are seeded by AzureExtractionCard from settings itself.

      if (s.asrProvider === 'openai-audio') {
        setAudioFields((f) => ({
          ...f,
          model: s.openaiAudio.model,
          keyRef: s.openaiAudio.keyRef,
          displayName: s.openaiAudio.displayName,
        }))
      } else if (s.asrProvider === 'mistral-voxtral') {
        setAudioFields((f) => ({
          ...f,
          model: s.mistralVoxtral.model,
          keyRef: s.mistralVoxtral.keyRef,
          displayName: s.mistralVoxtral.displayName,
        }))
      } else if (s.asrProvider === 'azure-speech') {
        setAudioFields((f) => ({
          ...f,
          model: s.azureSpeech.model,
          endpoint: s.azureSpeech.endpoint,
          deployment: s.azureSpeech.deployment,
          apiVersion: s.azureSpeech.apiVersion ?? f.apiVersion,
          keyRef: s.azureSpeech.keyRef,
          displayName: s.azureSpeech.displayName,
        }))
      }

      // Check key presence (never retrieves the value). Tolerate failure.
      // Keyed by ref name so shared keys (a vendor key serving ASR + extraction)
      // and the active audio provider all resolve from one lookup.
      try {
        const extractionKeyRef =
          s.extractionProvider === 'openai-compatible'
            ? s.openaiCompatible.keyRef
            : s.extractionProvider === 'azure-openai'
              ? s.azureOpenAI.keyRef
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
    | 'deepgram'
    | 'local-parakeet'
    | 'openai-audio'
    | 'mistral-voxtral'
    | 'azure-speech'

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
    // Cloud audio (import-only): prefill defaults and reveal the config panel.
    const defaults = AUDIO_DEFAULTS[provider]
    const nextFields: AudioAsrFields = {
      model: defaults.model,
      endpoint: '',
      deployment: '',
      apiVersion: '2024-06-01',
      keyRef: defaults.keyRef,
      displayName: defaults.displayName,
    }
    setAudioFields(nextFields)
    audioKey.resetSaveState()
    applyAudioProvider(provider, nextFields)
  }

  /**
   * Build the AppSettings for an import-only audio provider from its fields,
   * update local state always (so the panel renders), and persist only when the
   * config is schema-valid (Azure needs a real endpoint before it validates).
   */
  function applyAudioProvider(
    provider: 'openai-audio' | 'mistral-voxtral' | 'azure-speech',
    fields: AudioAsrFields,
  ): void {
    const base = {
      ...settings,
      deepgram: undefined,
      openaiAudio: undefined,
      mistralVoxtral: undefined,
      azureSpeech: undefined,
      primaryLanguage: settings.primaryLanguage,
    }
    let next: AppSettings
    let valid: boolean
    const common = {
      model: fields.model.trim(),
      keyRef: fields.keyRef,
      displayName: fields.displayName.trim(),
      language: settings.primaryLanguage,
    }
    if (provider === 'azure-speech') {
      next = {
        ...base,
        asrProvider: 'azure-speech',
        azureSpeech: {
          ...common,
          endpoint: fields.endpoint,
          deployment: fields.deployment.trim(),
          apiVersion: fields.apiVersion.trim(),
        },
      } as AppSettings
      valid =
        isValidUrl(fields.endpoint) &&
        fields.deployment.trim().length > 0 &&
        common.model.length > 0 &&
        common.displayName.length > 0
    } else {
      next = { ...base, asrProvider: provider, [keyForProvider(provider)]: common } as AppSettings
      valid = common.model.length > 0 && common.displayName.length > 0
    }

    setSettings(next)
    if (valid) {
      void window.api.settingsSet(next).catch((err: unknown) => {
        console.error('[Settings] settingsSet failed:', err)
      })
    }
  }

  function handleExtractionChange(
    provider: 'anthropic' | 'openai' | 'mistral' | 'azure' | 'openai-compatible',
  ): void {
    if (provider === 'anthropic') {
      void persistSettings({
        ...settings,
        extractionProvider: 'anthropic',
        openaiCompatible: undefined,
        azureOpenAI: undefined,
      } as AppSettings)
    } else if (provider === 'openai' || provider === 'mistral') {
      // Prefill from preset catalog
      const preset = extractionPresets[provider]
      const newCustomFields: CustomFields = {
        baseUrl: preset.defaultBaseUrl,
        model: preset.defaultModel,
        displayName: preset.displayName,
        keyRef: provider, // keyRef is the vendor ID: 'openai', 'mistral'
      }
      setCustomFields(newCustomFields)
      setCustomDirty(true)
      setCustomOpenAISaveState('idle')
      // Update local state to show the form
      setSettings({
        ...settings,
        extractionProvider: 'openai-compatible',
        openaiCompatible: {
          preset: provider,
          ...newCustomFields,
        },
        azureOpenAI: undefined,
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
      // 'openai-compatible' (custom)
      const { baseUrl, model, displayName, keyRef } = customFields
      if (!isValidUrl(baseUrl) || model.trim().length === 0 || displayName.trim().length === 0) {
        // Show form so user can fill in fields; update local state but don't persist yet
        // Include placeholder config so initialization won't crash
        setCustomDirty(true)
        setCustomOpenAISaveState('idle')
        setSettings({
          ...settings,
          extractionProvider: 'openai-compatible',
          openaiCompatible: { preset: 'custom', baseUrl, model, keyRef, displayName },
          azureOpenAI: undefined,
        } as AppSettings)
        return
      }
      void persistSettings({
        ...settings,
        extractionProvider: 'openai-compatible',
        openaiCompatible: { preset: 'custom', baseUrl, model, keyRef, displayName },
        azureOpenAI: undefined,
      } as AppSettings)
    }
  }

  function handleLanguageChange(lang: string): void {
    void persistSettings({ ...settings, primaryLanguage: lang })
  }

  async function handleSaveCustomOpenAI(): Promise<void> {
    const errors = validateCustomFields(customFields)
    setCustomErrors(errors)
    if (Object.keys(errors).length > 0) return

    const { baseUrl, model, displayName, keyRef } = customFields
    // Determine preset based on keyRef or settings
    const preset: 'openai' | 'mistral' | 'custom' =
      keyRef === 'openai' ? 'openai' : keyRef === 'mistral' ? 'mistral' : 'custom'

    setCustomOpenAISaveState('saving')
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
    setCustomOpenAISaveState('saved')
    setCustomDirty(false)
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
  const isLocalAsr = settings.asrProvider === 'local-parakeet'
  // Narrowed to the import-only cloud audio union (or null), so the config panel
  // can index AUDIO_DEFAULTS and call applyAudioProvider type-safely.
  const audioProvider: 'openai-audio' | 'mistral-voxtral' | 'azure-speech' | null =
    settings.asrProvider === 'openai-audio' ||
    settings.asrProvider === 'mistral-voxtral' ||
    settings.asrProvider === 'azure-speech'
      ? settings.asrProvider
      : null
  const isAzureSpeech = settings.asrProvider === 'azure-speech'

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
              /* Cloud audio (OpenAI / Mistral / Azure Speech) — live + import */
              <div className="settings-audio-asr">
                {isAzureSpeech && (
                  <>
                    <TextField
                      id="azure-speech-endpoint"
                      label={t('settings.asr.azure.endpoint.label')}
                      placeholder={t('settings.asr.azure.endpoint.placeholder')}
                      type="url"
                      value={audioFields.endpoint}
                      onChange={(v) => {
                        const next = { ...audioFields, endpoint: v }
                        setAudioFields(next)
                        applyAudioProvider('azure-speech', next)
                      }}
                    />
                    <TextField
                      id="azure-speech-deployment"
                      label={t('settings.asr.azure.deployment.label')}
                      placeholder={t('settings.asr.azure.deployment.placeholder')}
                      value={audioFields.deployment}
                      onChange={(v) => {
                        const next = { ...audioFields, deployment: v }
                        setAudioFields(next)
                        applyAudioProvider('azure-speech', next)
                      }}
                    />
                    <TextField
                      id="azure-speech-api-version"
                      label={t('settings.asr.azure.apiVersion.label')}
                      placeholder={t('settings.asr.azure.apiVersion.placeholder')}
                      value={audioFields.apiVersion}
                      onChange={(v) => {
                        const next = { ...audioFields, apiVersion: v }
                        setAudioFields(next)
                        applyAudioProvider('azure-speech', next)
                      }}
                    />
                  </>
                )}

                <TextField
                  id="audio-model"
                  label={t('settings.asr.audio.model.label')}
                  placeholder={AUDIO_DEFAULTS[audioProvider].model}
                  value={audioFields.model}
                  onChange={(v) => {
                    const next = { ...audioFields, model: v }
                    setAudioFields(next)
                    applyAudioProvider(audioProvider, next)
                  }}
                />

                <KeyField
                  idBase="audio"
                  label={t('settings.asr.audio.key.label')}
                  placeholder={t('settings.asr.audio.key.placeholder')}
                  present={audioKey.present}
                  editing={audioKey.editing}
                  value={audioKey.value}
                  saveState={audioKey.saveState}
                  testIdInput="audio-key-input"
                  testIdSave="save-audio-key"
                  testIdMissing="audio-key-missing"
                  missingText={t('settings.asr.audio.key.missing')}
                  onChange={audioKey.change}
                  onSave={() => {
                    void audioKey.save(audioFields.keyRef)
                  }}
                  onReplace={audioKey.beginReplace}
                  onCancel={audioKey.cancel}
                />

                <ProviderKeyHelp keyRef={audioFields.keyRef} testId="audio-key-help" />

                <SharedKeyNotice
                  settings={settings}
                  keyRef={audioFields.keyRef}
                  testId="shared-key-audio"
                />

                <TestConnectionButton role="asr" testId="test-asr-connection" />
              </div>
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
            ] as ProviderGroup[]
          }
          selectedValue={extractionProviderSelectValue}
          onChange={(v) => {
            handleExtractionChange(
              v as 'anthropic' | 'openai' | 'mistral' | 'azure' | 'openai-compatible',
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
              /* Custom OpenAI fields */
              <div className="settings-custom-openai">
                <div className="form-group">
                  <label htmlFor="custom-openai-base-url" className="form-label">
                    {t('settings.custom.baseUrl.label')}
                  </label>
                  <input
                    id="custom-openai-base-url"
                    data-testid="custom-openai-base-url"
                    type="url"
                    className={`form-input${customErrors.baseUrl !== undefined ? ' form-input--error' : ''}`}
                    placeholder={t('settings.custom.baseUrl.placeholder')}
                    value={customFields.baseUrl}
                    onChange={(e) => {
                      const v = e.currentTarget.value
                      setCustomFields((f) => ({ ...f, baseUrl: v }))
                      setCustomErrors((err) => {
                        const next = { ...err }
                        delete next.baseUrl
                        return next
                      })
                      setCustomDirty(true)
                      if (customOpenAISaveState === 'saved') setCustomOpenAISaveState('idle')
                    }}
                  />
                  {customErrors.baseUrl !== undefined && (
                    <p className="form-error">{customErrors.baseUrl}</p>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="custom-openai-model" className="form-label">
                    {t('settings.custom.model.label')}
                  </label>
                  <input
                    id="custom-openai-model"
                    data-testid="custom-openai-model"
                    type="text"
                    className={`form-input${customErrors.model !== undefined ? ' form-input--error' : ''}`}
                    placeholder={t('settings.custom.model.placeholder')}
                    value={customFields.model}
                    onChange={(e) => {
                      const v = e.currentTarget.value
                      setCustomFields((f) => ({ ...f, model: v }))
                      setCustomErrors((err) => {
                        const next = { ...err }
                        delete next.model
                        return next
                      })
                      setCustomDirty(true)
                      if (customOpenAISaveState === 'saved') setCustomOpenAISaveState('idle')
                    }}
                  />
                  {customErrors.model !== undefined && (
                    <p className="form-error">{customErrors.model}</p>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="custom-openai-display-name" className="form-label">
                    {t('settings.custom.displayName.label')}
                  </label>
                  <input
                    id="custom-openai-display-name"
                    data-testid="custom-openai-display-name"
                    type="text"
                    className={`form-input${customErrors.displayName !== undefined ? ' form-input--error' : ''}`}
                    placeholder={t('settings.custom.displayName.placeholder')}
                    value={customFields.displayName}
                    onChange={(e) => {
                      const v = e.currentTarget.value
                      setCustomFields((f) => ({ ...f, displayName: v }))
                      setCustomErrors((err) => {
                        const next = { ...err }
                        delete next.displayName
                        return next
                      })
                      setCustomDirty(true)
                      if (customOpenAISaveState === 'saved') setCustomOpenAISaveState('idle')
                    }}
                  />
                  {customErrors.displayName !== undefined && (
                    <p className="form-error">{customErrors.displayName}</p>
                  )}
                </div>

                <KeyField
                  idBase="custom-openai"
                  label={t('settings.custom.key.label')}
                  placeholder={t('settings.custom.key.placeholder')}
                  present={customKey.present}
                  editing={customKey.editing}
                  value={customKey.value}
                  saveState={customKey.saveState}
                  testIdInput="custom-openai-key"
                  testIdSave="save-custom-key"
                  testIdMissing="custom-key-missing"
                  missingText={t('settings.custom.key.missing')}
                  onChange={customKey.change}
                  onSave={() => {
                    void customKey.save(customFields.keyRef)
                  }}
                  onReplace={customKey.beginReplace}
                  onCancel={customKey.cancel}
                />

                <button
                  type="button"
                  data-testid="save-custom-openai"
                  className="btn btn--primary"
                  disabled={customOpenAISaveState === 'saving' || !customDirty}
                  onClick={() => {
                    void handleSaveCustomOpenAI()
                  }}
                >
                  {customOpenAISaveState === 'saved'
                    ? t('settings.custom.saved')
                    : t('settings.custom.save')}
                </button>

                <ProviderKeyHelp keyRef={customFields.keyRef} testId="custom-key-help" />

                <SharedKeyNotice
                  settings={settings}
                  keyRef={customFields.keyRef}
                  testId="shared-key-custom"
                />

                <TestConnectionButton role="extraction" testId="test-extraction-connection" />
              </div>
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
