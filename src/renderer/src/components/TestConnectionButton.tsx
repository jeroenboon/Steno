/**
 * TestConnectionButton (Phase 5.1).
 *
 * A small affordance shown in each cloud provider's config panel. It runs one
 * provider:testConnection round-trip and renders the outcome in Dutch so the
 * user catches auth/URL mistakes at config time rather than mid-meeting.
 *
 * The key never reaches the renderer: main does the probe and returns only an
 * ok flag or a short error code, which this component maps to a friendly line.
 */

import React, { useState } from 'react'

import type { ProviderTestConnectionResponse } from '../../../shared/ipc'
import { t } from '../i18n'

interface TestConnectionButtonProps {
  /** Which configured provider role to probe. */
  role: 'asr' | 'extraction'
  /** Base test id; the result line uses `${testId}-result`. */
  testId: string
}

type Phase =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'done'; result: ProviderTestConnectionResponse }

/** Map a probe result to a human line + ok flag. Never echoes the key. */
function describeResult(result: ProviderTestConnectionResponse): { text: string; ok: boolean } {
  if (result.ok) return { ok: true, text: t('settings.test.ok') }
  switch (result.error) {
    case 'no-key':
      return { ok: false, text: t('settings.test.noKey') }
    case 'network':
      return { ok: false, text: t('settings.test.network') }
    case 'unavailable':
      return { ok: false, text: t('settings.test.unavailable') }
    default:
      // e.g. 'HTTP 401' — surface the status so the user can act on it.
      return { ok: false, text: `${t('settings.test.failed')} (${result.error})` }
  }
}

export function TestConnectionButton(props: TestConnectionButtonProps): React.JSX.Element {
  const [state, setState] = useState<Phase>({ phase: 'idle' })

  async function run(): Promise<void> {
    setState({ phase: 'testing' })
    try {
      const result = await window.api.providerTestConnection({ role: props.role })
      setState({ phase: 'done', result })
    } catch {
      setState({ phase: 'done', result: { ok: false, error: 'network' } })
    }
  }

  const message = state.phase === 'done' ? describeResult(state.result) : null

  return (
    <div className="settings-test-conn">
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        data-testid={props.testId}
        disabled={state.phase === 'testing'}
        onClick={() => {
          void run()
        }}
      >
        {state.phase === 'testing' ? t('settings.test.testing') : t('settings.test.button')}
      </button>
      {message !== null && (
        <p
          data-testid={`${props.testId}-result`}
          role="status"
          className={`settings-test-conn__result settings-test-conn__result--${message.ok ? 'ok' : 'error'}`}
        >
          {message.text}
        </p>
      )}
    </div>
  )
}
