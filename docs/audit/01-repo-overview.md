# Audit 01 — Repo overview & metrics

_Audit date: 2026-07-05. Branch: `fix/stale-finalising-overlay` (clean tree, HEAD `01b80a4`). 276 commits._

## What the project is

Steno / LiveTranscriber: a Windows Electron + TypeScript + React desktop app that transcribes live meetings (local Whisper via sherpa-onnx, or bring-your-own cloud ASR) and extracts structured Decisions and Actions during the meeting, monitored and corrected in real time by a note-taker.

## Size & shape

| Area           | LOC (ts/tsx/mjs) | Notes                                                                                           |
| -------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| `src/main`     | ~21,000          | process entry, DB + migrations, services, 12+ provider adapters, settings/secrets, IPC registry |
| `src/renderer` | ~13,200          | 6 screens, ~20 components, Zustand store, i18n                                                  |
| `src/shared`   | ~6,800           | domain types (Zod), ports, DTOs, audio DSP, assignment, export                                  |
| `src/preload`  | ~390             | contextBridge exposure of `window.api`                                                          |
| `scripts`      | ~160             | native ABI swap, Electron native smoke, secret scan                                             |

- 300 tracked files; 118 non-test source files; **92 test files** (~0.78 test files per source file — colocated `*.test.ts(x)`).
- 25 ADRs (numbered 0001–0035 with gaps matching original build items), `CONTEXT.md` glossary, `CLAUDE.md`, plans and a prior architecture review under `docs/`.

## Largest files (non-test)

| File                                          | LOC   |
| --------------------------------------------- | ----- |
| `src/renderer/src/screens/LiveScreen.tsx`     | 1,179 |
| `src/shared/ipc.ts`                           | 1,060 |
| `src/main/ipc-registry.ts`                    | 816   |
| `src/renderer/src/screens/SettingsScreen.tsx` | 757   |
| `src/renderer/src/screens/ReviewScreen.tsx`   | 657   |
| `src/main/index.ts`                           | 533   |
| `src/main/services/liveExtractionRuntime.ts`  | 516   |

Nothing pathological for an Electron app of this scope, but the two biggest renderer screens and the IPC pair are the obvious hotspots (detailed in Audit 03).

## Toolchain

- electron-vite 5 / Vite 6, Electron 42, React 19, TypeScript 5.7 (strict + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`), Vitest 3, ESLint 9 flat config, Prettier, Tailwind 3, Zustand 5, Zod 4 (pinned exact), better-sqlite3 12, sherpa-onnx, ws, @anthropic-ai/sdk.
- Dual-ABI native module handling via `scripts/rebuild-native.mjs` with pre-hooks on every native-touching npm script (see Audit 06).
- CI: GitHub Actions (`ci.yml`, `codeql.yml`, `dependabot-automerge.yml`), husky pre-push hook, `npm run verify` mirrors the CI Definition-of-Done gate locally.

## Immediate red flags found during the initial sweep

1. **`deepgram.txt` in the repo root contains a bare 40-char hex string that matches the format of a Deepgram API key.** The repo is public. If this is (or ever was) a live key it must be revoked immediately and the file purged from history. Detailed in Audit 05.
2. **`lint-output.txt` is committed** — a UTF-16 lint log artifact (capturing 1 then-current lint error). Build/debug output does not belong in git; it should be deleted and added to `.gitignore`.

Both are stray-file hygiene failures rather than code problems, but (1) is severity-critical if the key is real.

## Report index

- `01-repo-overview.md` — this file
- `02-architecture.md` — process model, ports & adapters, runtime, persistence
- `03-code-quality.md` — hotspots, duplication, conventions in code
- `04-tests.md` — test suite health and coverage shape
- `05-security-privacy.md` — Electron baseline, secrets, egress, supply chain
- `06-tooling-ci-dependencies.md` — build, CI, native ABI, deps
- `07-docs-conventions.md` — ADRs, CONTEXT.md, i18n, docs hygiene
- `potential_features.md` — product feature ideas
