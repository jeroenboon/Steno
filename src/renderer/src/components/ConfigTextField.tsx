/**
 * ConfigTextField — a labelled text/url input with an optional inline validation
 * error, for a provider config form field.
 *
 * The Azure / OpenAI-compatible / audio cards each carried a private copy of this
 * (label + error-styled input + error paragraph); this is the shared primitive.
 * Label and placeholder are passed already-resolved so the component stays free
 * of any i18n-key convention.
 */

import React from 'react'

export interface ConfigTextFieldProps {
  /** DOM id + data-testid for the input. */
  testId: string
  label: string
  placeholder: string
  type: 'text' | 'url'
  value: string
  /** Inline validation error; when set, the input is error-styled and shown. */
  error?: string | undefined
  onChange: (value: string) => void
}

export function ConfigTextField(props: ConfigTextFieldProps): React.JSX.Element {
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
