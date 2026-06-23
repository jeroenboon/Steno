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
import { ProviderRoleCard, type ProviderGroup } from '../components/ProviderRoleCard'
import { t } from '../i18n'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type KeySaveState = 'idle' | 'saving' | 'saved' | 'error'

interface CustomFields {
  baseUrl: string
  model: string
  displayName: string
  keyRef: string
}

interface CustomValidationErrors {
  baseUrl?: string
  model?: string
  displayName?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidUrl(s: string): boolean {
  try {
    new URL(s)
    return true
  } catch {
    return false
  }
}

function validateCustomFields(fields: CustomFields): CustomValidationErrors {
  const errors: CustomValidationErrors = {}
  if (!isValidUrl(fields.baseUrl)) {
    errors.baseUrl = t('settings.validation.baseUrl')
  }
  if (fields.model.trim().length === 0) {
    errors.model = t('settings.validation.model')
  }
  if (fields.displayName.trim().length === 0) {
    errors.displayName = t('settings.validation.displayName')
  }
  return errors
}

// ---------------------------------------------------------------------------
// KeyField — a single API-key entry with a saved/replace status
// ---------------------------------------------------------------------------

interface KeyFieldProps {
  idBase: string
  label: string
  placeholder: string
  present: boolean
  editing: boolean
  value: string
  saveState: KeySaveState
  testIdInput: string
  testIdSave: string
  testIdMissing: string
  missingText: string
  onChange: (v: string) => void
  onSave: () => void
  onReplace: () => void
  onCancel: () => void
}

function KeyField(props: KeyFieldProps): React.JSX.Element {
  const showInput = !props.present || props.editing

  return (
    <div className="form-group">
      <label htmlFor={props.testIdInput} className="form-label">
        {props.label}
      </label>

      {!props.present && (
        <p data-testid={props.testIdMissing} className="settings-key-missing" role="alert">
          {props.missingText}
        </p>
      )}

      {props.present && !props.editing ? (
        <div className="settings-key-status" data-testid={`${props.idBase}-key-status`}>
          <span className="settings-key-status__badge">{t('settings.key.saved.status')}</span>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            data-testid={`replace-${props.idBase}-key`}
            onClick={props.onReplace}
          >
            {t('settings.key.replace')}
          </button>
        </div>
      ) : null}

      {showInput && (
        <div className="form-row">
          <input
            id={props.testIdInput}
            data-testid={props.testIdInput}
            type="password"
            className="form-input"
            placeholder={props.placeholder}
            value={props.value}
            autoComplete="off"
            onChange={(e) => {
              props.onChange(e.currentTarget.value)
            }}
          />
          <button
            type="button"
            data-testid={props.testIdSave}
            className="btn btn--secondary"
            disabled={props.saveState === 'saving' || props.value.trim().length === 0}
            onClick={props.onSave}
          >
            {props.saveState === 'saved' ? t('settings.asr.key.saved') : t('settings.asr.key.save')}
          </button>
          {props.present && (
            <button
              type="button"
              className="btn btn--secondary"
              data-testid={`cancel-${props.idBase}-key`}
              onClick={props.onCancel}
            >
              {t('settings.key.cancel')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsScreen(): React.JSX.Element {
  // ---- settings state ----
  const [settings, setSettings] = useState<AppSettings | null>(null)

  // ---- key presence ----
  const [deepgramKeyPresent, setDeepgramKeyPresent] = useState(false)
  const [anthropicKeyPresent, setAnthropicKeyPresent] = useState(false)

  // ---- local model state ----
  const [modelDownloaded, setModelDownloaded] = useState(false)
  const [modelProgress, setModelProgress] = useState<{ received: number; total: number } | null>(
    null,
  )
  const [modelError, setModelError] = useState<string | null>(null)

  // ---- key entry (password fields — cleared after save, never stored) ----
  const [deepgramKeyEntry, setDeepgramKeyEntry] = useState('')
  const [deepgramKeySave, setDeepgramKeySave] = useState<KeySaveState>('idle')
  const [deepgramKeyEditing, setDeepgramKeyEditing] = useState(false)

  const [anthropicKeyEntry, setAnthropicKeyEntry] = useState('')
  const [anthropicKeySave, setAnthropicKeySave] = useState<KeySaveState>('idle')
  const [anthropicKeyEditing, setAnthropicKeyEditing] = useState(false)

  const [customKeyEntry, setCustomKeyEntry] = useState('')
  const [customKeySave, setCustomKeySave] = useState<KeySaveState>('idle')
  const [customKeyPresent, setCustomKeyPresent] = useState(false)
  const [customKeyEditing, setCustomKeyEditing] = useState(false)

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

      // Check key presence (never retrieves the value). Tolerate failure.
      try {
        const keyChecks: Promise<{ has: boolean }>[] = [
          window.api.secretHas({ key: 'deepgram' }),
          window.api.secretHas({ key: 'anthropic' }),
        ]
        // Also check the custom/preset key if an openai-compatible provider is configured
        const customKeyRef =
          s.extractionProvider === 'openai-compatible' ? s.openaiCompatible.keyRef : null
        if (customKeyRef !== null) {
          keyChecks.push(window.api.secretHas({ key: customKeyRef }))
        }
        const results = await Promise.all(keyChecks)
        const dgResult = results[0]
        const antResult = results[1]
        const customResult = results[2]
        if (dgResult !== undefined) setDeepgramKeyPresent(dgResult.has)
        if (antResult !== undefined) setAnthropicKeyPresent(antResult.has)
        if (customResult !== undefined) setCustomKeyPresent(customResult.has)
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

  function handleAsrChange(provider: 'deepgram' | 'local-parakeet'): void {
    void persistSettings({ ...settings, asrProvider: provider })
  }

  function handleExtractionChange(
    provider: 'anthropic' | 'openai' | 'mistral' | 'openai-compatible',
  ): void {
    if (provider === 'anthropic') {
      void persistSettings({
        ...settings,
        extractionProvider: 'anthropic',
        openaiCompatible: undefined,
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
        } as AppSettings)
        return
      }
      void persistSettings({
        ...settings,
        extractionProvider: 'openai-compatible',
        openaiCompatible: { preset: 'custom', baseUrl, model, keyRef, displayName },
      })
    }
  }

  function handleLanguageChange(lang: string): void {
    void persistSettings({ ...settings, primaryLanguage: lang })
  }

  async function handleSaveDeepgramKey(): Promise<void> {
    if (deepgramKeyEntry.trim().length === 0) return
    setDeepgramKeySave('saving')
    try {
      await window.api.secretSet({ key: 'deepgram', value: deepgramKeyEntry })
      setDeepgramKeyPresent(true)
      setDeepgramKeyEntry('') // clear from UI immediately after save
      setDeepgramKeySave('saved')
      setDeepgramKeyEditing(false)
    } catch {
      setDeepgramKeySave('error')
    }
  }

  async function handleSaveAnthropicKey(): Promise<void> {
    if (anthropicKeyEntry.trim().length === 0) return
    setAnthropicKeySave('saving')
    try {
      await window.api.secretSet({ key: 'anthropic', value: anthropicKeyEntry })
      setAnthropicKeyPresent(true)
      setAnthropicKeyEntry('') // clear from UI immediately after save
      setAnthropicKeySave('saved')
      setAnthropicKeyEditing(false)
    } catch {
      setAnthropicKeySave('error')
    }
  }

  async function handleSaveCustomKey(): Promise<void> {
    if (customKeyEntry.trim().length === 0) return
    setCustomKeySave('saving')
    try {
      await window.api.secretSet({ key: customFields.keyRef, value: customKeyEntry })
      setCustomKeyPresent(true)
      setCustomKeyEntry('')
      setCustomKeySave('saved')
      setCustomKeyEditing(false)
    } catch {
      setCustomKeySave('error')
    }
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
  const isLocalAsr = settings.asrProvider === 'local-parakeet'

  // Derive the extraction provider select value: if openai-compatible, use the preset; otherwise use the provider.
  // Direct narrowing (not via the `isCustomOpenAI` boolean) so TypeScript propagates the discriminant.
  const extractionProviderSelectValue =
    settings.extractionProvider === 'openai-compatible'
      ? settings.openaiCompatible.preset
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
                ],
              },
            ] as ProviderGroup[]
          }
          selectedValue={settings.asrProvider}
          onChange={(v) => {
            handleAsrChange(v as 'deepgram' | 'local-parakeet')
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
            ) : (
              /* Deepgram key entry */
              <KeyField
                idBase="deepgram"
                label={t('settings.asr.key.label')}
                placeholder={t('settings.asr.key.placeholder')}
                present={deepgramKeyPresent}
                editing={deepgramKeyEditing}
                value={deepgramKeyEntry}
                saveState={deepgramKeySave}
                testIdInput="deepgram-key-input"
                testIdSave="save-deepgram-key"
                testIdMissing="deepgram-key-missing"
                missingText={t('settings.asr.key.missing')}
                onChange={(v) => {
                  setDeepgramKeyEntry(v)
                  if (deepgramKeySave === 'saved') setDeepgramKeySave('idle')
                }}
                onSave={() => {
                  void handleSaveDeepgramKey()
                }}
                onReplace={() => {
                  setDeepgramKeyEditing(true)
                }}
                onCancel={() => {
                  setDeepgramKeyEditing(false)
                  setDeepgramKeyEntry('')
                }}
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
            handleExtractionChange(v as 'anthropic' | 'openai' | 'mistral' | 'openai-compatible')
          }}
          configPanel={
            !isCustomOpenAI ? (
              /* Anthropic key entry */
              <KeyField
                idBase="anthropic"
                label={t('settings.extraction.anthropic.key.label')}
                placeholder={t('settings.extraction.anthropic.key.placeholder')}
                present={anthropicKeyPresent}
                editing={anthropicKeyEditing}
                value={anthropicKeyEntry}
                saveState={anthropicKeySave}
                testIdInput="anthropic-key-input"
                testIdSave="save-anthropic-key"
                testIdMissing="anthropic-key-missing"
                missingText={t('settings.extraction.anthropic.key.missing')}
                onChange={(v) => {
                  setAnthropicKeyEntry(v)
                  if (anthropicKeySave === 'saved') setAnthropicKeySave('idle')
                }}
                onSave={() => {
                  void handleSaveAnthropicKey()
                }}
                onReplace={() => {
                  setAnthropicKeyEditing(true)
                }}
                onCancel={() => {
                  setAnthropicKeyEditing(false)
                  setAnthropicKeyEntry('')
                }}
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
                  present={customKeyPresent}
                  editing={customKeyEditing}
                  value={customKeyEntry}
                  saveState={customKeySave}
                  testIdInput="custom-openai-key"
                  testIdSave="save-custom-key"
                  testIdMissing="custom-key-missing"
                  missingText={t('settings.custom.key.missing')}
                  onChange={(v) => {
                    setCustomKeyEntry(v)
                    if (customKeySave === 'saved') setCustomKeySave('idle')
                  }}
                  onSave={() => {
                    void handleSaveCustomKey()
                  }}
                  onReplace={() => {
                    setCustomKeyEditing(true)
                  }}
                  onCancel={() => {
                    setCustomKeyEditing(false)
                    setCustomKeyEntry('')
                  }}
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
