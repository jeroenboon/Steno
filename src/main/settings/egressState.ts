/**
 * Re-export from shared/settings/egressState — the canonical location.
 *
 * egressState lives in src/shared/settings/ because:
 *   - src/shared/ipc.ts needs EgressState (renderer-facing IPC boundary)
 *   - The renderer will consume EgressState via IPC
 *   - It has zero Electron dependencies (pure function of AppSettings)
 *
 * This re-export keeps existing main-process imports working without changes.
 */
export {
  computeEgressState,
  buildDisclosureCopy,
  type AudioEgress,
  type NotesEgress,
  type EgressState,
  type DisclosureCopy,
} from '@shared/settings/egressState'
