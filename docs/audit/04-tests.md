# Audit 04 — Test suite

## Verdict

The suite is large, fast, deterministic, and green: **1,144 tests in 92 files, all passing in ~20 s** (measured during this audit). The determinism rules (injected `Clock`, fake providers, mocked HTTP) are actually followed, not just documented. Gaps are narrow and mostly deliberate.

## Facts

- 92 test files / 118 non-test source files, colocated (`*.test.ts(x)` or `__tests__/`); 285 `describe` blocks, 1,144 test cases.
- Full run: 20.3 s wall clock under Vitest 3 (jsdom for renderer, node for main/shared). Fast enough that the pre-push hook running the whole suite is realistic — which is why it stays green.
- The Electron-runtime gap Vitest cannot cover is closed separately by `npm run test:native` (ABI smoke under `ELECTRON_RUN_AS_NODE`), wired into CI. This split is correct and documented.
- Timing-sensitive logic (scheduler cadence, reconnect backoff, hold-to-confirm) is tested against the injected `Clock`/fake timers — no real `setTimeout` waits, no network. Provider adapter tests mock the wire (HTTP/WS).
- Renderer tests use Testing Library with user-event; screens are tested through `window.api` fakes, keeping the process boundary honest in tests too.

## Coverage shape (what's tested from where)

Naïve "no adjacent test file" scanning is misleading here — screens are tested from `__tests__/`, `SettingsStore`/`settingsSchema` via `settings.test.ts`, the domain types via `domain.test.ts`, `appStore` via `store.test.ts`, `App` via `routing.test.tsx`. After resolving indirection, the genuinely untested-or-indirect-only surfaces are:

| Surface                                              | Status                                                 | Assessment                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/index.ts` (533 LOC)                        | Untested                                               | Composition root; the testable pieces were deliberately extracted (`window-options`, `csp`, `MeetingQueryService`, controllers). Remaining risk is wiring mistakes — exactly what `test:native` + manual runs catch. Acceptable, keep extracting logic out rather than trying to test it. |
| `providerFactory.ts` (374 LOC)                       | Indirect via `settings.test.ts` + `secret-ipc.test.ts` | The live-vs-import realtime/batch vendor fork lives here. Verify the fork matrix (each vendor × usage) is explicitly asserted somewhere; if not, it's the highest-value missing test in the repo.                                                                                         |
| `anthropicToolWire.ts` / `openAiJsonWire.ts`         | No direct tests; exercised only through adapter tests  | Fine if adapter tests pin the wire-level behaviours (auth header, JSON mode/tool-choice, error mapping). A direct wire test would localise failures better.                                                                                                                               |
| `wavEncoder.ts`, `batchAsrSupport.ts`                | Indirect via batch ASR adapter tests                   | WAV header math is classic off-by-one territory; one direct golden-bytes test would be cheap insurance.                                                                                                                                                                                   |
| `SherpaSession.ts`, `DefaultSherpaSessionFactory.ts` | Untested                                               | Thin native wrappers; unit tests would mock away the only thing that can break. `test:native` + `ModelDownloader.test.ts` cover the tractable parts. Acceptable.                                                                                                                          |
| `main/settings/egressState.ts` + `migrationUtils.ts` | Indirect                                               | Egress derivation is asserted through settings + renderer indicator tests; adequate.                                                                                                                                                                                                      |
| `AudioCaptureService.ts` (renderer)                  | Untested                                               | Wraps `getUserMedia`/`getDisplayMedia`/AudioWorklet — jsdom can't exercise it meaningfully. The extracted pure parts (`pcmFramer`, `pcmMixer`, `pcmResampler`, `audioStore`) are tested. Acceptable; this file is where manual smoke matters.                                             |
| `i18n/index.ts`                                      | Tested (`__tests__/i18n.test.ts`)                      | Type-level parity enforcement does most of the work.                                                                                                                                                                                                                                      |

## Findings

### Q1 — No coverage measurement (MEDIUM)

There is no `vitest --coverage` config or CI artifact. With 1,144 tests the suite _feels_ thorough, but the providerFactory question above can only be answered with data. Recommend: add `@vitest/coverage-v8`, publish the summary in CI (no threshold gate initially — thresholds invite gaming; visibility first).

### Q2 — The fork matrix in `providerFactory` deserves explicit tests (MEDIUM)

See table. Every "wrong provider built for usage X" bug ships silently past unit tests of the adapters themselves.

### Q3 — stderr noise in passing tests (LOW)

Passing runs print expected-error logs (e.g. `[ImportSessionController] Transcription failed: deepgram 401`). Harmless, but noise trains people to ignore output. Either assert-and-suppress via a spied logger or lower those paths to devlog.

### Q4 — No E2E/smoke of the real app (LOW, roadmap)

Everything below the Electron shell is well-tested; nothing drives the actual built app (Playwright-for-Electron or a scripted `npm run preview` smoke). Reasonable at this stage — `test:native` covers the historical failure mode — but worth adding once packaging (Audit 06 T3) exists, since packaged-build assumptions are currently untested by anything.

## What to keep

The testing culture here is the repo's backbone: TDD discipline shows in test-to-code ratio and in tests that assert behaviour (state transitions, emitted events, exact payloads) rather than implementation details. The fake-provider + injected-clock pattern means the whole live-meeting pipeline is testable end-to-end in milliseconds. Don't trade any of that for E2E glamour.
