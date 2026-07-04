/**
 * KeyField — a single write-only API-key entry with a saved/replace status.
 *
 * When no key is stored (or the user chose to replace one) it shows a password
 * input + save button; once a key is present it collapses to a "saved" badge
 * with a Replace affordance. Purely presentational: all state (value, saveState,
 * editing, present) is owned by the caller — in practice by `useSecretKeyField`.
 */

import React from 'react'

import { t } from '../i18n'
import type { KeySaveState } from '../screens/useSecretKeyField'

export interface KeyFieldProps {
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

export function KeyField(props: KeyFieldProps): React.JSX.Element {
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
        <div className="settings-key-row">
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
