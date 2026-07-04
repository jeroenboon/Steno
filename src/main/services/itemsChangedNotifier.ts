/**
 * itemsChangedNotifier — the single place that emits the authoritative
 * `items:changed` event for a meeting.
 *
 * Main is the source of truth for item state (ADR 0033): after any mutation —
 * an agent extraction turn or a note-taker IPC action (confirm / dismiss / edit
 * / create) — the affected meeting's full current item set is pushed to the
 * renderer, which reconciles wholesale by state. Both the live runtime and the
 * IPC handler path wire the ItemLifecycleService `onItemsChanged` seam to this
 * helper, so there is one emit shape and one query.
 */

import type { ItemsChangedPayload } from '@shared/ipc'

import type { IpcSender } from '../audio/AudioCaptureBridge'
import type { actionRepo } from '../db/repos/actionRepo'
import type { decisionRepo } from '../db/repos/decisionRepo'

/**
 * Send the authoritative `items:changed` for `meetingId`: the full current
 * decisions and actions (both Proposed and Confirmed) read straight from the DB.
 */
export function sendItemsChanged(
  sender: IpcSender,
  meetingId: string,
  decisions: ReturnType<typeof decisionRepo>,
  actions: ReturnType<typeof actionRepo>,
): void {
  sender.send('items:changed', {
    meetingId,
    decisions: decisions.listByMeeting(meetingId),
    actions: actions.listActionsByMeeting(meetingId),
  } satisfies ItemsChangedPayload)
}
