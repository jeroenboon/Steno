# ADR 0040 — Local extraction provider (LM Studio / Ollama / llama.cpp)

**Status:** accepted
**Relates to:** ADR 0003 (privacy/egress), ADR 0012 + ADR 0027 (provider model), ADR 0034 (shared extraction wire)

## Context

Audio can already run fully on-device (`local-parakeet` ASR, item 0023). Extraction was cloud-only, so "audio stays on device" still meant transcript text left it. Completing the privacy story means an extraction provider that talks to an on-device or self-hosted OpenAI-compatible LLM server (LM Studio, Ollama, llama.cpp). Those speak the same `chat/completions` protocol we already serve through `OpenAICompatibleExtractionProvider` + `OpenAiJsonWire`, so the adapter is reused unchanged. The design work was in the settings/egress/key seams, where the existing code bakes in two cloud assumptions that local breaks: **every extraction provider has an API key**, and **notes egress is always cloud**.

## Decisions

### 1. `local` is a top-level `extractionProvider` discriminator, not a preset within `openai-compatible`

This deliberately reverses ADR 0027's principle ("a new OpenAI-compatible vendor is a `preset` value, not a new branch"). ADR 0027 optimised for schema stability across _cloud_ vendors that are interchangeable at the egress and auth layer. Local is not interchangeable there: its egress is on-device and its key is optional. Modelling it as a preset inside `openai-compatible` would force `computeNotesEgress` to reach into `openaiCompatible.preset` (a discriminator that no longer discriminates the thing that matters — where data goes), widen `NotesEgress` anyway, and make the required-key / key-lookup / connection-test-needs-key logic conditional on a sub-field inside a branch that otherwise assumes cloud. A top-level `'local'` branch makes `notes` fall out of the discriminator cleanly and confines the optional-key behaviour to one place. The `OpenAICompatibleExtractionProvider` adapter and `OpenAiJsonWire` are still shared — only the settings branch, egress mapping, and key-optionality differ. Cost: the settings union grows from 15 to 20 variants (5 ASR × 4 extraction), which the `providerVariant(...)` builder keeps to a few declarative rows.

The branch carries `{ preset, baseUrl, model, keyRef, displayName }` with `preset: 'lmstudio' | 'ollama' | 'llamacpp' | 'local-custom'`. Unlike the cloud `openai-compatible` preset (whose `displayName` feeds the `cloud:custom:<name>` egress string), the local preset is **prefill-only** (default base URL/port + example model, and a card label); it is not egress-load-bearing.

### 2. Egress has three honest zones, split by URL host — not two

`NotesEgress` widens from `` `cloud:${string}` `` to `` 'local' | `local-network:${string}` | `cloud:${string}` ``. For the local provider, `computeNotesEgress` inspects the configured base URL's host: a loopback host (`localhost`, `127.0.0.0/8`, `::1`) → `notes: 'local'` ("op dit apparaat"); any other host → `` `local-network:${host}` `` ("verlaat dit apparaat, blijft in je netwerk"). This keeps the always-visible egress badge honest: pointing local extraction at a homelab box (e.g. Ollama on `192.168.1.50`) is real egress off this device and is labelled as such, never as `local`. We accept a small URL-host heuristic _here_ (in the rendering of an explicitly-chosen local provider) precisely because the alternative — calling LAN traffic "local" — is the "surprise egress" ADR 0003 forbids. We did **not** use a URL heuristic to _choose_ the provider (decision 1); localness is an explicit user choice, and the host only refines the label.

### 3. The API key is optional; `keyRef` stays required

LM Studio and Ollama need no key; llama.cpp's `--api-key` and reverse-proxied setups do. Rather than widen `resolveExtractionKeyRef` to `string | null` (which ripples into `getSharedKeyRef`, `SharedKeyNotice`, and the key-presence probe), the local config keeps a required non-empty `keyRef` (default: the preset id) and makes the stored **secret** optional. The factory looks up the key and omits the `Authorization` header when none is stored; `connectionTest` probes `/models` unauthenticated for local instead of returning `no-key`. The optional-key behaviour is thus confined to the factory and the connection test.

### 4. Reuse the wire; local sends `response_format: text` and drops `prompt_cache_key`; quality is a disclosure concern

The local path reuses `OpenAiJsonWire` (`parseJsonLoose` + the engine's retry-degrade already recover sloppy small-model JSON). Two body fields differ from cloud, both confined to the factory's `local` branch:

- **`response_format: { type: 'text' }`, not `'json_object'`.** Newer LM Studio (new engine) dropped `json_object` and returns `HTTP 400 "'response_format.type' must be 'json_schema' or 'text'"`, which failed every rolling turn (validation-fail → retry → same 400 → turn skipped). `text` is the universal OpenAI-compatible default (LM Studio old + new, Ollama, llama.cpp) and `parseJsonLoose` recovers the object from the prompt-instructed JSON output. `json_schema` was rejected as the local default because with reasoning models (e.g. Qwen3) LM Studio routes the answer into `reasoning_content` and leaves `content` empty, so the engine sees nothing.
- **No `prompt_cache_key`.** A cloud billing optimisation, useless locally (local runtimes do prefix caching automatically), and a strict local server could `400` on the unknown field and silently null out extraction.

Small-model quality is handled as **expectations, not code**: a point-of-choice "lokaal = doorgaans lagere extractiekwaliteit" disclosure mirroring the existing cloud disclosure pattern, plus setup docs.

### 5. Failure hints live in "Test verbinding" (config-time), not a new runtime channel

Local failures are common and user-fixable (server off, model not loaded, wrong port, key needed). `connectionTest` gains local-aware Dutch copy mapping `network` / `404` / `401`/`403` to concrete hints. Runtime extraction failure stays silent-no-items as it is for every provider today; a runtime "extraction stopped" signal (analogous to ASR Terminal State) was explicitly out of scope for this feature.

**Superseded (2026-07-07):** the first real local run surfaced a failure this could not cover — a reasoning model that truncates its answer (`finish_reason: length`) produces no notes silently. That runtime "extraction stopped" signal is now built as the **Extraction Terminal State** (ADR 0042), reversing the out-of-scope note above. A static instruct-model hint on the local extraction card is added there too.

## Consequences

- Pairing `local` extraction with `local-parakeet` ASR yields the first fully-on-device configuration, `{ audio: 'local', notes: 'local' }` — badge "audio lokaal · notulen lokaal".
- Adding the branch touches the standard wiring checklist in `settingsSchema.ts` (schema variant rows, `keyRefs`, `providerFactory`, `connectionTest`, `egressState`, the settings UI card + validation) plus the new `NotesEgress` zone and its disclosure copy.
- `NotesEgress` is no longer "always cloud"; any code that assumed a `cloud:` prefix on notes must handle the two local zones.
