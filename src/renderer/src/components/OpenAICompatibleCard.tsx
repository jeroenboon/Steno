/**
 * OpenAICompatibleCard — the config panel for the OpenAI-compatible extraction
 * provider (OpenAI, Mistral, or a custom endpoint).
 *
 * Same shape as AzureExtractionCard: owns its own form state (fields / per-field
 * errors / save state / dirty), validates on Save, and emits the validated
 * fields up via `onSave`. SettingsScreen owns the AppSettings merge (including
 * mapping keyRef → preset) + settings:set, and the key-presence probe.
 *
 * Entry is via a preset (OpenAI/Mistral prefill the fields) or the custom option;
 * the parent re-seeds by remounting with a fresh `key` on a preset switch, so the
 * card's `initialFields` reflect the chosen preset. `initiallyDirty` reproduces
 * the reveal-dirty Save gating.
 */

import React, { useState } from 'react'

import type { AppSettings } from '../../../shared/settings/settingsSchema'
import { t } from '../i18n'
import {
  validateCustomFields,
  type CustomFields,
  type CustomValidationErrors,
} from '../screens/settingsValidation'
import type { KeySaveState, SecretKeyField } from '../screens/useSecretKeyField'

import { KeyField } from './KeyField'
import { ProviderKeyHelp } from './ProviderKeyHelp'
import { SharedKeyNotice } from './SharedKeyNotice'
import { TestConnectionButton } from './TestConnectionButton'

export interface OpenAICompatibleCardProps {
  /** The caller's key lifecycle for this endpoint's key. */
  keyField: SecretKeyField
  /** Current AppSettings — for the shared-key notice. */
  settings: AppSettings
  /** Seed values for the form (from the persisted config, or a preset prefill). */
  initialFields: CustomFields
  /** Start with Save enabled (true when just revealed via a preset/custom switch). */
  initiallyDirty: boolean
  /** Persist the validated config. The parent maps keyRef → preset + merges. */
  onSave: (fields: CustomFields) => Promise<void>
}

/** A labelled text/url input with inline validation error, for one custom field. */
function CustomField(props: {
  field: keyof CustomValidationErrors
  testId: string
  type: 'text' | 'url'
  value: string
  error: string | undefined
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <div className="form-group">
      <label htmlFor={props.testId} className="form-label">
        {t(`settings.custom.${props.field}.label`)}
      </label>
      <input
        id={props.testId}
        data-testid={props.testId}
        type={props.type}
        className={`form-input${props.error !== undefined ? ' form-input--error' : ''}`}
        placeholder={t(`settings.custom.${props.field}.placeholder`)}
        value={props.value}
        onChange={(e) => {
          props.onChange(e.currentTarget.value)
        }}
      />
      {props.error !== undefined && <p className="form-error">{props.error}</p>}
    </div>
  )
}

export function OpenAICompatibleCard(props: OpenAICompatibleCardProps): React.JSX.Element {
  const { keyField } = props
  const [fields, setFields] = useState<CustomFields>(props.initialFields)
  const [errors, setErrors] = useState<CustomValidationErrors>({})
  const [saveState, setSaveState] = useState<KeySaveState>('idle')
  const [dirty, setDirty] = useState(props.initiallyDirty)

  function editField(key: keyof CustomValidationErrors, value: string): void {
    setFields((f) => ({ ...f, [key]: value }))
    setErrors((err) => {
      const next = { ...err }
      // Clear the edited field's error; the key is dynamic but always a valid one.
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete next[key]
      return next
    })
    setDirty(true)
    if (saveState === 'saved') setSaveState('idle')
  }

  async function handleSave(): Promise<void> {
    const found = validateCustomFields(fields)
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setSaveState('saving')
    await props.onSave(fields)
    setSaveState('saved')
    setDirty(false)
  }

  return (
    <div className="settings-custom-openai">
      <CustomField
        field="baseUrl"
        testId="custom-openai-base-url"
        type="url"
        value={fields.baseUrl}
        error={errors.baseUrl}
        onChange={(v) => {
          editField('baseUrl', v)
        }}
      />
      <CustomField
        field="model"
        testId="custom-openai-model"
        type="text"
        value={fields.model}
        error={errors.model}
        onChange={(v) => {
          editField('model', v)
        }}
      />
      <CustomField
        field="displayName"
        testId="custom-openai-display-name"
        type="text"
        value={fields.displayName}
        error={errors.displayName}
        onChange={(v) => {
          editField('displayName', v)
        }}
      />

      <KeyField
        idBase="custom-openai"
        label={t('settings.custom.key.label')}
        placeholder={t('settings.custom.key.placeholder')}
        present={keyField.present}
        editing={keyField.editing}
        value={keyField.value}
        saveState={keyField.saveState}
        testIdInput="custom-openai-key"
        testIdSave="save-custom-key"
        testIdMissing="custom-key-missing"
        missingText={t('settings.custom.key.missing')}
        onChange={keyField.change}
        onSave={() => {
          void keyField.save(fields.keyRef)
        }}
        onReplace={keyField.beginReplace}
        onCancel={keyField.cancel}
      />

      <button
        type="button"
        data-testid="save-custom-openai"
        className="btn btn--primary"
        disabled={saveState === 'saving' || !dirty}
        onClick={() => {
          void handleSave()
        }}
      >
        {saveState === 'saved' ? t('settings.custom.saved') : t('settings.custom.save')}
      </button>

      <ProviderKeyHelp keyRef={fields.keyRef} testId="custom-key-help" />

      <SharedKeyNotice
        settings={props.settings}
        keyRef={fields.keyRef}
        testId="shared-key-custom"
      />

      <TestConnectionButton role="extraction" testId="test-extraction-connection" />
    </div>
  )
}
