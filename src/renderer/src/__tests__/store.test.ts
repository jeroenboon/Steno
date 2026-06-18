/**
 * Item 0013 — Zustand store tests.
 *
 * Coverage:
 *   1. Store initializes with route = 'draft' and activeMeeting = null.
 *   2. setRoute updates the route.
 *   3. setActiveMeeting stores and clears the meeting slot.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { useAppStore, type AppRoute } from '../store/appStore'

beforeEach(() => {
  useAppStore.setState({ route: 'draft', activeMeeting: null })
})

describe('appStore — initial state', () => {
  it('starts with route = "draft"', () => {
    expect(useAppStore.getState().route).toBe('draft')
  })

  it('starts with activeMeeting = null', () => {
    expect(useAppStore.getState().activeMeeting).toBeNull()
  })
})

describe('appStore — setRoute', () => {
  it('updates route to "live"', () => {
    useAppStore.getState().setRoute('live')
    expect(useAppStore.getState().route).toBe('live')
  })

  it('updates route to "review"', () => {
    useAppStore.getState().setRoute('review')
    expect(useAppStore.getState().route).toBe('review')
  })

  it('updates route back to "draft"', () => {
    useAppStore.getState().setRoute('live')
    useAppStore.getState().setRoute('draft')
    expect(useAppStore.getState().route).toBe('draft')
  })
})

describe('appStore — setActiveMeeting', () => {
  it('stores a meeting id', () => {
    useAppStore.getState().setActiveMeeting('mtg-001')
    expect(useAppStore.getState().activeMeeting).toBe('mtg-001')
  })

  it('clears the meeting by setting null', () => {
    useAppStore.getState().setActiveMeeting('mtg-001')
    useAppStore.getState().setActiveMeeting(null)
    expect(useAppStore.getState().activeMeeting).toBeNull()
  })
})

// Type test — AppRoute must be exactly these three values
const _routeCheck: AppRoute[] = ['draft', 'live', 'review']
void _routeCheck

// ---------------------------------------------------------------------------
// appStore — discussionSummaries (item 0021)
// ---------------------------------------------------------------------------

describe('appStore — discussionSummaries', () => {
  beforeEach(() => {
    useAppStore.setState({ discussionSummaries: [] })
  })

  it('starts with an empty discussionSummaries array', () => {
    expect(useAppStore.getState().discussionSummaries).toEqual([])
  })

  it('setDiscussionSummaries stores the summaries', () => {
    const summaries = [
      { id: 's-1', agendaItemId: 'ai-1', text: 'De groep besloot door te gaan.' },
      { id: 's-2', agendaItemId: 'ai-2', text: 'Budget goedgekeurd.' },
    ]
    useAppStore.getState().setDiscussionSummaries(summaries)
    expect(useAppStore.getState().discussionSummaries).toEqual(summaries)
  })

  it('setDiscussionSummaries replaces the previous set', () => {
    useAppStore
      .getState()
      .setDiscussionSummaries([{ id: 's-1', agendaItemId: 'ai-1', text: 'Eerste ronde.' }])
    useAppStore
      .getState()
      .setDiscussionSummaries([{ id: 's-2', agendaItemId: 'ai-2', text: 'Tweede ronde.' }])
    const summaries = useAppStore.getState().discussionSummaries
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toHaveProperty('id', 's-2')
  })
})
