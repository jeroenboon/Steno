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
