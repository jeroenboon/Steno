/**
 * Re-export from shared/settings/settingsSchema — the canonical location.
 *
 * settingsSchema lives in src/shared/settings/ because:
 *   - src/shared/ipc.ts needs it (renderer-facing IPC boundary)
 *   - main-process code needs it (SettingsStore, providerFactory)
 *   - It has zero Electron dependencies (pure Zod schema)
 *
 * This re-export keeps existing main-process imports working without changes.
 */
export {
  AppSettingsSchema,
  CustomOpenAIConfigSchema,
  DEFAULT_SETTINGS,
  type AppSettings,
  type CustomOpenAIConfig,
} from '@shared/settings/settingsSchema'
