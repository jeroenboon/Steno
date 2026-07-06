/**
 * LocalExtractionCard — the config panel for the LOCAL extraction provider
 * (LM Studio, Ollama, llama.cpp, or any self-hosted OpenAI-compatible server).
 *
 * Same shape as OpenAICompatibleCard, minus the display name (fixed to "Lokaal"
 * by the parent) and with the API key framed as OPTIONAL: most local servers
 * need none, so a missing key is not an error (ADR 0040). The card owns its form
 * state (fields / per-field errors / save state / dirty), validates on Save, and
 * emits the validated base URL + model up via `onSave`. SettingsScreen owns the
 * AppSettings merge and settings:set, plus the key-presence probe.
 */

import React, { useState } from 'react'

import { localExtractionPresets, type LocalPreset } from '../../../shared/providers'
import { t } from '../i18n'
import {
  validateLocalFields,
  type LocalFields,
  type LocalValidationErrors,
} from '../screens/settingsValidation'
import type { KeySaveState, SecretKeyField } from '../screens/useSecretKeyField'

/** Runtime presets in display order (LM Studio first); label is the brand name. */
const LOCAL_PRESET_OPTIONS: readonly LocalPreset[] = [
  'lmstudio',
  'ollama',
  'llamacpp',
  'local-custom',
]

import { ConfigTextField } from './ConfigTextField'
import { KeyField } from './KeyField'
import { TestConnectionButton } from './TestConnectionButton'

/** The SecretStorage keyRef the local endpoint's optional key is stored under. */
export const LOCAL_KEY_REF = 'local'

export interface LocalExtractionCardProps {
  /** The caller's key lifecycle for this endpoint's (optional) key. */
  keyField: SecretKeyField
  /** Seed values for the form (from the persisted config, or empty defaults). */
  initialFields: LocalFields
  /** Start with Save enabled (true when just revealed via the local switch). */
  initiallyDirty: boolean
  /** Persist the validated config. The parent fixes displayName + keyRef + merges. */
  onSave: (fields: LocalFields) => Promise<void>
}

export function LocalExtractionCard(props: LocalExtractionCardProps): React.JSX.Element {
  const { keyField } = props
  const [fields, setFields] = useState<LocalFields>(props.initialFields)
  const [errors, setErrors] = useState<LocalValidationErrors>({})
  const [saveState, setSaveState] = useState<KeySaveState>('idle')
  const [dirty, setDirty] = useState(props.initiallyDirty)

  function editField(key: keyof LocalValidationErrors, value: string): void {
    setFields((f) => ({ ...f, [key]: value }))
    setErrors((err) => {
      const next = { ...err }
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete next[key]
      return next
    })
    setDirty(true)
    if (saveState === 'saved') setSaveState('idle')
  }

  /** Switch runtime preset: prefill base URL + model from the catalog. */
  function editPreset(preset: LocalPreset): void {
    const p = localExtractionPresets[preset]
    setFields({ preset, baseUrl: p.defaultBaseUrl, model: p.defaultModel })
    setErrors({})
    setDirty(true)
    if (saveState === 'saved') setSaveState('idle')
  }

  function presetLabel(preset: LocalPreset): string {
    return preset === 'local-custom'
      ? t('settings.local.preset.custom')
      : localExtractionPresets[preset].displayName
  }

  async function handleSave(): Promise<void> {
    const found = validateLocalFields(fields)
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setSaveState('saving')
    await props.onSave(fields)
    setSaveState('saved')
    setDirty(false)
  }

  return (
    <div className="settings-local-extraction">
      <div className="form-group">
        <label htmlFor="local-preset" className="form-label">
          {t('settings.local.preset.label')}
        </label>
        <select
          id="local-preset"
          data-testid="local-preset"
          className="form-input"
          value={fields.preset}
          onChange={(e) => {
            editPreset(e.currentTarget.value as LocalPreset)
          }}
        >
          {LOCAL_PRESET_OPTIONS.map((preset) => (
            <option key={preset} value={preset}>
              {presetLabel(preset)}
            </option>
          ))}
        </select>
      </div>

      <ConfigTextField
        testId="local-base-url"
        label={t('settings.local.baseUrl.label')}
        placeholder={t('settings.local.baseUrl.placeholder')}
        type="url"
        value={fields.baseUrl}
        error={errors.baseUrl}
        onChange={(v) => {
          editField('baseUrl', v)
        }}
      />
      <ConfigTextField
        testId="local-model"
        label={t('settings.local.model.label')}
        placeholder={t('settings.local.model.placeholder')}
        type="text"
        value={fields.model}
        error={errors.model}
        onChange={(v) => {
          editField('model', v)
        }}
      />

      <KeyField
        idBase="local"
        label={t('settings.local.key.label')}
        placeholder={t('settings.local.key.placeholder')}
        present={keyField.present}
        editing={keyField.editing}
        value={keyField.value}
        saveState={keyField.saveState}
        testIdInput="local-key"
        testIdSave="save-local-key"
        testIdMissing="local-key-missing"
        missingText={t('settings.local.key.optional')}
        onChange={keyField.change}
        onSave={() => {
          void keyField.save(LOCAL_KEY_REF)
        }}
        onReplace={keyField.beginReplace}
        onCancel={keyField.cancel}
      />

      <button
        type="button"
        data-testid="save-local"
        className="btn btn--primary"
        disabled={saveState === 'saving' || !dirty}
        onClick={() => {
          void handleSave()
        }}
      >
        {saveState === 'saved' ? t('settings.local.saved') : t('settings.local.save')}
      </button>

      <p className="settings-local-extraction__hint">{t('settings.local.hint')}</p>

      <TestConnectionButton role="extraction" testId="test-extraction-connection" />
    </div>
  )
}
