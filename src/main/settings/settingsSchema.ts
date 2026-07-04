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
  type AzureSpeechConfig,
  type CustomOpenAIConfig,
  type MistralVoxtralConfig,
  type OpenAIAudioConfig,
} from '@shared/settings/settingsSchema'
