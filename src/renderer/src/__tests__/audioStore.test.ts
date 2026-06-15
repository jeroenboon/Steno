/**
 * Tests for the audio/mic permission state in the Zustand store (item 0015).
 *
 * Coverage:
 *   1. Initial mic permission state is 'unknown'.
 *   2. setMicPermission transitions to 'granted'.
 *   3. setMicPermission transitions to 'denied'.
 *   4. setTranscriptSpans replaces the span list.
 *   5. addTranscriptSpan appends a span.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { useAppStore } from '../store/appStore'

beforeEach(() => {
  useAppStore.setState({
    route: 'draft',
    activeMeeting: null,
    micPermission: 'unknown',
    transcriptSpans: [],
  })
})

describe('appStore — micPermission', () => {
  it('starts as "unknown"', () => {
    expect(useAppStore.getState().micPermission).toBe('unknown')
  })

  it('transitions to "granted"', () => {
    useAppStore.getState().setMicPermission('granted')
    expect(useAppStore.getState().micPermission).toBe('granted')
  })

  it('transitions to "denied"', () => {
    useAppStore.getState().setMicPermission('denied')
    expect(useAppStore.getState().micPermission).toBe('denied')
  })
})

describe('appStore — transcriptSpans', () => {
  it('starts empty', () => {
    expect(useAppStore.getState().transcriptSpans).toHaveLength(0)
  })

  it('addTranscriptSpan appends a span', () => {
    const span = {
      id: 'span-1',
      text: 'hallo',
      startMs: 0,
      endMs: 100,
      isFinal: true as const,
    }
    useAppStore.getState().addTranscriptSpan(span)
    const spans = useAppStore.getState().transcriptSpans
    expect(spans).toHaveLength(1)
    expect(spans[0]?.text).toBe('hallo')
  })

  it('addTranscriptSpan replaces an existing span with the same id (interim update)', () => {
    const interim = { id: 'span-1', text: 'hal', startMs: 0, endMs: 50, isFinal: false as const }
    const final = { id: 'span-1', text: 'hallo', startMs: 0, endMs: 100, isFinal: true as const }

    useAppStore.getState().addTranscriptSpan(interim)
    useAppStore.getState().addTranscriptSpan(final)

    const spans = useAppStore.getState().transcriptSpans
    expect(spans).toHaveLength(1)
    expect(spans[0]?.text).toBe('hallo')
    expect(spans[0]?.isFinal).toBe(true)
  })

  it('addTranscriptSpan appends when id is different', () => {
    useAppStore.getState().addTranscriptSpan({ id: 'a', text: 'een', startMs: 0, endMs: 50 })
    useAppStore.getState().addTranscriptSpan({ id: 'b', text: 'twee', startMs: 50, endMs: 100 })
    expect(useAppStore.getState().transcriptSpans).toHaveLength(2)
  })
})
