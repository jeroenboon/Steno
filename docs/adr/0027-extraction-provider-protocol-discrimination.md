# ADR 0027 — Extraction provider protocol discrimination (phase 0.1)

**Status:** accepted (implemented 2026-06-23)  
**Successor to:** ADR 0012  
**Relates to:** Multi-provider expansion plan (Phase 0)

## Problem statement

ADR 0012 introduced a single "custom OpenAI-compatible" adapter for bring-your-own endpoints. As the product expands to support multiple cloud vendors (OpenAI, Mistral, Azure) alongside the existing Anthropic and custom options, the schema and factory needed to evolve:

1. The `custom-openai` discriminator value is a vendor name, not a protocol name.
2. Adding OpenAI, Mistral, and Azure extraction means multiple providers share the OpenAI-compatible `chat/completions` wire protocol.
3. The settings schema grew unwieldy per vendor.
4. Settings migrations would require code changes for each new vendor.

The design goal: **add vendors without growing the schema or factory explosively**.

## Decisions

### 1. Protocol-discriminated union, not vendor-discriminated

The settings schema now discriminates on **wire protocol**, not vendor:

```typescript
type ExtractionProvider = 'anthropic' | 'openai-compatible' | 'azure-openai'
```

Each branch holds the config specific to that protocol's wire format:

- `'anthropic'` → no extra config (rolling/final models set via `anthropic` sub-object)
- `'openai-compatible'` → `{ preset, baseUrl, model, keyRef, displayName }`
- `'azure-openai'` → `{ endpoint, deployment, apiVersion, model, keyRef, displayName }`

Vendor is identified by a `preset` tag within `openai-compatible`:

```typescript
type OpenAICompatiblePreset = 'openai' | 'mistral' | 'custom'
```

**Benefit:** Adding Groq, Together, or any other OpenAI-compatible vendor is a `preset` enum value, not a new discriminator branch.

### 2. Forward-only settings migration

Old settings with `{ extractionProvider: 'custom-openai', customOpenAI: {...} }` are automatically migrated to the new schema:

```typescript
{
  extractionProvider: 'openai-compatible',
  openaiCompatible: { preset: 'custom', ...oldCustomOpenAI }
}
```

The migration runs in `SettingsStore.load()` before validation, so persisted old configs load transparently. Migrations are:

- **Idempotent** — calling on already-migrated data is a no-op.
- **Deterministic** — same input always produces same output.
- **Logged in code** — documented in `migrationUtils.ts`.

**Benefit:** Users are never asked to re-enter settings; the app handles the upgrade silently.

### 3. Factory reflects the new structure

The provider factory's `buildExtractionProvider()` now switches on the discriminator:

```typescript
switch (settings.extractionProvider) {
  case 'anthropic': {
    // existing Anthropic adapter
  }
  case 'openai-compatible': {
    // single adapter for OpenAI, Mistral, custom
  }
  case 'azure-openai': {
    // Azure-specific adapter (phase 2)
  }
}
```

### 4. Egress state generalises the output type

The `NotesEgress` type generalises to label any vendor:

```typescript
type NotesEgress = 'cloud:Anthropic' | `cloud:custom:${string}`
```

For OpenAI and Mistral, the `displayName` is embedded in the egress string, so the egress indicator and disclosure copy remain vendor-agnostic.

## Trade-offs

- **No breaking UI change:** Existing "Custom OpenAI" settings load as `preset: 'custom'` automatically. The UX label stays "Custom OpenAI".
- **Schema stability:** Future vendors (Groq, Together, etc.) using the same OpenAI protocol are a preset enum value, never a new migration.
- **Clarity over generality:** We don't try to unify Anthropic into a generic "LLM provider" — each protocol gets its own branch because the auth shapes and endpoints differ.

## Implementation notes

- Migrations are tested: `SettingsStore.load()` applies migrations before validation.
- The schema is Zod-validated at every boundary.
- `AppSettings` type is derived from the schema via `z.infer`, so TypeScript knows which fields are available per discriminator branch.
- `egressState.ts` remains protocol-aware, not vendor-aware.

## What's next (Phase 1+)

- Phase 1: Wire OpenAI and Mistral presets into the settings UI; ship the first non-Anthropic extraction.
- Phase 2: Implement `AzureOpenAIExtractionProvider` and wire `azure-openai` branch.
- Phase 3+: Batch ASR imports, realtime ASR streaming, prompt caching for the rolling cadence.
