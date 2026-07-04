/**
 * AzureExtractionCard — the config panel for the Azure OpenAI extraction provider.
 *
 * Owns its own form state (fields / per-field errors / save state / dirty), so
 * SettingsScreen no longer carries them. It validates on Save and emits the
 * validated fields up via `onSave`; the parent owns the AppSettings merge +
 * settings:set (persistence stays in one place — ADR-free, item-3-review slice).
 *
 * The key lifecycle stays owned by the caller's `useSecretKeyField` (passed in),
 * so the single mount-time presence probe in SettingsScreen is unchanged.
 *
 * `initiallyDirty` reproduces the reveal-dirty behaviour: when the user has just
 * switched to Azure the Save button is enabled without an edit; on a fresh load
 * of an already-Azure meeting it starts disabled until a field changes.
 */

import React, { useState } from 'react'

import type { AppSettings } from '../../../shared/settings/settingsSchema'
import { t } from '../i18n'
import {
  validateAzureFields,
  type AzureFields,
  type AzureValidationErrors,
} from '../screens/settingsValidation'
import type { KeySaveState, SecretKeyField } from '../screens/useSecretKeyField'

import { KeyField } from './KeyField'
import { ProviderKeyHelp } from './ProviderKeyHelp'
import { SharedKeyNotice } from './SharedKeyNotice'
import { TestConnectionButton } from './TestConnectionButton'

export interface AzureExtractionCardProps {
  /** The caller's key lifecycle for the Azure key. */
  keyField: SecretKeyField
  /** Current AppSettings — for the shared-key notice. */
  settings: AppSettings
  /** Seed values for the form (from the persisted config, or defaults). */
  initialFields: AzureFields
  /** Start with Save enabled (true when the user just switched to Azure). */
  initiallyDirty: boolean
  /** Persist the validated config. The parent owns the AppSettings merge. */
  onSave: (fields: AzureFields) => Promise<void>
}

/** A labelled text/url input with inline validation error, for one Azure field. */
function AzureField(props: {
  field: keyof AzureValidationErrors
  testId: string
  type: 'text' | 'url'
  value: string
  error: string | undefined
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <div className="form-group">
      <label htmlFor={props.testId} className="form-label">
        {t(`settings.azure.${props.field}.label`)}
      </label>
      <input
        id={props.testId}
        data-testid={props.testId}
        type={props.type}
        className={`form-input${props.error !== undefined ? ' form-input--error' : ''}`}
        placeholder={t(`settings.azure.${props.field}.placeholder`)}
        value={props.value}
        onChange={(e) => {
          props.onChange(e.currentTarget.value)
        }}
      />
      {props.error !== undefined && <p className="form-error">{props.error}</p>}
    </div>
  )
}

export function AzureExtractionCard(props: AzureExtractionCardProps): React.JSX.Element {
  const { keyField } = props
  const [fields, setFields] = useState<AzureFields>(props.initialFields)
  const [errors, setErrors] = useState<AzureValidationErrors>({})
  const [saveState, setSaveState] = useState<KeySaveState>('idle')
  const [dirty, setDirty] = useState(props.initiallyDirty)

  function editField(key: keyof AzureValidationErrors, value: string): void {
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
    const found = validateAzureFields(fields)
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setSaveState('saving')
    await props.onSave(fields)
    setSaveState('saved')
    setDirty(false)
  }

  return (
    <div className="settings-azure-openai">
      <AzureField
        field="endpoint"
        testId="azure-openai-endpoint"
        type="url"
        value={fields.endpoint}
        error={errors.endpoint}
        onChange={(v) => {
          editField('endpoint', v)
        }}
      />
      <AzureField
        field="deployment"
        testId="azure-openai-deployment"
        type="text"
        value={fields.deployment}
        error={errors.deployment}
        onChange={(v) => {
          editField('deployment', v)
        }}
      />
      <AzureField
        field="apiVersion"
        testId="azure-openai-api-version"
        type="text"
        value={fields.apiVersion}
        error={errors.apiVersion}
        onChange={(v) => {
          editField('apiVersion', v)
        }}
      />
      <AzureField
        field="model"
        testId="azure-openai-model"
        type="text"
        value={fields.model}
        error={errors.model}
        onChange={(v) => {
          editField('model', v)
        }}
      />
      <AzureField
        field="displayName"
        testId="azure-openai-display-name"
        type="text"
        value={fields.displayName}
        error={errors.displayName}
        onChange={(v) => {
          editField('displayName', v)
        }}
      />

      <KeyField
        idBase="azure-openai"
        label={t('settings.azure.key.label')}
        placeholder={t('settings.azure.key.placeholder')}
        present={keyField.present}
        editing={keyField.editing}
        value={keyField.value}
        saveState={keyField.saveState}
        testIdInput="azure-openai-key"
        testIdSave="save-azure-key"
        testIdMissing="azure-key-missing"
        missingText={t('settings.azure.key.missing')}
        onChange={keyField.change}
        onSave={() => {
          void keyField.save(fields.keyRef)
        }}
        onReplace={keyField.beginReplace}
        onCancel={keyField.cancel}
      />

      <button
        type="button"
        data-testid="save-azure-openai"
        className="btn btn--primary"
        disabled={saveState === 'saving' || !dirty}
        onClick={() => {
          void handleSave()
        }}
      >
        {saveState === 'saved' ? t('settings.azure.saved') : t('settings.azure.save')}
      </button>

      <ProviderKeyHelp keyRef={fields.keyRef} testId="azure-key-help" />

      <SharedKeyNotice settings={props.settings} keyRef={fields.keyRef} testId="shared-key-azure" />

      <TestConnectionButton role="extraction" testId="test-extraction-connection" />
    </div>
  )
}
