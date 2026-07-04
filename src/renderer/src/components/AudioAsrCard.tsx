/**
 * AudioAsrCard — the config panel for the cloud audio ASR providers (OpenAI
 * audio, Mistral Voxtral, Azure Speech).
 *
 * Aligned with the extraction cards (Azure / OpenAI-compatible): it owns its own
 * form state and persists only on an explicit Save, replacing the old
 * live-persist-on-every-keystroke behaviour. It validates on Save and emits the
 * validated fields up via `onSave(provider, fields)`; SettingsScreen owns the
 * AppSettings merge + settings:set and the key-presence probe.
 *
 * Only the editable fields live here: `model` for every provider, plus
 * endpoint / deployment / apiVersion for Azure Speech. `keyRef` and `displayName`
 * come from the vendor defaults (passed in via `initialFields`).
 */

import React, { useState } from 'react'

import type { AppSettings } from '../../../shared/settings/settingsSchema'
import { t } from '../i18n'
import {
  validateAudioFields,
  type AudioAsrFields,
  type AudioAsrProvider,
  type AudioValidationErrors,
} from '../screens/settingsValidation'
import type { KeySaveState, SecretKeyField } from '../screens/useSecretKeyField'

import { KeyField } from './KeyField'
import { ProviderKeyHelp } from './ProviderKeyHelp'
import { SharedKeyNotice } from './SharedKeyNotice'
import { TestConnectionButton } from './TestConnectionButton'

export interface AudioAsrCardProps {
  /** The caller's key lifecycle for this provider's key. */
  keyField: SecretKeyField
  /** Current AppSettings — for the shared-key notice. */
  settings: AppSettings
  /** Which cloud audio provider this panel configures. */
  provider: AudioAsrProvider
  /** Seed values for the form (persisted config or the vendor defaults). */
  initialFields: AudioAsrFields
  /** Placeholder for the model field (the vendor default model). */
  modelPlaceholder: string
  /** Start with Save enabled (true when just switched to this provider). */
  initiallyDirty: boolean
  /** Persist the validated config. The parent owns the AppSettings merge. */
  onSave: (provider: AudioAsrProvider, fields: AudioAsrFields) => Promise<void>
}

/** A labelled text/url input with an optional inline validation error. */
function Field(props: {
  testId: string
  label: string
  placeholder: string
  type: 'text' | 'url'
  value: string
  error?: string | undefined
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <div className="form-group">
      <label htmlFor={props.testId} className="form-label">
        {props.label}
      </label>
      <input
        id={props.testId}
        data-testid={props.testId}
        type={props.type}
        className={`form-input${props.error !== undefined ? ' form-input--error' : ''}`}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => {
          props.onChange(e.currentTarget.value)
        }}
      />
      {props.error !== undefined && <p className="form-error">{props.error}</p>}
    </div>
  )
}

export function AudioAsrCard(props: AudioAsrCardProps): React.JSX.Element {
  const { keyField, provider } = props
  const [fields, setFields] = useState<AudioAsrFields>(props.initialFields)
  const [errors, setErrors] = useState<AudioValidationErrors>({})
  const [saveState, setSaveState] = useState<KeySaveState>('idle')
  const [dirty, setDirty] = useState(props.initiallyDirty)

  function edit(key: keyof AudioAsrFields, value: string, errorKey?: keyof AudioValidationErrors) {
    setFields((f) => ({ ...f, [key]: value }))
    if (errorKey !== undefined) {
      setErrors((err) => {
        const next = { ...err }
        // Clear the edited field's error; the key is dynamic but always a valid one.
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete next[errorKey]
        return next
      })
    }
    setDirty(true)
    if (saveState === 'saved') setSaveState('idle')
  }

  async function handleSave(): Promise<void> {
    const found = validateAudioFields(provider, fields)
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setSaveState('saving')
    await props.onSave(provider, fields)
    setSaveState('saved')
    setDirty(false)
  }

  return (
    <div className="settings-audio-asr">
      {provider === 'azure-speech' && (
        <>
          <Field
            testId="azure-speech-endpoint"
            label={t('settings.asr.azure.endpoint.label')}
            placeholder={t('settings.asr.azure.endpoint.placeholder')}
            type="url"
            value={fields.endpoint}
            error={errors.endpoint}
            onChange={(v) => {
              edit('endpoint', v, 'endpoint')
            }}
          />
          <Field
            testId="azure-speech-deployment"
            label={t('settings.asr.azure.deployment.label')}
            placeholder={t('settings.asr.azure.deployment.placeholder')}
            type="text"
            value={fields.deployment}
            error={errors.deployment}
            onChange={(v) => {
              edit('deployment', v, 'deployment')
            }}
          />
          <Field
            testId="azure-speech-api-version"
            label={t('settings.asr.azure.apiVersion.label')}
            placeholder={t('settings.asr.azure.apiVersion.placeholder')}
            type="text"
            value={fields.apiVersion}
            onChange={(v) => {
              edit('apiVersion', v)
            }}
          />
        </>
      )}

      <Field
        testId="audio-model"
        label={t('settings.asr.audio.model.label')}
        placeholder={props.modelPlaceholder}
        type="text"
        value={fields.model}
        error={errors.model}
        onChange={(v) => {
          edit('model', v, 'model')
        }}
      />

      <KeyField
        idBase="audio"
        label={t('settings.asr.audio.key.label')}
        placeholder={t('settings.asr.audio.key.placeholder')}
        present={keyField.present}
        editing={keyField.editing}
        value={keyField.value}
        saveState={keyField.saveState}
        testIdInput="audio-key-input"
        testIdSave="save-audio-key"
        testIdMissing="audio-key-missing"
        missingText={t('settings.asr.audio.key.missing')}
        onChange={keyField.change}
        onSave={() => {
          void keyField.save(fields.keyRef)
        }}
        onReplace={keyField.beginReplace}
        onCancel={keyField.cancel}
      />

      <button
        type="button"
        data-testid="save-audio-config"
        className="btn btn--primary"
        disabled={saveState === 'saving' || !dirty}
        onClick={() => {
          void handleSave()
        }}
      >
        {saveState === 'saved' ? t('settings.asr.audio.saved') : t('settings.asr.audio.save')}
      </button>

      <ProviderKeyHelp keyRef={fields.keyRef} testId="audio-key-help" />

      <SharedKeyNotice settings={props.settings} keyRef={fields.keyRef} testId="shared-key-audio" />

      <TestConnectionButton role="asr" testId="test-asr-connection" />
    </div>
  )
}
