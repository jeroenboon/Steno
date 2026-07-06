/**
 * Pure field validation for the config-carrying provider forms (custom OpenAI,
 * Azure OpenAI). Extracted from SettingsScreen so the per-vendor config cards can
 * share it and it can be unit-tested without rendering the whole screen.
 *
 * Each validator returns a map of field → localized error message; an empty map
 * means the config is valid. The shapes are the in-progress form values (all
 * strings), distinct from the persisted AppSettings config blocks.
 */

import { t } from '../i18n'

export interface CustomFields {
  baseUrl: string
  model: string
  displayName: string
  keyRef: string
}

export interface CustomValidationErrors {
  baseUrl?: string
  model?: string
  displayName?: string
}

export interface AzureFields {
  endpoint: string
  deployment: string
  apiVersion: string
  model: string
  displayName: string
  keyRef: string
}

export interface AzureValidationErrors {
  endpoint?: string
  deployment?: string
  apiVersion?: string
  model?: string
  displayName?: string
}

/** True when `s` parses as an absolute URL. */
export function isValidUrl(s: string): boolean {
  try {
    new URL(s)
    return true
  } catch {
    return false
  }
}

export function validateCustomFields(fields: CustomFields): CustomValidationErrors {
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

/**
 * Fields for the LOCAL extraction provider (ADR 0040). The user edits the base
 * URL and model; the API key is optional (many local servers need none) and is
 * handled by the key field, not validated here. `displayName` and `keyRef` are
 * fixed by the parent, so they are not part of the editable form.
 */
export interface LocalFields {
  baseUrl: string
  model: string
}

export interface LocalValidationErrors {
  baseUrl?: string
  model?: string
}

export function validateLocalFields(fields: LocalFields): LocalValidationErrors {
  const errors: LocalValidationErrors = {}
  if (!isValidUrl(fields.baseUrl)) {
    errors.baseUrl = t('settings.validation.baseUrl')
  }
  if (fields.model.trim().length === 0) {
    errors.model = t('settings.validation.model')
  }
  return errors
}

/**
 * Fields for the cloud audio ASR providers (Phase 3.4). One object serves the
 * active provider; only the relevant fields are shown (OpenAI/Mistral edit just
 * `model`, Azure Speech also edits endpoint/deployment/apiVersion). `keyRef` and
 * `displayName` come from the vendor defaults and are not user-edited here.
 */
export interface AudioAsrFields {
  model: string
  endpoint: string
  deployment: string
  apiVersion: string
  keyRef: string
  displayName: string
}

export interface AudioValidationErrors {
  model?: string
  endpoint?: string
  deployment?: string
}

export type AudioAsrProvider = 'openai-audio' | 'mistral-voxtral' | 'azure-speech'

/**
 * Validate the editable audio fields for the given provider. Mirrors the
 * validity rule the live-persist path used before the Save button: every
 * provider needs a model; Azure Speech additionally needs a valid endpoint URL
 * and a deployment. (apiVersion and displayName are never blank in practice.)
 */
export function validateAudioFields(
  provider: AudioAsrProvider,
  fields: AudioAsrFields,
): AudioValidationErrors {
  const errors: AudioValidationErrors = {}
  if (fields.model.trim().length === 0) {
    errors.model = t('settings.validation.model')
  }
  if (provider === 'azure-speech') {
    if (!isValidUrl(fields.endpoint)) {
      errors.endpoint = t('settings.validation.endpoint')
    }
    if (fields.deployment.trim().length === 0) {
      errors.deployment = t('settings.validation.deployment')
    }
  }
  return errors
}

export function validateAzureFields(fields: AzureFields): AzureValidationErrors {
  const errors: AzureValidationErrors = {}
  if (!isValidUrl(fields.endpoint)) {
    errors.endpoint = t('settings.validation.endpoint')
  }
  if (fields.deployment.trim().length === 0) {
    errors.deployment = t('settings.validation.deployment')
  }
  if (fields.apiVersion.trim().length === 0) {
    errors.apiVersion = t('settings.validation.apiVersion')
  }
  if (fields.model.trim().length === 0) {
    errors.model = t('settings.validation.model')
  }
  if (fields.displayName.trim().length === 0) {
    errors.displayName = t('settings.validation.displayName')
  }
  return errors
}
