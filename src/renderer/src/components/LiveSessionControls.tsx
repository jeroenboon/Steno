/**
 * LiveSessionControls — the Live screen's capture controls (A1 split).
 *
 * The loopback capture-mode selector, the derived loopback status line, and the
 * mic-permission status with its audio-level meter. Store-connected for the
 * capture mode, loopback state and mic permission; the live `audioLevel` comes
 * from the useLiveSession hook in the orchestrator (not the store), so it is
 * passed in as the one prop.
 */

import React from 'react'

import { t } from '../i18n'
import { useAppStore } from '../store/appStore'

interface LiveSessionControlsProps {
  /** Live input level 0..~1 from useLiveSession; drives the meter width. */
  audioLevel: number
}

export function LiveSessionControls({ audioLevel }: LiveSessionControlsProps): React.JSX.Element {
  const captureMode = useAppStore((s) => s.captureMode)
  const loopbackState = useAppStore((s) => s.loopbackState)
  const micPermission = useAppStore((s) => s.micPermission)
  const setCaptureMode = useAppStore((s) => s.setCaptureMode)

  return (
    <div className="live-controls">
      <section className="screen__body screen__body--loopback-toggle">
        <label htmlFor="capture-mode-select" className="loopback-toggle__label">
          {t('live.loopback.toggle.label')}
        </label>
        <select
          id="capture-mode-select"
          data-testid="capture-mode-select"
          value={captureMode}
          onChange={(e) => {
            const value = e.target.value
            if (value === 'remote' || value === 'mic-only') {
              setCaptureMode(value)
            }
          }}
          disabled={micPermission !== 'unknown'}
          className="loopback-toggle__select"
        >
          <option value="remote">{t('live.loopback.mode.remote')}</option>
          <option value="mic-only">{t('live.loopback.mode.mic-only')}</option>
        </select>

        {loopbackState === 'denied' && (
          <p
            className="loopback-status loopback-status--denied"
            role="status"
            data-testid="loopback-denied-message"
          >
            {t('live.loopback.state.denied')}
          </p>
        )}
        {loopbackState === 'active' && (
          <p
            className="loopback-status loopback-status--active"
            role="status"
            data-testid="loopback-active-message"
          >
            {t('live.loopback.state.active')}
          </p>
        )}
        {loopbackState === 'off' && (
          <p
            className="loopback-status loopback-status--off"
            role="status"
            data-testid="loopback-off-message"
          >
            {t('live.loopback.state.off')}
          </p>
        )}
      </section>

      <section
        className="screen__body"
        data-testid="mic-status"
        data-mic-permission={micPermission}
      >
        {micPermission === 'denied' && (
          <p className="mic-denied-message" role="alert" data-testid="mic-denied-message">
            {t('live.mic.denied')}
          </p>
        )}
        {micPermission === 'unknown' && (
          <p className="mic-starting-message" data-testid="mic-starting-message">
            {t('live.mic.starting')}
          </p>
        )}
        {micPermission === 'granted' && (
          <div className="mic-active-row">
            <p className="mic-active-message" data-testid="mic-active-message">
              {t('live.mic.active')}
            </p>
            <div className="audio-level-meter" aria-hidden="true">
              <div
                className="audio-level-bar"
                style={{ width: String(Math.min(100, audioLevel * 400)) + '%' }}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
