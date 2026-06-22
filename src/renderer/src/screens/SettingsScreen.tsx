/**
 * Settings screen (item 0016).
 *
 * Allows the user to:
 *   - Switch ASR between Lokaal (Whisper, on-device) and Cloud (Deepgram)
 *   - Switch extraction between Anthropic and a custom OpenAI-compatible endpoint
 *   - Enter API keys — each key calls secret:set exactly once; the value is
 *     never stored in the settings object or sent to settings:set
 *   - Set the primary meeting language
 *
 * UX: provider choices are segmented toggles (not dropdowns) so switching
 * between local and cloud is one click. A saved key shows a positive status
 * with a "Vervangen" affordance — the value itself never round-trips back
 * (secrets are write-only, ADR 0014), so we can only show that one exists.
 *
 * Per ADR 0003: disclosure copy (buildDisclosureCopy) is shown at the point
 * of choice whenever a cloud provider is selected.
 *
 * Principle #9/#10: renderer is UI only. Keys travel to main via secret:set
 * and are never retrieved back in plaintext — there is no secret:get channel.
 */

import React, { useEffect, useState } from 'react'

import { buildDisclosureCopy, computeEgressState } from '../../../shared/settings/egressState'
import { DEFAULT_SETTINGS, type AppSettings } from '../../../shared/settings/settingsSchema'
import { SegmentedControl } from '../components/SegmentedControl'
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

  // ---- custom OpenAI fields ----
  const [customFields, setCustomFields] = useState<CustomFields>({
    baseUrl: '',
    model: '',
    displayName: '',
    keyRef: 'custom-openai',
  })
  const [customErrors, setCustomErrors] = useState<CustomValidationErrors>({})

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

      if (s.extractionProvider === 'custom-openai') {
        setCustomFields({
          baseUrl: s.customOpenAI.baseUrl,
          model: s.customOpenAI.model,
          displayName: s.customOpenAI.displayName,
          keyRef: s.customOpenAI.keyRef,
        })
      }

      // Check key presence (never retrieves the value). Tolerate failure.
      try {
        const [dg, ant] = await Promise.all([
          window.api.secretHas({ key: 'deepgram' }),
          window.api.secretHas({ key: 'anthropic' }),
        ])
        setDeepgramKeyPresent(dg.has)
        setAnthropicKeyPresent(ant.has)
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
    await window.api.settingsSet(next)
  }

  function handleAsrChange(provider: 'deepgram' | 'local-parakeet'): void {
    void persistSettings({ ...settings, asrProvider: provider })
  }

  function handleExtractionChange(provider: 'anthropic' | 'custom-openai'): void {
    if (provider === 'anthropic') {
      void persistSettings({
        ...settings,
        extractionProvider: 'anthropic',
        customOpenAI: undefined,
      } as AppSettings)
    } else {
      const { baseUrl, model, displayName, keyRef } = customFields
      if (!isValidUrl(baseUrl) || model.trim().length === 0 || displayName.trim().length === 0) {
        // Switch to custom but don't persist until fields are valid
        setSettings({ ...settings, extractionProvider: 'custom-openai' } as AppSettings)
        return
      }
      void persistSettings({
        ...settings,
        extractionProvider: 'custom-openai',
        customOpenAI: { baseUrl, model, keyRef, displayName },
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
      setCustomKeyEntry('')
      setCustomKeySave('saved')
    } catch {
      setCustomKeySave('error')
    }
  }

  function handleSaveCustomOpenAI(): void {
    const errors = validateCustomFields(customFields)
    setCustomErrors(errors)
    if (Object.keys(errors).length > 0) return

    const { baseUrl, model, displayName, keyRef } = customFields
    void persistSettings({
      ...settings,
      extractionProvider: 'custom-openai',
      customOpenAI: { baseUrl, model: model.trim(), keyRef, displayName: displayName.trim() },
    })
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

  const isCustomOpenAI = settings.extractionProvider === 'custom-openai'
  const isLocalAsr = settings.asrProvider === 'local-parakeet'

  // ---- render ----

  return (
    <main data-testid="screen-settings" className="screen screen--settings">
      <header className="screen__header">
        <h1 className="screen__title">{t('screen.settings.title')}</h1>
        <p className="screen__subtitle">{t('screen.settings.subtitle')}</p>
      </header>

      <section className="screen__body settings-body">
        {/* ----------------------------------------------------------------
            ASR provider
        ---------------------------------------------------------------- */}
        <div className="settings-section">
          <h2 className="settings-section__heading">{t('settings.asr.heading')}</h2>

          <SegmentedControl
            name="asr-mode"
            testId="asr-mode"
            ariaLabel={t('settings.asr.heading')}
            value={settings.asrProvider}
            options={[
              {
                value: 'local-parakeet',
                label: t('settings.asr.mode.local'),
                sublabel: t('settings.asr.mode.local.sub'),
              },
              {
                value: 'deepgram',
                label: t('settings.asr.mode.cloud'),
                sublabel: t('settings.asr.mode.cloud.sub'),
              },
            ]}
            onChange={(v) => {
              handleAsrChange(v as 'deepgram' | 'local-parakeet')
            }}
          />

          {/* Disclosure copy for ASR */}
          <p data-testid="asr-disclosure" className="settings-disclosure">
            <span className="settings-disclosure__label">
              {t('settings.disclosure.audio.label')}
            </span>{' '}
            {disclosure.audioDisclosure}
          </p>

          {/* Local model card */}
          {isLocalAsr && !modelDownloaded && (
            <div className="settings-model-card" data-testid="model-download-section">
              <div className="settings-model-card__info">
                <span className="settings-model-card__name">{t('settings.asr.model.name')}</span>
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
          {isLocalAsr && modelDownloaded && (
            <div
              className="settings-model-card settings-model-card--installed"
              data-testid="model-installed-section"
            >
              <div className="settings-model-card__info">
                <span className="settings-model-card__name">{t('settings.asr.model.name')}</span>
                <span className="settings-model-card__meta">{t('settings.asr.model.size')}</span>
              </div>
              <span className="settings-model-card__badge">
                {t('settings.asr.model.installed')}
              </span>
            </div>
          )}

          {/* Deepgram key entry (cloud ASR) */}
          {!isLocalAsr && (
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
          )}
        </div>

        {/* ----------------------------------------------------------------
            Extraction provider
        ---------------------------------------------------------------- */}
        <div className="settings-section">
          <h2 className="settings-section__heading">{t('settings.extraction.heading')}</h2>

          <SegmentedControl
            name="extraction-mode"
            testId="extraction-mode"
            ariaLabel={t('settings.extraction.heading')}
            value={settings.extractionProvider}
            options={[
              {
                value: 'anthropic',
                label: t('settings.extraction.mode.anthropic'),
                sublabel: t('settings.extraction.mode.anthropic.sub'),
              },
              {
                value: 'custom-openai',
                label: t('settings.extraction.mode.custom'),
                sublabel: t('settings.extraction.mode.custom.sub'),
              },
            ]}
            onChange={(v) => {
              handleExtractionChange(v as 'anthropic' | 'custom-openai')
            }}
          />

          {/* Disclosure copy for extraction */}
          <p data-testid="extraction-disclosure" className="settings-disclosure">
            <span className="settings-disclosure__label">
              {t('settings.disclosure.notes.label')}
            </span>{' '}
            {disclosure.notesDisclosure}
          </p>

          {/* Anthropic key entry */}
          {!isCustomOpenAI && (
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
          )}

          {/* Custom OpenAI fields */}
          {isCustomOpenAI && (
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
                    setCustomFields((f) => ({ ...f, baseUrl: e.currentTarget.value }))
                    setCustomErrors((err) => ({ ...err, baseUrl: undefined }))
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
                    setCustomFields((f) => ({ ...f, model: e.currentTarget.value }))
                    setCustomErrors((err) => ({ ...err, model: undefined }))
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
                    setCustomFields((f) => ({ ...f, displayName: e.currentTarget.value }))
                    setCustomErrors((err) => ({ ...err, displayName: undefined }))
                  }}
                />
                {customErrors.displayName !== undefined && (
                  <p className="form-error">{customErrors.displayName}</p>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="custom-openai-key" className="form-label">
                  {t('settings.custom.key.label')}
                </label>
                <div className="form-row">
                  <input
                    id="custom-openai-key"
                    data-testid="custom-openai-key"
                    type="password"
                    className="form-input"
                    placeholder={t('settings.custom.key.placeholder')}
                    value={customKeyEntry}
                    autoComplete="off"
                    onChange={(e) => {
                      setCustomKeyEntry(e.currentTarget.value)
                      if (customKeySave === 'saved') setCustomKeySave('idle')
                    }}
                  />
                  <button
                    type="button"
                    data-testid="save-custom-key"
                    className="btn btn--secondary"
                    disabled={customKeySave === 'saving' || customKeyEntry.trim().length === 0}
                    onClick={() => {
                      void handleSaveCustomKey()
                    }}
                  >
                    {customKeySave === 'saved'
                      ? t('settings.custom.key.saved')
                      : t('settings.custom.key.save')}
                  </button>
                </div>
              </div>

              <button
                type="button"
                data-testid="save-custom-openai"
                className="btn btn--primary"
                onClick={handleSaveCustomOpenAI}
              >
                {t('settings.custom.save')}
              </button>
            </div>
          )}
        </div>

        {/* ----------------------------------------------------------------
            Primary language
        ---------------------------------------------------------------- */}
        <div className="settings-section">
          <h2 className="settings-section__heading">{t('settings.language.heading')}</h2>

          <SegmentedControl
            name="language-mode"
            testId="language-mode"
            ariaLabel={t('draft.language.label')}
            value={settings.primaryLanguage}
            options={[
              { value: 'nl', label: t('draft.language.nl') },
              { value: 'en', label: t('draft.language.en') },
            ]}
            onChange={(v) => {
              handleLanguageChange(v)
            }}
          />
        </div>
      </section>
    </main>
  )
}
