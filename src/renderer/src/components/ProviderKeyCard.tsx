/**
 * ProviderKeyCard — the key-entry block for a fixed-key provider (Deepgram ASR,
 * Anthropic extraction).
 *
 * Both providers configure with nothing but an API key, so their block is
 * identical: a KeyField, the provider-specific key help, and a Test Connection
 * button. This bundles the three, deriving the test-ids from `keyRef` + `role`.
 * The key lifecycle (value / save / present) is owned by the caller's
 * `useSecretKeyField` instance and passed in, so SettingsScreen keeps the single
 * mount-time presence probe.
 *
 * Providers that also carry config fields (custom OpenAI, Azure, cloud audio)
 * are not fixed-key and use KeyField directly; this card is only for the
 * key-only pair.
 */

import React from 'react'

import type { SecretKeyField } from '../screens/useSecretKeyField'

import { KeyField } from './KeyField'
import { ProviderKeyHelp } from './ProviderKeyHelp'
import { TestConnectionButton } from './TestConnectionButton'

export interface ProviderKeyCardProps {
  /** The caller's key lifecycle for this provider. */
  keyField: SecretKeyField
  /** Secret storage key name, also the DOM/test-id base (e.g. 'deepgram'). */
  keyRef: string
  /** Which provider role this key serves, for the Test Connection button. */
  role: 'asr' | 'extraction'
  label: string
  placeholder: string
  missingText: string
}

export function ProviderKeyCard(props: ProviderKeyCardProps): React.JSX.Element {
  const { keyField, keyRef, role } = props

  return (
    <>
      <KeyField
        idBase={keyRef}
        label={props.label}
        placeholder={props.placeholder}
        present={keyField.present}
        editing={keyField.editing}
        value={keyField.value}
        saveState={keyField.saveState}
        testIdInput={`${keyRef}-key-input`}
        testIdSave={`save-${keyRef}-key`}
        testIdMissing={`${keyRef}-key-missing`}
        missingText={props.missingText}
        onChange={keyField.change}
        onSave={() => {
          void keyField.save(keyRef)
        }}
        onReplace={keyField.beginReplace}
        onCancel={keyField.cancel}
      />

      <ProviderKeyHelp keyRef={keyRef} testId={`${keyRef}-key-help`} />

      <TestConnectionButton role={role} testId={`test-${role}-connection`} />
    </>
  )
}
