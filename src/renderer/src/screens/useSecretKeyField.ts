/**
 * useSecretKeyField — the lifecycle of one write-only secret key in Settings.
 *
 * A secret key (Deepgram, Anthropic, or a per-vendor keyRef) is entered in a
 * password field, saved via the write-only `secret:set` IPC (ADR 0014 — the
 * renderer never reads a key back), and thereafter shown as a saved-status badge
 * with a "replace" affordance. Every vendor key in SettingsScreen shares that
 * exact lifecycle — entry / saveState / editing / present plus the save handler —
 * so it lives here once instead of five hand-copied clusters.
 *
 * The keyRef is passed to `save()` rather than baked in: some keys are fixed
 * ('deepgram', 'anthropic') and others come from the vendor config fields
 * (custom / Azure / audio), and the caller always knows the ref at save time.
 */

import { useCallback, useState } from 'react'

export type KeySaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface SecretKeyField {
  /** Current password-input value (never persisted in the clear). */
  value: string
  /** Where the save is in its lifecycle, for the save button label + badge. */
  saveState: KeySaveState
  /** Whether the input is revealed for editing (vs the saved-status badge). */
  editing: boolean
  /** Whether a key is already stored under this ref (from the secret:has probe). */
  present: boolean

  /** KeyField onChange: update the entry, clearing a lingering "saved" badge. */
  change: (value: string) => void
  /** KeyField onSave: persist the entry under `keyRef` via secret:set. */
  save: (keyRef: string) => Promise<void>
  /** KeyField onReplace: reveal the input over the saved-status badge. */
  beginReplace: () => void
  /** KeyField onCancel: hide the input and drop the entry. */
  cancel: () => void
  /** Seed presence from the mount-time secret:has probe. */
  setPresent: (present: boolean) => void
  /** Return the save state to idle (e.g. when switching provider). */
  resetSaveState: () => void
}

export function useSecretKeyField(): SecretKeyField {
  const [value, setValue] = useState('')
  const [saveState, setSaveState] = useState<KeySaveState>('idle')
  const [editing, setEditing] = useState(false)
  const [present, setPresent] = useState(false)

  const change = useCallback((next: string) => {
    setValue(next)
    // Typing after a save clears the transient "saved" badge.
    setSaveState((s) => (s === 'saved' ? 'idle' : s))
  }, [])

  const save = useCallback(
    async (keyRef: string) => {
      if (value.trim().length === 0) return
      setSaveState('saving')
      try {
        await window.api.secretSet({ key: keyRef, value })
        setPresent(true)
        setValue('') // clear from the UI immediately after save
        setSaveState('saved')
        setEditing(false)
      } catch {
        setSaveState('error')
      }
    },
    [value],
  )

  const beginReplace = useCallback(() => {
    setEditing(true)
  }, [])

  const cancel = useCallback(() => {
    setEditing(false)
    setValue('')
  }, [])

  const resetSaveState = useCallback(() => {
    setSaveState('idle')
  }, [])

  return {
    value,
    saveState,
    editing,
    present,
    change,
    save,
    beginReplace,
    cancel,
    setPresent,
    resetSaveState,
  }
}
