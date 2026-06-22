/**
 * SegmentedControl — a labelled pill toggle for two or more mutually exclusive
 * options (e.g. Lokaal / Cloud).
 *
 * Implemented as a native radiogroup: the radios are visually hidden and the
 * labels are styled as segments. This keeps it keyboard-first (arrow keys move
 * between segments, Space selects — rule #15) and screen-reader friendly, with
 * no custom key handling to maintain.
 */

import React from 'react'

export interface SegmentedOption {
  value: string
  label: string
  /** Optional second line shown under the label (e.g. the provider name). */
  sublabel?: string
}

export interface SegmentedControlProps {
  /** Radio group name — must be unique on the screen. */
  name: string
  /** Accessible label for the group. */
  ariaLabel: string
  /** Currently selected value. */
  value: string
  options: SegmentedOption[]
  onChange: (value: string) => void
  /** Optional test id on the group wrapper. */
  testId?: string
}

export function SegmentedControl({
  name,
  ariaLabel,
  value,
  options,
  onChange,
  testId,
}: SegmentedControlProps): React.JSX.Element {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel} data-testid={testId}>
      {options.map((opt) => {
        const checked = opt.value === value
        return (
          <label
            key={opt.value}
            className={`segmented__option${checked ? ' segmented__option--active' : ''}`}
          >
            <input
              type="radio"
              className="segmented__input"
              name={name}
              value={opt.value}
              checked={checked}
              data-testid={testId !== undefined ? `${testId}-${opt.value}` : undefined}
              onChange={() => {
                onChange(opt.value)
              }}
            />
            <span className="segmented__label">{opt.label}</span>
            {opt.sublabel !== undefined && (
              <span className="segmented__sublabel">{opt.sublabel}</span>
            )}
          </label>
        )
      })}
    </div>
  )
}
