/**
 * App shell — item 0013.
 *
 * Responsibilities:
 *   - Subscribe to egress:state over IPC on mount; keep state fresh.
 *   - Render the persistent chrome (app name, nav tabs, EgressIndicator).
 *   - Route to Draft / Live / Review based on the Zustand store.
 *
 * Rules:
 *   - No Node APIs. All data via window.api (the typed preload bridge).
 *   - No direct ipcRenderer usage.
 */

import React, { useEffect, useState } from 'react'

import type { EgressState } from '@shared/ipc'
import { ItemsChangedPayloadSchema } from '@shared/ipc'

import { EgressIndicator } from './components/EgressIndicator'
import { Wordmark } from './components/Wordmark'
import { t } from './i18n'
import { onValidated } from './ipc/onValidated'
import { DraftScreen } from './screens/DraftScreen'
import { HomeScreen } from './screens/HomeScreen'
import { ImportScreen } from './screens/ImportScreen'
import { LiveScreen } from './screens/LiveScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { useAppStore, type AppRoute } from './store/appStore'

import './tokens.css'
import './app.css'

// ---------------------------------------------------------------------------
// Default egress state shown before the first IPC response arrives.
// Conservative: shows as local until the real state is known.
// ---------------------------------------------------------------------------

const DEFAULT_EGRESS: EgressState = {
  audio: 'local',
  notes: 'cloud:Anthropic',
}

// ---------------------------------------------------------------------------
// Screen registry (all screens except Live, which is persistently mounted)
// ---------------------------------------------------------------------------

const SCREENS: Partial<Record<AppRoute, React.JSX.Element>> = {
  home: <HomeScreen />,
  draft: <DraftScreen />,
  import: <ImportScreen />,
  review: <ReviewScreen />,
  settings: <SettingsScreen />,
}

// ---------------------------------------------------------------------------
// Navigation tabs
// ---------------------------------------------------------------------------

interface NavTab {
  route: AppRoute
  label: string
}

const NAV_TABS: NavTab[] = [
  { route: 'home', label: t('nav.home') },
  { route: 'draft', label: t('nav.draft') },
  { route: 'live', label: t('nav.live') },
  { route: 'review', label: t('nav.review') },
  { route: 'settings', label: t('nav.settings') },
]

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App(): React.JSX.Element {
  const route = useAppStore((s) => s.route)
  const setRoute = useAppStore((s) => s.setRoute)
  const liveMeetingId = useAppStore((s) => s.liveMeetingId)
  const reconcileItems = useAppStore((s) => s.reconcileItems)

  const [egressState, setEgressState] = useState<EgressState>(DEFAULT_EGRESS)
  const [keysConfigured, setKeysConfigured] = useState<boolean | null>(null)

  // Fetch egress state from main process on mount.
  // In production this could be an event subscription; for now a one-time
  // fetch is sufficient since egress state only changes via settings.
  useEffect(() => {
    window.api
      .egressState()
      .then((state) => {
        setEgressState(state)
      })
      .catch(() => {
        // Keep the default — conservative fallback, no crash.
      })
  }, [])

  // Check whether the API keys for the CURRENTLY SELECTED providers are present.
  // ASR and extraction need different keys; we only require the keys for the
  // providers actually chosen, so e.g. a Deepgram-only setup isn't blocked by a
  // missing Anthropic key. If not all selected providers are configured, the app
  // shows a banner directing the user to Settings.
  useEffect(() => {
    void (async () => {
      try {
        const settings = await window.api.settingsGet()
        const requiredKeys: string[] = []
        if (settings.asrProvider === 'deepgram') requiredKeys.push('deepgram')
        if (settings.extractionProvider === 'anthropic') requiredKeys.push('anthropic')
        if (settings.extractionProvider === 'openai-compatible') {
          requiredKeys.push(settings.openaiCompatible.keyRef)
        }
        const results = await Promise.all(requiredKeys.map((key) => window.api.secretHas({ key })))
        setKeysConfigured(results.every((r) => r.has))
      } catch {
        // If we can't check, assume not configured — show the banner.
        setKeysConfigured(false)
      }
    })()
  }, [])

  // Authoritative item reconciliation (ADR 0033). Main pushes the full item set
  // for a meeting after any mutation — an agent extraction turn OR a note-taker
  // IPC action (confirm / dismiss / edit / create). One app-level subscription
  // covers both Live and Review; reconcileItems self-guards by meetingId so a
  // stale event for another meeting is ignored. The renderer no longer applies
  // optimistic transitions.
  useEffect(() => {
    return onValidated(window.api.onItemsChanged, ItemsChangedPayloadSchema, (payload) => {
      reconcileItems(payload)
    })
  }, [reconcileItems])

  // A live recording session is in progress (not merely a meeting loaded for
  // Review) — this is what enables the Live tab, shows the live dot, and locks
  // the Draft tab.
  const isMeetingActive = liveMeetingId !== null

  return (
    <div className="app-shell">
      {/* Persistent chrome: app name + nav + egress indicator */}
      <header className="app-chrome">
        <Wordmark />

        <nav className="app-nav" aria-label="Schermen">
          {NAV_TABS.map(({ route: tabRoute, label }) => {
            // Live tab: only enabled when a meeting is active
            const isLiveTab = tabRoute === 'live'
            // Draft tab: disabled while a meeting is running
            const isDraftTab = tabRoute === 'draft'
            const isDisabled = (isLiveTab && !isMeetingActive) || (isDraftTab && isMeetingActive)

            return (
              <button
                key={tabRoute}
                type="button"
                data-testid={tabRoute === 'settings' ? 'nav-settings' : undefined}
                className={`app-nav__tab${route === tabRoute ? ' app-nav__tab--active' : ''}${isDisabled ? ' app-nav__tab--disabled' : ''}`}
                disabled={isDisabled}
                onClick={() => {
                  if (!isDisabled) setRoute(tabRoute)
                }}
                aria-current={route === tabRoute ? 'page' : undefined}
              >
                {label}
                {isLiveTab && isMeetingActive && (
                  <span className="nav-live-dot" data-testid="nav-live-dot" aria-hidden="true" />
                )}
              </button>
            )
          })}
        </nav>

        <EgressIndicator egressState={egressState} />
      </header>

      {/* No-key banner — shown once we know keys are missing */}
      {keysConfigured === false && route !== 'settings' && (
        <div data-testid="no-key-banner" className="no-key-banner" role="alert">
          <span className="no-key-banner__title">{t('nokey.banner.title')}</span>
          <span className="no-key-banner__body">{t('nokey.banner.body')}</span>
          <button
            type="button"
            className="btn btn--secondary no-key-banner__action"
            onClick={() => {
              setRoute('settings')
            }}
          >
            {t('nokey.banner.action')}
          </button>
        </div>
      )}

      {/* Screen content */}
      <div className="app-content">
        {/*
         * LiveScreen is mounted unconditionally (always in the DOM) so audio
         * capture keeps running while the user browses other tabs. Visibility is
         * toggled purely by the route via the `display` style below — the
         * component itself never unmounts. It must be hidden on every non-live
         * route (both layers are position:absolute/inset:0, so a visible
         * live-layer would render through the active screen). Because it is
         * mounted before any meeting exists, its audio-start effect keys off
         * `activeMeeting` to begin capture only once a meeting goes live (see
         * LiveScreen's useEffect dependency array).
         */}
        <div
          className="app-live-layer"
          style={{ display: route === 'live' ? undefined : 'none' }}
          aria-hidden={route !== 'live'}
        >
          <LiveScreen />
        </div>

        {route !== 'live' && SCREENS[route] != null && (
          <div className="app-screen-layer">{SCREENS[route]}</div>
        )}
      </div>
    </div>
  )
}

export default App
