# Repo audit — Steno / LiveTranscriber

_Audit date: 2026-07-05, at commit `01b80a4`. Method: full-source scan (raw notes: [scan-notes.md](scan-notes.md)) plus targeted verification; all CRITICAL/HIGH findings were independently confirmed against the code. The full test suite (1,144 tests) and lint were run as part of the audit: both green._

## Executive summary

This is a healthy, unusually well-engineered repo. The architecture (process discipline, ports & adapters, Zod boundaries) is real and enforced, the test suite is large/fast/deterministic, CI mirrors the local gate, and documentation matches the code. The July 2026 architecture review was systematically worked off — a process most teams don't manage.

The audit found **three critical items**: one security incident (a committed API key in a public repo) and two functional bugs at seams the test suite doesn't reach (the Draft→DB handoff and meeting finalisation). None of them are symptoms of general sloppiness; all three are narrow gaps in otherwise disciplined patterns.

## Do these first

| #   | Finding                                                                                                                                                                                                                                                       | Where                                                                    | Report                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------- |
| 1   | **Revoke the Deepgram API key** committed as `deepgram.txt` (public repo, in history since `c2a8591`), then remove the file and harden the gitleaks config                                                                                                    | repo root                                                                | [05 §S1](05-security-privacy.md) |
| 2   | **Draft-screen agenda & participants are never persisted** — `agendaItem:add`/`participant:add` fabricate responses and write nothing, so prepared meetings run with an empty agenda/participant list in main (no routing, no owner matching, lost on reload) | `ipc-registry.ts:370-403`                                                | [03 §C1](03-code-quality.md)     |
| 3   | **Unguarded `inferContext` at meeting end** can leave a live meeting stranded in `state: 'live'`, and a retry then silently skips the entire final pass; the import path has the same hole with no retry at all                                               | `liveExtractionRuntime.ts:390-404`, `ImportSessionController.ts:231-236` | [03 §C2](03-code-quality.md)     |

## High

4. Span-forwarding loop is fire-and-forget; one thrown DB insert = unhandled rejection in main, mid-meeting, with no `unhandledRejection` backstop — [03 §C3](03-code-quality.md)
5. Realtime ASR reconnect retries forever with no auth-failure exit and nothing surfaced to the user — [03 §C4](03-code-quality.md)

## Medium (grouped)

- **Hardening:** no `setWindowOpenHandler`/`will-navigate` guards ([05 §S2](05-security-privacy.md)); model download hash check is a no-op ([03 §C6](03-code-quality.md)); PCM frame channels unvalidated ([05 §S3](05-security-privacy.md)).
- **Correctness-adjacent:** `meeting:start` is a fabricating stub ([03 §C5](03-code-quality.md)); no-key banner duplicates `keyRefs.ts` and covers 2 of 6 cases ([03 §C7](03-code-quality.md)).
- **Drift risk:** hand-written 15-way provider matrix in `settingsSchema.ts` ([03 §C9](03-code-quality.md)); preload casts instead of validating invoke responses ([03 §C8](03-code-quality.md)).
- **Tests:** no coverage measurement; `providerFactory`'s live-vs-import vendor fork lacks explicit matrix tests — and both critical bugs above lacked exactly the test that would have caught them ([04 §Q1–Q2](04-tests.md)).
- **Hygiene/roadmap:** `lint-output.txt` committed; `electron-updater` unused dep; no packaging config yet ([06 §T1–T3](06-tooling-ci-dependencies.md)).
- **Structure:** `LiveScreen.tsx` (1,179 LOC) needs the SettingsScreen treatment; `ipc-registry.ts` dependency surface; runtime's live-vs-import fork ([02 §A1–A3](02-architecture.md)).

## What's strong (preserve these)

- Electron security baseline locked in a tested pure factory; write-only secret IPC; DPAPI-encrypted keys; header-applied CSP; explicit permission handlers.
- 1,144 deterministic tests in ~20 s; fake providers + injected clock end-to-end; the native-ABI smoke test covering what Vitest structurally can't.
- CI = local gate, SHA-pinned actions, gated Dependabot auto-merge, CodeQL, secret scanning (with the one blind spot finding #1 exposed).
- Documentation↔code alignment: CONTEXT.md, 25 ADRs, CLAUDE.md all verified accurate. Comment culture that records _why_ and which bug motivated the code.

## Follow-up guide (for whoever picks this up)

Ground rules: one finding = one branch + PR (Conventional Commits via `/git-commit`), TDD per CLAUDE.md — every bug fix starts from the failing test named below, and the DoD gate (`npm run verify`) decides done. Each detailed report section contains a "Fix direction"; read it before starting.

| Item                           | Human or agent?                                                                                                                                  | Start with this failing test                                                                                                                                                                                   | Notes                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Deepgram key                | **Human first**: revoke the key in the Deepgram console. Agent after: `git rm deepgram.txt`, add a `.gitleaks.toml` rule for bare 40-hex strings | n/a (verify: `npm run secret-scan` flags a planted bare hex string)                                                                                                                                            | Do not start any other item before revocation is confirmed                                                                                                     |
| 2. Draft persistence (C1)      | Agent                                                                                                                                            | `ipc-registry.test.ts`: dispatch `agendaItem:add` with a `meetingId`, assert `agendaItemRepo.listByMeeting` returns it (same for `participant:add` and both removes)                                           | Requires adding `meetingId` to the request schemas in `shared/ipc.ts` — renderer call sites in `DraftScreen.tsx:154,191` must pass it                          |
| 3. Finalisation stranding (C2) | Agent                                                                                                                                            | `liveExtractionRuntime.test.ts`: fake provider whose `inferContext` rejects → `endMeeting` still runs the final pass and the meeting still ends; twin test in `ImportSessionController.test.ts` for `finish()` | Also decide `_endMeetingCalled` latch semantics (latch on success, or make the guard failure-aware)                                                            |
| 4. Span loop (C3)              | Agent                                                                                                                                            | `audioCaptureBridge.test.ts`: `onSpan` throws on one span → loop keeps draining, no unhandled rejection                                                                                                        | Add a process-level `unhandledRejection` devlog backstop in `index.ts` in the same PR — same failure domain                                                    |
| 5. Reconnect ceiling (C4)      | Agent                                                                                                                                            | `realtimeSpanStream.test.ts`: wire fails with 401 → stream stops retrying and surfaces a terminal state                                                                                                        | Coordinate with item 4 (adjacent code); land 4 first, keep the PRs separate                                                                                    |
| Mediums                        | Agent                                                                                                                                            | Per section; each "Fix direction" names the seam                                                                                                                                                               | C8 (preload validation) and Audit 02 A5 (generic invoke helper) are one job, do them together. C7: derive the banner from `keyRefs.ts`, delete the local logic |

Sequencing: 1 → 2 → 3 → 4 → 5, then mediums in any order. Items 2 and 3 are independent of everything else; nothing blocks on the structural items (A1–A3), which should each get their own ADR-style motivation if picked up.

## Reports

| File                                                           | Scope                                                                       |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [01-repo-overview.md](01-repo-overview.md)                     | Metrics, shape, toolchain, immediate red flags                              |
| [02-architecture.md](02-architecture.md)                       | Process model, ports & adapters, review follow-through, structural hotspots |
| [03-code-quality.md](03-code-quality.md)                       | Verified bugs, smells, duplication, positive patterns                       |
| [04-tests.md](04-tests.md)                                     | Suite health, coverage shape, gaps                                          |
| [05-security-privacy.md](05-security-privacy.md)               | Key leak, Electron hardening, secrets/egress design                         |
| [06-tooling-ci-dependencies.md](06-tooling-ci-dependencies.md) | Build, CI, native ABI, dependency hygiene                                   |
| [07-docs-conventions.md](07-docs-conventions.md)               | ADRs, glossary, README drift, i18n                                          |
| [scan-notes.md](scan-notes.md)                                 | Raw full-source scan notes (appendix, file:line detail)                     |
| [potential_features.md](potential_features.md)                 | Product feature ideas, ranked by architectural leverage                     |
