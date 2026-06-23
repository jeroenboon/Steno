/**
 * ProviderRoleCard — displays a provider role (e.g., Audio, Notulen) with:
 *   - Grouped select for provider options (most-private first)
 *   - Progressive disclosure: only selected provider's config shows
 *   - Point-of-choice disclosure copy
 *   - Shared key status indicator
 *
 * Used in Phase 0.4 to refactor SettingsScreen from SegmentedControl to
 * scalable role-card pattern supporting many providers without overwhelming the UI.
 */

import React from 'react'

export interface ProviderOption {
  value: string
  label: string
  sublabel?: string
}

export interface ProviderGroup {
  label: string
  options: ProviderOption[]
}

export interface ProviderRoleCardProps {
  /** Role title (e.g., "Audio", "Notulen") */
  roleTitle: string
  /** Provider groups, e.g. [{ label: "Op dit apparaat", options: [...] }, { label: "Cloud", options: [...] }] */
  groups: ProviderGroup[]
  /** Currently selected provider value */
  selectedValue: string
  /** Config panel for the selected provider (rendered only when provider is selected) */
  configPanel: React.ReactNode
  /** Disclosure copy to show when provider is selected */
  disclosure: React.ReactNode
  /** Whether a shared key is already set for this provider role */
  keyIsSet?: boolean
  /** Callback when provider selection changes */
  onChange: (value: string) => void
  /** Test ID for the select element */
  testId?: string
}

export function ProviderRoleCard({
  roleTitle,
  groups,
  selectedValue,
  configPanel,
  disclosure,
  keyIsSet = false,
  onChange,
  testId,
}: ProviderRoleCardProps): React.JSX.Element {
  return (
    <div className="provider-role-card">
      <h2 className="provider-role-card__title">{roleTitle}</h2>

      {/* Grouped select for provider selection */}
      <select
        className="provider-role-card__select"
        data-testid={testId}
        value={selectedValue}
        onChange={(e) => {
          onChange(e.currentTarget.value)
        }}
      >
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
                {opt.sublabel !== undefined ? ` — ${opt.sublabel}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {/* Key status indicator for cloud providers */}
      {keyIsSet && (
        <div
          className="provider-role-card__key-status"
          data-testid={testId ? `${testId}-key-set` : undefined}
        >
          <span className="provider-role-card__key-badge">Sleutel al ingesteld</span>
        </div>
      )}

      {/* Disclosure copy */}
      <div className="provider-role-card__disclosure">{disclosure}</div>

      {/* Config panel (progressive disclosure) */}
      {configPanel !== null && (
        <div
          className="provider-role-card__config"
          data-testid={testId ? `${testId}-config` : undefined}
        >
          {configPanel}
        </div>
      )}
    </div>
  )
}
