# BYO provider model: curated presets + OpenAI-compatible custom endpoint

## Context

Item 0012 adds user-configurable provider selection. The design surface is:

- Which ASR provider turns audio into text
- Which extraction provider reads the transcript and proposes decisions and actions
- Where API keys are stored
- How the app communicates to the user what data leaves their device

Two questions needed hard answers: what provider options to expose, and what to do about Parakeet until item 0023 ships.

## Decision

### Provider selection model: curated presets + OpenAI-compatible custom endpoint

We expose two preset options and one extensible custom option:

**ASR:**

- `deepgram` — Deepgram streaming WebSocket (the V1 default)
- `local-parakeet` — Parakeet V3 via ONNX (deferred; buildable in settings but factory throws "not yet implemented" until item 0023)

**Extraction:**

- `anthropic` — Anthropic Claude via the Anthropic SDK (the V1 default)
- `custom-openai` — Any OpenAI-compatible chat completions endpoint (requires base URL, model, keyRef, and display name)

The "custom-openai" option makes the product useful to users who have Azure OpenAI, a local LLM proxy (LM Studio, Ollama with OpenAI-compat mode, etc.), or any third-party provider that implements the OpenAI API. No separate adapter per vendor is needed; the OpenAI chat completions API is the de facto standard.

Presets (Deepgram, Anthropic) are simply pre-filled instances of the same underlying config type — they do not require a separate code path, just dedicated Zod schema branches with tighter validation and no URL/displayName fields.

### local-parakeet: modelled in settings, blocked in factory

`local-parakeet` is included in the `asrProvider` enum so:

1. The setting can be persisted and round-tripped without data loss (future-proof)
2. `computeEgressState` can correctly return `audio: 'local'` even before the adapter ships
3. The UI (item 0013+) can display and disable the option with an "experimental / coming soon" note

The factory (`buildProviders`) throws a descriptive `"not yet implemented"` error for `local-parakeet` until item 0023 lands. This is preferable to omitting it from the enum because omitting it would force a schema migration later and would break any persisted settings that select it.

### API key storage: Electron safeStorage (DPAPI on Windows) via an abstracted interface

API keys are stored via `ElectronSecretStorage`, which wraps Electron's `safeStorage.encryptString` / `decryptString` (DPAPI-backed on Windows) and persists the encrypted bytes to `<userData>/secrets.json` as base64. Reasons:

- **DPAPI** ties decryption to the user's Windows login; the key ciphertext is useless if the file is copied to another machine or user account.
- **Separate from settings.json** — the settings file holds only provider selection and model IDs (no secrets), making it safe to inspect or export for debugging.
- **Abstracted** — the `SecretStorage` interface is injected at the call site. Unit tests use `MemorySecretStorage` (plain Map in memory); no real safeStorage is called outside the Electron process. This is the same testability pattern as `WebSocketFactory` in item 0011.

Keys are identified by stable opaque names: `'deepgram'`, `'anthropic'`, or the `keyRef` field from `CustomOpenAIConfig` (caller-chosen). The factory fetches keys by these names; the raw key value never touches settings.json or any log.

### Settings: validated JSON via Zod discriminated union

`AppSettings` is a Zod discriminated union on `extractionProvider`:

- `'anthropic'` branch: no `customOpenAI` block required (or meaningful)
- `'custom-openai'` branch: `customOpenAI` block required and fully validated (`baseUrl` as URL, `model` non-empty, `keyRef` non-empty, `displayName` non-empty)

This means the TypeScript type is exact: accessing `settings.customOpenAI.displayName` is only valid in the `'custom-openai'` branch — the compiler prevents accessing it in the `'anthropic'` branch. There is no optional-field ambiguity.

### Settings location: src/shared/settings/ (not src/main/settings/)

`settingsSchema.ts` and `egressState.ts` are in `src/shared/settings/` because both are pure (no Electron dependencies) and the renderer will need `EgressState` (via IPC) and the UI will display settings fields. `src/shared/ipc.ts` imports both. The main-process files in `src/main/settings/` re-export from shared.

Stateful, Electron-dependent parts (SettingsStore, SecretStorage/ElectronSecretStorage, providerFactory) remain in `src/main/settings/` because they write to the filesystem, call safeStorage, or instantiate provider adapters — none of which belongs in the renderer.

### EgressState: a pure function of settings

`computeEgressState(settings)` returns a serialisable `{ audio, notes }` object:

- `audio`: `'local'` or `'cloud:Deepgram'`
- `notes`: `'cloud:Anthropic'` or `` `cloud:custom:${displayName}` ``

This is a pure function with no side effects. It is safe to call at any time, safe to serialise over IPC, and safe to pass to the renderer. The renderer's `EgressIndicator` (item 0013) will render it directly. The tagged-string format (`cloud:Deepgram`) keeps the type simple and renders without a lookup table.

## Consequences

- Adding a new preset provider requires: a Zod schema branch, a factory case, an `egressState` mapping, and an adapter. The interface is consistent.
- `local-parakeet` is a known dead end in the factory until item 0023. The error message is explicit so no one is confused.
- The `customOpenAI` `keyRef` field means the same key (e.g. `'azure-llm'`) can be stored once and referenced by any number of custom endpoint configs. This is intentional — not over-engineered; it's the simplest way to avoid duplicating secrets.
- The discriminated union on `extractionProvider` means Prettier schema migration is needed if we ever add a third extraction provider. This is acceptable; schema evolution is expected and Zod handles it cleanly.
