# Multi-provider expansion: OpenAI, Mistral, Azure (ASR + extraction)

Status: planned (backlog). Outcome of a grilling session on 2026-06-23.

## Goal

Add OpenAI, Mistral and Azure (AI Foundry / Azure OpenAI / Azure Speech) as
selectable providers for **both** ASR and extraction, without bloating the
settings page and without a per-vendor schema migration every time.

## Decisions taken in the grill (the load-bearing ones)

1. **Named presets over one adapter family, not a separate adapter per vendor.**
   The product exposes one-click presets (OpenAI, Mistral, Azure, Custom) that
   prefill config; behind them sit as few adapter classes as the wire protocols
   allow.

2. **Discriminate settings on the wire protocol, not on the vendor.**
   Vendor is a display/prefill tag; protocol is what changes parsing and auth.
   - Extraction union becomes: `anthropic` | `openai-compatible` (+`preset`) |
     `azure-openai`. OpenAI / Mistral / generic-custom all live in
     `openai-compatible` and differ only by prefilled base URL + model + preset
     tag. Azure gets its own branch because its URL shape and `api-key` auth
     genuinely differ. Adding vendor #4 (Groq, Together, …) is a new `preset`
     enum value, **no migration**.
   - One forward migration only: `custom-openai` → `openai-compatible`
     (`preset: 'custom'`). The `azure-openai` branch is purely additive.

3. **Extraction stays single-model for the new providers.**
   The Anthropic rolling/final two-tier split is NOT generalised. `openai-compatible`
   and `azure-openai` use one model for both the rolling cadence and the final
   pass. (Explicit choice to keep config small.)

4. **Realtime ASR has no shared wire; batch transcription is near-uniform.**
   Unlike extraction (one chat-completions wire for everyone), live ASR is three
   unrelated WebSocket protocols: OpenAI-Realtime (shared by OpenAI + Azure
   OpenAI `gpt-4o-transcribe`), Mistral Voxtral Realtime, and Deepgram's own.
   Therefore: **ship batch/import first** (one near-uniform `transcribeBatch`
   path), and treat realtime streaming adapters as a later, explicit phase.
   Deepgram (and later local Parakeet) remain the live options until then.

5. **One provider entry per vendor, mode chosen by the runtime.**
   A vendor is a single ASR choice (e.g. "OpenAI"); the adapter exposes both
   `transcribeBatch` (import) and, once built, streaming (live). The user never
   picks "batch vs realtime". Before the realtime phase ships, picking such a
   provider for a _live_ meeting is gated with a clear "alleen voor import"
   message — same pattern as `local-parakeet` being modelled-but-factory-gated
   (ADR 0012).

## Recommended models (researched mid-2026, cost-vs-outcome)

Extraction is the cost-sensitive role: the rolling cadence fires every 15-30s
over accumulating transcript for the whole meeting, so the rolling calls
dominate. Decision/Action extraction is structured-JSON work, not deep
reasoning, so a cheap mid/mini-class model is fit-for-purpose. The final pass
benefits from a stronger model, but we chose single-model for the new providers
(decision #3), so each default below is the cost-balanced single pick, with a
quality upgrade noted.

ASR for import is also cost-sensitive (whole files); for live, latency and
interim-span quality matter more than per-minute price.

| Role                 | Provider             | Default (cost-balanced)                                                   | Approx price                          | Quality upgrade                         |
| -------------------- | -------------------- | ------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------- |
| Extraction           | Anthropic (existing) | Haiku 4.5 rolling / Sonnet 4.6 final                                      | $— (two-tier kept)                    | Opus 4.8 for final                      |
| Extraction           | OpenAI               | **gpt-5.4-mini**                                                          | $0.75 / $4.50 per 1M                  | gpt-5.4 ($2.50/$15)                     |
| Extraction           | Mistral              | **Mistral Medium 3.5**                                                    | ~$0.40 / $2.00 per 1M                 | Mistral Large ($2/$6)                   |
| Extraction           | Azure                | OpenAI model via deployment (mirror OpenAI: **gpt-5.4-mini**)             | ~OpenAI parity                        | gpt-5.4 / gpt-5.5                       |
| ASR (import)         | OpenAI               | **gpt-4o-mini-transcribe**                                                | ~$0.003/min                           | gpt-4o-transcribe ($0.006/min)          |
| ASR (import)         | Mistral              | **Voxtral Mini Transcribe V2**                                            | ~$0.003/min                           | — (already SOTA accuracy + diarization) |
| ASR (import)         | Azure                | Azure OpenAI **gpt-4o-transcribe** (shares OpenAI Realtime wire for live) | ~OpenAI parity                        | —                                       |
| ASR (live, existing) | Deepgram             | **Nova-3** (bump from nova-2)                                             | $0.0077/min stream, $0.0043/min batch | —                                       |
| ASR (live, phase 4)  | OpenAI / Azure       | **gpt-realtime-whisper** / gpt-4o-transcribe streaming                    | per-token audio                       | —                                       |
| ASR (live, phase 4)  | Mistral              | **Voxtral Realtime**                                                      | ~$0.006/min                           | —                                       |

Notes that change the math:

- **`gpt-4o` is legacy for chat** (use gpt-5.4-mini), but **`gpt-4o-transcribe` is
  still the current STT model** — it is not the same stale label, so referencing
  it for ASR is correct.
- **Prompt caching is the big lever** for the rolling cadence. The system
  prompt, agenda and participants are identical on every 15-30s call; OpenAI
  (75-90% off cached prefix), Anthropic, and Azure all cache it. This cuts the
  dominant rolling cost enough that it largely offsets the single-model choice —
  see task 5.4.
- **Voxtral Mini returns speaker diarization**, which maps onto the existing
  **Speaker label → Participant** flow (CONTEXT.md). A nice free win on the
  Mistral import path.
- Model IDs live in the preset catalog (task 1.1) and the ASR config, all
  user-overridable, so a model refresh is a data edit, not a code change.

## Settings UX (answers the "don't overwhelm the page" constraint)

Replace the two two-option `SegmentedControl`s (which break past ~3 options)
with two **provider role cards**: Audio (ASR) and Notulen (extraction).

- Each card has a single grouped select, most-private first:
  `Op dit apparaat` → Lokaal; `Cloud` → Deepgram, OpenAI, Mistral, Azure,
  Aangepast.
- Selecting a provider reveals **only that provider's** config panel beneath the
  select (model field pre-filled from the preset, key field, and for Azure the
  endpoint/deployment/apiVersion fields). Progressive disclosure: the page shows
  config for exactly the two chosen providers, so its size is constant no matter
  how big the catalog grows.
- Point-of-choice disclosure copy (`buildDisclosureCopy`) stays, driven by
  egress state — a standing obligation per ADR 0003.
- **Shared key per vendor.** OpenAI uses one key for ASR + extraction; Azure
  uses one resource key. The `keyRef` is the vendor id (`openai`, `mistral`,
  `azure`), so a key entered once for either role satisfies both. The card shows
  "sleutel al ingesteld" when the shared key exists.

## Schema shapes (target)

Extraction (`AppSettingsSchema`, discriminated on `extractionProvider`):

```
'anthropic'         → { rollingModel?, finalPassModel? }              (unchanged)
'openai-compatible' → { preset: 'openai'|'mistral'|'custom',
                        baseUrl, model, keyRef, displayName }
'azure-openai'      → { endpoint, deployment, apiVersion, model,
                        keyRef, displayName }
```

ASR (mirror the same protocol-discrimination; today it is a flat enum
`['deepgram','local-parakeet']` plus an optional `deepgram` config object):

```
'local-parakeet'    → {}                                             (unchanged)
'deepgram'          → { language? }                                  (unchanged)
'openai-audio'      → { model, keyRef, language?, displayName }      (OpenAI + custom OpenAI-compatible audio)
'mistral-voxtral'   → { model, keyRef, language?, displayName }
'azure-speech'      → { endpoint, deployment|region, apiVersion?, keyRef, language?, displayName }
```

Egress (`egressState.ts`): generalise the literal unions to keep them
renderable but open:

```
type AudioEgress = 'local' | `cloud:${string}`   // cloud:Deepgram, cloud:OpenAI, cloud:Mistral, cloud:Azure
type NotesEgress = `cloud:${string}`             // cloud:Anthropic, cloud:OpenAI, …, cloud:custom:<name>
```

---

# Backlog

Phases are independently shippable. Each task is one coherent commit and must
clear the DoD gate (build, all tests incl. `npm run test:native`, zero lint,
Prettier last). Tests come first (TDD). Each task that changes a documented
decision carries its ADR / CONTEXT.md edit in the same commit (principle #4).

## Phase 0 — Extensible substrate (no new vendor behaviour yet)

Goal: generalise schema, egress, factory and UX so adding a vendor is config,
not surgery. Existing Deepgram/Anthropic/custom behaviour unchanged.

- **0.1 Migrate extraction schema to protocol-discrimination.**
  `custom-openai` → `openai-compatible` (+ `preset` tag, default `'custom'`).
  Forward settings migration so persisted `custom-openai` configs load. Update
  `z.infer` types, `providerFactory`, `egressState`. ADR succeeding 0012 in the
  same commit.
  - Tests: schema round-trip, migration of an old config, factory still builds
    the generic endpoint, egress unchanged for existing custom config.

- **0.2 Add the `azure-openai` extraction branch (schema only).**
  Required `endpoint`/`deployment`/`apiVersion`/`model`/`keyRef`/`displayName`.
  Factory throws a clear "not yet implemented" for it (adapter lands in 2.x),
  mirroring the `local-parakeet` precedent.
  - Tests: schema validation (missing Azure field rejected), factory throws the
    descriptive error.

- **0.3 Generalise egress types + disclosure copy.**
  `cloud:${string}` for audio and notes; `buildDisclosureCopy` handles any named
  vendor and the Azure form. Keep Dutch, factual copy.
  - Tests: egress + badge + disclosure for each new tag value.

- **0.4 Settings UX: role cards + grouped select + progressive disclosure.**
  Replace the ASR and extraction `SegmentedControl`s with the role-card pattern.
  No new providers wired yet — just Deepgram/Local and Anthropic/Custom rendered
  through the new shell so the page is ready to grow.
  - Tests (RTL): selecting a provider reveals only its config panel; disclosure
    copy updates; existing key-save flows still pass.

- **0.5 ASR schema to protocol-discrimination (schema + factory scaffold).**
  Turn `asrProvider` into a discriminated union; add `openai-audio`,
  `mistral-voxtral`, `azure-speech` branches with factory cases that throw
  "not yet implemented". Forward migration of the existing flat enum.
  - Tests: schema round-trip + migration, factory throws for the new branches,
    Deepgram/Local still build.

- **0.6 Bump Deepgram nova-2 → nova-3 (existing-provider fix).**
  `DeepgramAsrProvider.ts` hardcodes `model: 'nova-2'` in two places; Nova-3 is
  the current flagship (better WER, same streaming API). Independent, small,
  shippable on its own.
  - Tests: update the two model-id assertions; adapter still parses interim/final.

## Phase 1 — Extraction presets: OpenAI + Mistral

Goal: one-click OpenAI and Mistral extraction. Pure config over the existing
generic adapter — no new adapter code.

- **1.1 Preset catalog (data, not code paths).**
  A table mapping `preset → { displayName, defaultBaseUrl, defaultModel }`:
  OpenAI (`https://api.openai.com/v1`, `gpt-5.4-mini`), Mistral
  (`https://api.mistral.ai/v1`, `mistral-medium-3.5` / current `-latest` alias).
  Drives prefill only; user can override to a stronger model.
  - Tests: catalog completeness, defaults present and valid URLs.

- **1.2 Wire presets into the extraction role card.**
  Selecting OpenAI / Mistral prefills base URL + model + `keyRef=<vendor>`;
  fields stay editable. `displayName` defaults to the vendor name.
  - Tests (RTL): pick OpenAI → fields prefilled, key saved under `openai`,
    settings persist as `openai-compatible` with the right preset.

- **1.3 Generalise `CustomOpenAIExtractionProvider` for the family.**
  Mostly verification: confirm it works against OpenAI and Mistral response
  shapes; tighten the `displayName` log tag. Rename if helpful
  (`OpenAICompatibleExtractionProvider`).
  - Tests: adapter against mocked OpenAI and Mistral chat-completions responses,
    including JSON-repair retry path.

- **1.4 CONTEXT.md reflection.** Generalise the "Extraction Provider" glossary
  entry so it no longer implies Anthropic-or-custom-only.

## Phase 2 — Extraction: Azure

Goal: Azure OpenAI / AI Foundry extraction working end to end.

- **2.1 `AzureOpenAIExtractionProvider` adapter.**
  Same JSON-mode + one-retry strategy as the OpenAI-compatible adapter, but
  `{endpoint}/openai/deployments/{deployment}/chat/completions?api-version=…`
  with the `api-key` header. Implement `extract` + `inferContext`.
  - Tests: mocked Azure responses, URL/auth assembly, retry path.

- **2.2 Factory + role-card support for Azure.**
  Replace the 0.2 "not yet implemented" throw with construction. Azure config
  panel (endpoint/deployment/apiVersion) shown only when Azure is selected.
  - Tests: factory builds Azure from settings; RTL config panel + persistence.

- **2.3 Egress + disclosure + CONTEXT reflection for Azure notes.**

## Phase 3 — Batch ASR for import (OpenAI, Mistral, Azure-Whisper)

Goal: Imported Meetings can use any of the new vendors. `transcribeBatch` only;
live still uses Deepgram/Local. Picking these for a live meeting is gated with
the "alleen voor import" message.

- **3.1 `OpenAIBatchAsrProvider` (`transcribeBatch`).**
  POST PCM (as WAV) to `/audio/transcriptions` with `gpt-4o-mini-transcribe`
  (default) / `gpt-4o-transcribe`, map response (and verbose-json segments, if
  requested) to `TranscriptSpan[]`. Streaming methods throw "not yet
  implemented". Covers OpenAI + custom OpenAI-compatible audio.
  - Tests: mocked transcription response → spans; segment timing mapping.

- **3.2 `MistralVoxtralBatchAsrProvider` (`transcribeBatch`).**
  Voxtral Mini Transcribe V2 batch endpoint → spans. Map its diarization output
  onto `speakerLabel` so the Speaker-label → Participant flow lights up.
  - Tests: mocked Voxtral batch response → spans, incl. diarized speaker labels.

- **3.3 `AzureWhisperBatchAsrProvider` (`transcribeBatch`).**
  Azure-hosted Whisper batch endpoint (Azure auth/URL) → spans.
  - Tests: mocked Azure batch response → spans.

- **3.4 Factory + import path wiring + live-gating.**
  Build these for import; when selected for a live meeting, surface the
  "alleen voor import / nog geen live-ondersteuning" gate in the role card and
  block the live runtime build with a descriptive error.
  - Tests: factory builds batch providers; live build rejects with clear error;
    import path uses `transcribeBatch`.

- **3.5 CONTEXT.md reflection** of the "ASR Provider" entry (batch vs streaming,
  per-vendor live availability). ADR: "ASR has no shared realtime wire →
  batch-first; streaming deferred."

## Phase 4 — Realtime ASR streaming

Goal: live parity for the new vendors. Each is a distinct WS adapter with its
own interim/final semantics and reconnect logic. Independently shippable per
vendor.

- **4.1 `OpenAIRealtimeAsrProvider` (WebSocket).**
  Realtime transcription session (`gpt-realtime-whisper` / `gpt-4o-transcribe`),
  24 kHz mono PCM, interim + final spans, reconnect/backoff. Injectable
  `WebSocketFactory` (same testability pattern as Deepgram, ADR 0011).
  - Tests: scripted WS frames → interim/final spans; reconnect; stop() drains.

- **4.2 Azure OpenAI realtime reuse.**
  Same Realtime protocol as 4.1 with Azure auth/URL — extend 4.1 with an
  injected endpoint/auth builder rather than a new adapter.
  - Tests: Azure URL/auth assembly over the shared frame handling.

- **4.3 `MistralVoxtralRealtimeAsrProvider` (WebSocket).**
  Voxtral Realtime protocol, sub-200 ms, interim/final spans.
  - Tests: scripted WS frames → spans; reconnect.

- **4.4 Remove live-gating; runtime selects streaming for live, batch for import**
  per provider capability. Update egress/disclosure to reflect live audio
  leaving to the vendor. CONTEXT reflection.

## Phase 5 — Polish

- **5.1 "Test connection" affordance** per provider (one cheap round-trip:
  models list for chat, a tiny transcription for ASR), surfacing auth/URL errors
  at config time instead of mid-meeting. Never logs the key.
- **5.2 Shared-key UX hardening.** Clear messaging that one vendor key serves
  both roles; replace/cancel flows for the shared key.
- **5.3 Docs:** in-app guidance for where to get each vendor's key/endpoint;
  update any user-facing README/settings help.
- **5.4 Prompt caching for the rolling cadence.** The system prompt + agenda +
  participants are byte-identical on every 15-30s call. Mark that prefix cached
  for the providers that support it (OpenAI `prompt_cache`, Anthropic
  `cache_control`, Azure same as OpenAI). This is the single biggest cost lever
  given the cadence and largely offsets the single-model choice (decision #3).
  - Tests: request body carries the cache markers; behaviour unchanged otherwise.

## Dependencies / ordering notes

- Phase 0 gates everything (substrate). 1 and 3 can run in parallel after 0.
- 2 depends on 0.2; 4 depends on 3 (provider entries exist) but each 4.x vendor
  is independent.
- Each phase leaves the app shippable: no half-wired provider ever reaches a
  user without either working or showing a clear gate message.
