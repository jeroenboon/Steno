# Audit 03 — Code quality

_Method: a full-source scanning pass (raw notes with file:line detail in [scan-notes.md](scan-notes.md)), with every CRITICAL/HIGH finding independently re-verified against the source before inclusion here. Lint: clean (0 errors, 0 warnings). Type-safety escapes: 0 `@ts-expect-error`/`@ts-ignore`, 0 non-null assertions, 31 `eslint-disable` comments of which the large majority sit in one file (`sherpa/DefaultSherpaSessionFactory.ts`, wrapping an untyped native module — a legitimate, contained boundary). No real TODO/FIXME markers exist in the source._

## Verdict

The baseline quality is well above average: strict TypeScript with essentially zero escape hatches, consistent Zod boundaries, and idiom consistency across ~12 provider adapters. The findings that matter are not sloppiness but a handful of seams where the app's own "degrade, never crash" rule was applied inconsistently — and two of those are real product bugs.

---

## C1 — CRITICAL (bug): Draft-screen agenda & participants are never persisted

**Verified.** `agendaItem:add`, `participant:add` (and their `remove` counterparts) in `src/main/ipc-registry.ts:370-403` take no repo dependency: they Zod-parse the request, fabricate an id, and return the object. Nothing is written. `meeting:create` _does_ persist (`deps.meetingRepo?.insert`), which makes the gap easy to miss. The only code paths that insert agenda items/participants are the import flow and the LLM-inference paths (`inferredContextPersistence.ts`, `agendaProposalService.ts`).

**Consequence:** for the primary flow — a normally prepared meeting (Draft screen, typed agenda + participants, start) — main's DB contains no agenda and no participants. The renderer's own store masks it during the session (the UI shows what you typed), but:

- rolling-extraction routing (`routingContext()`, Confirmed-agenda-only per ADR 0029) sees an empty agenda;
- owner assignment has no Participant list to match against, so owners stay unset;
- after an app restart, `meeting:load` shows the meeting without its agenda/participants.

Ironically the _unprepared_ quick-start meeting gets better notes than a prepared one, because the end-of-meeting inference path fills the gap from the transcript.

**Fix direction:** give the four handlers the repos (same optional-dep pattern `meeting:create` uses) + a `meetingId` on the request (the IPC schema currently doesn't carry one — that's why the handlers _couldn't_ persist). Add the missing test: assert `agendaItemRepo.listByMeeting` after `agendaItem:add` dispatch.

## C2 — CRITICAL (bug): unguarded `inferContext` can strand a meeting at finalisation

**Verified.** `LiveExtractionRuntime.endMeeting` (`liveExtractionRuntime.ts:390-404`) sets `_endMeetingCalled = true` first, then `await this._inferContextOnEnd(meeting)` with no try/catch; the caller (`LiveSessionController.endMeeting:178-186`) only runs `finalizeMeetingEnd` (the Live → Ended transition) _after_ that await succeeds. So a single transient provider failure (429, timeout, expired key) at meeting end:

1. First attempt: rejection propagates → meeting stays `state: 'live'` in the DB.
2. Retry: the `_endMeetingCalled` guard returns immediately → the meeting is now marked Ended, but the final pass (Discussion Summaries, final items) **silently never ran**.

The import twin (`ImportSessionController.finish:231,236`) awaits `_inferAndPersistContext` and `_runFinalPass` outside its try/catch with no retry path at all. Every _rolling_ extraction turn handles provider failure gracefully (retry-degrade in `ExtractionEngine`); it's specifically the finalisation seam that trusts the network.

**Fix direction:** wrap `_inferContextOnEnd` in try/catch (degrade to no inferred context — the final pass still works), don't latch `_endMeetingCalled` until success or make the guard failure-aware, and add fake-provider rejection tests for both end paths.

## C3 — HIGH: span-forwarding loop is fire-and-forget with no error handling

**Verified.** `AudioCaptureBridge.start()` does `void this._forwardSpans()` (`AudioCaptureBridge.ts:76-111`); the `for await` body calls `this._onSpan?.(span)` — which includes the runtime's span persistence — and `_sender.send`. Any throw (one failed DB insert, a renderer gone mid-send) becomes an unhandled promise rejection; `index.ts` installs no `unhandledRejection` handler, and Electron's default for unhandled rejections in main can take down the app mid-meeting — the worst possible moment for a note-taking tool. **Fix:** try/catch inside the loop (log via devlog, keep draining), plus a process-level `unhandledRejection` handler as a backstop.

## C4 — HIGH: realtime reconnect has no ceiling and no auth-failure exit

`realtimeSpanStream.ts:197-238`: exponential backoff, but unbounded retries and no discrimination of permanent failures (401/403). A revoked key during a meeting means silent infinite reconnects; the user sees the transcript stop with no signal. Pairs badly with C3 (the span iterator just goes quiet). **Fix:** cap or escalate after N consecutive failures, and surface a state change the renderer can render (the EgressIndicator rail is a natural home).

## C5 — MEDIUM: `meeting:start` is a stub that fabricates its response

`ipc-registry.ts:412-434` returns a hard-coded `state: 'live'` meeting ("For now…" comment). Harmless today because `DraftScreen` discards the response and the real transition happens on `audio:start` — but it is a booby trap: any future caller that trusts the response gets fiction. Either wire it through `MeetingLifecycleService` or delete the channel.

## C6 — MEDIUM: model download hash verification is a no-op

`ModelDownloader.ts:57-61`: SHA-256 fields are placeholder empty strings, so integrity checking of the ~465 MB Whisper model download is documented but not performed. Fill in the real hashes; this is also a (mild) supply-chain item.

## C7 — MEDIUM: no-key banner logic duplicates (and disagrees with) `keyRefs.ts`

`App.tsx:105-116` hand-rolls "does the current config need a key?" for 2 of the 6+ provider combinations; `@shared/settings/keyRefs.ts` already answers this correctly for all of them. Classic drift bug: derive the banner from the shared module.

## C8 — MEDIUM: preload responses are cast, not validated

Every invoke in `src/preload/index.ts` returns `ipcRenderer.invoke(...) as Promise<Response>`. Push payloads get Zod re-validation renderer-side (`onValidated.ts`); invoke responses don't. Main is trusted code, so this is rule-consistency rather than security — but the project's own rule #7 says validate at every boundary, and the fix coincides with the generic-helper cleanup suggested in Audit 02 A5.

## C9 — MEDIUM: `settingsSchema.ts` hand-writes a 15-way provider matrix

`src/shared/settings/settingsSchema.ts:180-436`: per-provider config blocks with near-identical shapes maintained by hand; adding a vendor touches many parallel spots (schema, presets, factory, egress, disclosure, cards). Drift risk grows with each provider. Worth a small schema-builder helper or at least a checklist comment listing every place a new provider must touch.

## Lower-severity (detail in scan-notes.md)

- Decision/Action item schemas duplicated between `shared/ipc.ts` and the domain schemas instead of derived.
- `AnthropicExtractionProvider` `summarise`/`query` are copy-paste twins.
- PCM resampling math exists in two places (`shared/audio/pcmResampler.ts` and an adapter-local variant, ADR 0031 territory).
- ~13 near-identical `try { await window.api.x } catch { setError(...) }` blocks across `LiveScreen`/`ReviewScreen` — a `useApiCall` helper would collapse them (and shrink LiveScreen, see Audit 02 A1).
- No `db.close()` on app quit (WAL makes this benign in practice; still, a `before-quit` hook is one line).
- stderr noise from expected-failure paths in tests (Audit 04 Q3).

## Positive patterns worth naming

- Comment culture: file headers explain _why_, cite ADRs, and record the bug that motivated the code ("the item-0018 startup crash", "the agenda 2x bug"). This is the most navigable Electron codebase this auditor has seen at this size.
- Defensive idempotence at the right spots (e.g. the runtime re-filters provider-echoed agenda titles rather than trusting the engine — `liveExtractionRuntime.ts:465-475`).
- Zero `any` leakage outside the one native-module wrapper, under `strictTypeChecked` — rare.
