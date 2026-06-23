/**
 * Settings migration utilities.
 *
 * Handles forward migration of persisted settings when the schema evolves.
 * Each migration function is idempotent: calling it on already-migrated data
 * is a no-op.
 */

// ---------------------------------------------------------------------------
// Migration: custom-openai → openai-compatible (phase 0.1)
// ---------------------------------------------------------------------------

/**
 * Migrate old `custom-openai` discriminator to the new protocol-discriminated
 * `openai-compatible` with an explicit `preset: 'custom'` tag.
 *
 * This is a forward-only migration:
 *   - Old: { extractionProvider: 'custom-openai', customOpenAI: {...} }
 *   - New: { extractionProvider: 'openai-compatible', openaiCompatible: { preset: 'custom', ...} }
 *
 * Idempotent: calling on already-migrated data is a no-op.
 */
export function migrateCustomOpenAIToOpenAICompatible(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const { extractionProvider } = settings

  // If already the new format, no-op
  if (extractionProvider === 'openai-compatible') {
    return settings
  }

  // If not the old format, no-op
  if (extractionProvider !== 'custom-openai') {
    return settings
  }

  const customOpenAI = settings.customOpenAI
  if (!customOpenAI || typeof customOpenAI !== 'object') {
    return settings
  }

  // Transform: old customOpenAI → new openaiCompatible with preset: 'custom'
  return {
    ...settings,
    extractionProvider: 'openai-compatible',
    openaiCompatible: {
      ...(customOpenAI as Record<string, unknown>),
      preset: 'custom',
    },
    customOpenAI: undefined,
  }
}

/**
 * Apply all forward migrations to loaded settings.
 * Migrations are applied in order, each one idempotent.
 */
export function applyMigrations(settings: Record<string, unknown>): Record<string, unknown> {
  let result = settings
  result = migrateCustomOpenAIToOpenAICompatible(result)
  return result
}
