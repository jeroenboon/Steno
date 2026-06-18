# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Windows Electron + TypeScript + React desktop app that transcribes live meetings (local Parakeet V3 or a bring-your-own cloud ASR) and, during the meeting, extracts structured **Decisions** and **Actions** that a note-taker monitors and corrects in real time.

Read **[CONTEXT.md](CONTEXT.md)** before touching domain code — it is the authoritative glossary (Meeting, Decision, Action, Owner, Proposed/Confirmed, interim/final span, Egress State, etc.) and the terms in code match it exactly. Read the relevant **[docs/adr/](docs/adr/)** before changing the area an ADR covers; ADRs are numbered to match backlog items. **[BACKLOG.md](BACKLOG.md)** is the sequential build plan (items 0001–0025) and the engineering rules of engagement.

## Commands

```sh
npm run dev          # electron-vite dev (launches the app with HMR)
npm run build        # production build
npm test             # vitest run (one shot)
npm run test:watch   # vitest watch
npm run lint         # eslint .
npm run typecheck    # tsc --noEmit over tsconfig.json AND tsconfig.node.json
npm run format       # prettier --write .
npm run format:check # prettier --check . (CI gate)
npm run test:native     # load native modules under the Electron runtime (ABI gate)
npm run rebuild:native  # swap better-sqlite3 to the Electron ABI
npm run rebuild:native:node  # swap better-sqlite3 back to the current Node ABI
```

### Native modules: the dual-ABI swap (read before touching better-sqlite3 / any native dep)

`better-sqlite3` is a native module with a single compiled addon at `build/Release`. **Vitest runs under system Node; the Electron app embeds a _different_ Node ABI.** One binary cannot serve both: load the wrong one and you get `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION` mismatch. The app crashes at startup; Vitest fails to open a DB. Note `require('better-sqlite3')` only loads JS — the addon is loaded lazily on `new Database()`, so a bare `require` is **not** a valid ABI check. This dual-ABI trap is how the item-0018 startup crash slipped past a green test suite.

Because no single binary works for both, each native-using command **self-heals** by swapping in the right prebuilt before it runs (`scripts/rebuild-native.mjs`, via `prebuild-install` — prebuilt binaries, no C++ toolchain needed). Do not remove these hooks:

- `predev` / `prepreview` and `postinstall` → swap to the **Electron** ABI (so the app runs).
- `pretest` / `pretest:watch` → swap to the **Node** ABI (so Vitest runs).
- `pretest:native` → swap to the **Electron** ABI, then `npm run test:native` loads `better-sqlite3` under Electron's real runtime (`scripts/smoke-electron-native.mjs`). This is the gate that catches an ABI mismatch — Node-side Vitest structurally cannot. It runs in the DoD gate and CI after `npm test`.

Consequences: after `npm test` the binary is Node-ABI (the app would crash until `npm run dev` re-swaps it) and vice versa — this is expected; the pre-hooks handle it. Do **not** swap the swap tool for `electron-builder install-app-deps`: it caches build state and skips after an external swap, so it can't flip the ABI back and forth reliably. Never use `--build-from-source` unless MSVC + Python are installed — it deletes the prebuilt binary and fails silently with no compiler.

Run a single test file or test:

```sh
npx vitest run src/main/services/extractionLoopScheduler.test.ts
npx vitest run -t "cadence fires at the boundary"
```

### Definition of Done gate (non-negotiable, from BACKLOG.md)

An item is done only when all pass: **build succeeds, all tests pass (including `npm run test:native`), zero lint errors, Prettier has run.** Run `format` (or `format:check`) **last**: a prior run that adds files (e.g. a new ADR) after formatting will fail `format:check`. Each backlog item = one coherent change = one commit (Conventional Commits, via the `/git-commit` skill).

## Architecture

### Process discipline (ADR 0005)

The renderer is **UI only**. All I/O, the SQLite DB, API keys, and every provider call live in the **main** process. Security baseline is locked and must stay that way: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP. The renderer never touches `ipcRenderer` — everything goes through the typed preload bridge (`window.api`).

- `src/main/` — process entry, DB, services, provider adapters, settings/secrets, IPC registry.
- `src/preload/` — `contextBridge` exposure of `window.api` only.
- `src/renderer/` — React (screens, Zustand store, i18n, components). Dutch is the default UI language.
- `src/shared/` — pure domain code shared by main + tests. **Imports zero vendor SDKs.**

Path alias: `@shared/*` → `src/shared/*` (also `@shared/settings/*`). Two tsconfigs exist (`tsconfig.json` for renderer/web, `tsconfig.node.json` for main/preload/shared); `typecheck` runs both. Strict flags are on everywhere: `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, no `any` (lint-enforced).

### Ports & Adapters (ADR 0007)

The whole product rests on swapping providers, so the domain core depends only on interfaces:

- `src/shared/providers/ASRProvider.ts` and `ExtractionProvider.ts` — the two ports. DTOs are Zod schemas (`dtos.ts`); these are the boundary contracts.
- `FakeASRProvider` / `FakeExtractionProvider` + an injectable `Clock` (real + fake) live alongside them and back **every** timing/provider test (deterministic tests, no real timers, no network).
- Real adapters live in `src/main/providers/`: `DeepgramAsrProvider` (raw WebSocket, interim/final spans, ADR 0011), `AnthropicExtractionProvider` (haiku for rolling turns, sonnet for the final pass, JSON-with-one-retry-repair, ADR 0010), `CustomOpenAIExtractionProvider` (BYO OpenAI-compatible endpoint, ADR 0012).
- `src/main/settings/providerFactory.ts` resolves the configured provider. `tryBuildAsrProvider` / `tryBuildExtractionProvider` return a result object, not a throw: ASR and extraction are built **independently** so a missing extraction key never disables transcription, and vice versa. Missing keys degrade gracefully (Fake ASR fallback / extraction disabled) — the app must never crash on an unconfigured key.

### Validate at every boundary with Zod (rule #8)

LLM JSON, IPC payloads, settings on disk, and provider responses are all parsed through Zod before entering the domain. Domain types are **derived from** Zod schemas via `z.infer` (single source of truth) — see `src/shared/domain/`. Never `JSON.parse` LLM output straight into a typed object.

### IPC contract

`src/shared/ipc.ts` is the single source of truth for main↔renderer traffic: channel names, request/response Zod schemas, the `IpcChannel` union, and the `RendererApi` interface the preload implements. Two flavours:

- **Invoke channels** (`ipcMain.handle`) — request/response, dispatched through `src/main/ipc-registry.ts`. The `IPC_CHANNELS` array in `src/main/index.ts` must stay in sync with the `IpcChannel` union.
- **One-way / push channels** — `audio:frame` (renderer→main, `ipcMain.on`), and main→renderer events `transcript:span`, `items:changed`, `items:summaries` (`webContents.send`, exposed as `onX(cb) => UnsubscribeFn`). See ADR 0013.

Secrets are **write-only over IPC** (ADR 0014): `secret:set` and `secret:has` exist; there is deliberately **no `secret:get`**. Keys go into Electron `safeStorage` (DPAPI) in main and never round-trip to the renderer or land in the settings JSON / meeting DB.

### Persistence (ADR 0006)

`better-sqlite3` in main, DB file in `app.getPath('userData')`. **Forward-only, hand-rolled migrations** (no ORM) in `src/main/db/migrations/`, applied on startup in a transaction via `runMigrations`. Repositories in `src/main/db/repos/` do typed CRUD and map rows ↔ domain types through the Zod schemas. The schema is "cross-meeting ready" (owner, due_date, status are real columns) even where no UI uses it yet. Autosave every extraction turn so a crash loses at most the last turn (rule #13).

### Live extraction runtime (the heart — ADR 0008, ADR 0015)

`src/main/services/liveExtractionRuntime.ts` orchestrates one live meeting session, wiring the ASR span stream to the extraction pipeline:

1. **Span filtering** — interim spans (`isFinal === false`) are dropped; only final spans feed extraction (CONTEXT: "spans with `isFinal` absent are treated as final").
2. **Persistence** — every accepted final span is written immediately.
3. **`ExtractionLoopScheduler`** (`extractionLoopScheduler.ts`) runs a debounced ~15–30s rolling cadence over accumulating transcript (driven by the injected `Clock`), then a **final full-transcript pass** on meeting end that also produces per-Agenda-Item Discussion Summaries.
4. **Item lifecycle** — `ItemLifecycleService` enforces Proposed/Confirmed rules: the agent only ever creates/revises/retracts **Proposed** items; **Confirmed** items change only via explicit user edit. To emit `items:changed` without modifying the scheduler or service, the runtime extends `ItemLifecycleService` as `InterceptingItemLifecycleService` (it's a concrete class with private members, so composition can't reach in) and fires a callback from `proposeItems`.

`MeetingLifecycleService` (`meetingLifecycleService.ts`) is the single enforcer of `Draft → Live → Ended` transitions. Pause is a `paused: boolean` flag on the Meeting, **not** a fourth state — `state` stays `"live"` while paused.

Owner/agenda assignment (`src/shared/assignment/`) maps provider hints to the Participant list and agenda with an Off-agenda fallback; it **never invents a participant** (unknown/ambiguous → owner left unset).

### Privacy / egress (ADR 0003)

What leaves the device depends on the chosen providers; the invariant is _no surprise egress and no logging of content/secrets_. `computeEgressState()` derives a serialisable `{ audio, notes }` value (e.g. `{ audio: 'cloud:Deepgram', notes: 'cloud:Anthropic' }`, never any key). The always-visible `EgressIndicator` renders it, and `buildDisclosureCopy()` produces point-of-choice disclosure shown when a user selects a cloud provider in Settings. This disclosure is a standing UI obligation, not a one-off.

## Conventions

- TDD via the `/tdd` skill: red → green → refactor. No production code without a failing test first (pure scaffolding/config excepted — add a smoke test).
- Tests sit next to the code (`*.test.ts` / `*.test.tsx`); renderer tests use `@testing-library/react` + jsdom (`src/test-setup.ts`).
- After each item, reflect: update CONTEXT.md if a term shifted; add an ADR if a decision was hard-to-reverse + surprising + a real trade-off. Record it in the same commit.
- Prettier: no semicolons, single quotes, trailing commas, 100 cols, LF.
- UI strings are externalized (i18n), Dutch default, and the live note-taker flow is keyboard-first (every confirm/dismiss/edit has a key path).
