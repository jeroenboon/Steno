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

import { EgressIndicator } from './components/EgressIndicator'
import { t } from './i18n'
import { DraftScreen } from './screens/DraftScreen'
import { LiveScreen } from './screens/LiveScreen'
import { ReviewScreen } from './screens/ReviewScreen'
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
// Screen registry
// ---------------------------------------------------------------------------

const SCREENS: Record<AppRoute, React.JSX.Element> = {
  draft: <DraftScreen />,
  live: <LiveScreen />,
  review: <ReviewScreen />,
}

// ---------------------------------------------------------------------------
// Navigation tabs
// ---------------------------------------------------------------------------

interface NavTab {
  route: AppRoute
  label: string
}

const NAV_TABS: NavTab[] = [
  { route: 'draft', label: t('nav.draft') },
  { route: 'live', label: t('nav.live') },
  { route: 'review', label: t('nav.review') },
]

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App(): React.JSX.Element {
  const route = useAppStore((s) => s.route)
  const setRoute = useAppStore((s) => s.setRoute)

  const [egressState, setEgressState] = useState<EgressState>(DEFAULT_EGRESS)

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

  const currentScreen = SCREENS[route]

  return (
    <div className="app-shell">
      {/* Persistent chrome: app name + nav + egress indicator */}
      <header className="app-chrome">
        <span className="app-chrome__name">{t('app.name')}</span>

        <nav className="app-nav" aria-label="Schermen">
          {NAV_TABS.map(({ route: tabRoute, label }) => (
            <button
              key={tabRoute}
              type="button"
              className={`app-nav__tab${route === tabRoute ? ' app-nav__tab--active' : ''}`}
              onClick={() => {
                setRoute(tabRoute)
              }}
              aria-current={route === tabRoute ? 'page' : undefined}
            >
              {label}
            </button>
          ))}
        </nav>

        <EgressIndicator egressState={egressState} />
      </header>

      {/* Screen content */}
      <div className="app-content">{currentScreen}</div>
    </div>
  )
}

export default App
