/**
 * Settings screen (item 0016).
 *
 * Allows the user to:
 *   - Choose the ASR provider (Deepgram preset; local-parakeet shown but disabled)
 *   - Choose the extraction provider (Anthropic preset or custom OpenAI-compatible)
 *   - Enter API keys — each key calls secret:set exactly once; the value is
 *     never stored in the settings object or sent to settings:set
 *   - Set the primary meeting language
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

  const [anthropicKeyEntry, setAnthropicKeyEntry] = useState('')
  const [anthropicKeySave, setAnthropicKeySave] = useState<KeySaveState>('idle')

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

          <div className="form-group">
            <label htmlFor="asr-provider-select" className="form-label">
              Provider
            </label>
            <select
              id="asr-provider-select"
              data-testid="asr-provider-select"
              className="form-select"
              value={settings.asrProvider}
              onChange={(e) => {
                handleAsrChange(e.currentTarget.value as 'deepgram' | 'local-parakeet')
              }}
            >
              <option value="deepgram">{t('settings.asr.deepgram.label')}</option>
              <option value="local-parakeet">{t('settings.asr.parakeet.label')}</option>
            </select>
          </div>

          {/* Disclosure copy for ASR */}
          <p data-testid="asr-disclosure" className="settings-disclosure">
            <span className="settings-disclosure__label">
              {t('settings.disclosure.audio.label')}
            </span>{' '}
            {disclosure.audioDisclosure}
          </p>

          {/* Local model download */}
          {settings.asrProvider === 'local-parakeet' && !modelDownloaded && (
            <div className="settings-model-download" data-testid="model-download-section">
              <p className="settings-model-info">{t('settings.asr.parakeet.notDownloaded')}</p>
              {modelProgress === null ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  data-testid="download-model-btn"
                  onClick={() => {
                    void handleDownloadModel()
                  }}
                >
                  {t('settings.asr.parakeet.download')} (~2 GB)
                </button>
              ) : (
                <div className="settings-model-progress" data-testid="model-progress">
                  <progress
                    value={modelProgress.received}
                    max={modelProgress.total}
                    aria-label={t('settings.asr.parakeet.downloading')}
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

          {/* Local model installed indicator */}
          {settings.asrProvider === 'local-parakeet' && modelDownloaded && (
            <div data-testid="model-installed-section">
              <p className="settings-model-info">{t('settings.asr.parakeet.installed')}</p>
            </div>
          )}

          {/* Deepgram key entry */}
          {settings.asrProvider === 'deepgram' && (
            <div className="form-group">
              <label htmlFor="deepgram-key-input" className="form-label">
                {t('settings.asr.key.label')}
              </label>
              {!deepgramKeyPresent && (
                <p data-testid="deepgram-key-missing" className="settings-key-missing" role="alert">
                  {t('settings.asr.key.missing')}
                </p>
              )}
              <div className="form-row">
                <input
                  id="deepgram-key-input"
                  data-testid="deepgram-key-input"
                  type="password"
                  className="form-input"
                  placeholder={t('settings.asr.key.placeholder')}
                  value={deepgramKeyEntry}
                  autoComplete="off"
                  onChange={(e) => {
                    setDeepgramKeyEntry(e.currentTarget.value)
                    if (deepgramKeySave === 'saved') setDeepgramKeySave('idle')
                  }}
                />
                <button
                  type="button"
                  data-testid="save-deepgram-key"
                  className="btn btn--secondary"
                  disabled={deepgramKeySave === 'saving' || deepgramKeyEntry.trim().length === 0}
                  onClick={() => {
                    void handleSaveDeepgramKey()
                  }}
                >
                  {deepgramKeySave === 'saved'
                    ? t('settings.asr.key.saved')
                    : t('settings.asr.key.save')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ----------------------------------------------------------------
            Extraction provider
        ---------------------------------------------------------------- */}
        <div className="settings-section">
          <h2 className="settings-section__heading">{t('settings.extraction.heading')}</h2>

          <div className="form-group">
            <label htmlFor="extraction-provider-select" className="form-label">
              Provider
            </label>
            <select
              id="extraction-provider-select"
              data-testid="extraction-provider-select"
              className="form-select"
              value={settings.extractionProvider}
              onChange={(e) => {
                handleExtractionChange(e.currentTarget.value as 'anthropic' | 'custom-openai')
              }}
            >
              <option value="anthropic">{t('settings.extraction.anthropic.label')}</option>
              <option value="custom-openai">{t('settings.extraction.custom.label')}</option>
            </select>
          </div>

          {/* Disclosure copy for extraction */}
          <p data-testid="extraction-disclosure" className="settings-disclosure">
            <span className="settings-disclosure__label">
              {t('settings.disclosure.notes.label')}
            </span>{' '}
            {disclosure.notesDisclosure}
          </p>

          {/* Anthropic key entry */}
          {!isCustomOpenAI && (
            <div className="form-group">
              <label htmlFor="anthropic-key-input" className="form-label">
                {t('settings.extraction.anthropic.key.label')}
              </label>
              {!anthropicKeyPresent && (
                <p
                  data-testid="anthropic-key-missing"
                  className="settings-key-missing"
                  role="alert"
                >
                  {t('settings.extraction.anthropic.key.missing')}
                </p>
              )}
              <div className="form-row">
                <input
                  id="anthropic-key-input"
                  data-testid="anthropic-key-input"
                  type="password"
                  className="form-input"
                  placeholder={t('settings.extraction.anthropic.key.placeholder')}
                  value={anthropicKeyEntry}
                  autoComplete="off"
                  onChange={(e) => {
                    setAnthropicKeyEntry(e.currentTarget.value)
                    if (anthropicKeySave === 'saved') setAnthropicKeySave('idle')
                  }}
                />
                <button
                  type="button"
                  data-testid="save-anthropic-key"
                  className="btn btn--secondary"
                  disabled={anthropicKeySave === 'saving' || anthropicKeyEntry.trim().length === 0}
                  onClick={() => {
                    void handleSaveAnthropicKey()
                  }}
                >
                  {anthropicKeySave === 'saved'
                    ? t('settings.extraction.anthropic.key.saved')
                    : t('settings.extraction.anthropic.key.save')}
                </button>
              </div>
            </div>
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
                      ? t('settings.custom.key.save')
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

          <div className="form-group">
            <label htmlFor="primary-language-select" className="form-label">
              {t('draft.language.label')}
            </label>
            <select
              id="primary-language-select"
              data-testid="primary-language-select"
              className="form-select"
              value={settings.primaryLanguage}
              onChange={(e) => {
                handleLanguageChange(e.currentTarget.value)
              }}
            >
              <option value="nl">{t('draft.language.nl')}</option>
              <option value="en">{t('draft.language.en')}</option>
            </select>
          </div>
        </div>
      </section>
    </main>
  )
}
