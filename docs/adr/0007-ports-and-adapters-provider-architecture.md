# ADR 0007 — Ports & Adapters provider architecture + deterministic testing

**Status:** Accepted
**Date:** 2026-06-14
**Item:** 0005

## Context

Two swappable components sit at the boundary between this app and the outside world:

- **ASR Provider** — turns audio into a transcript (local Parakeet ONNX or cloud Deepgram)
- **Extraction Provider** — turns a transcript into Decisions/Actions (cloud LLM in V1)

From the start, we committed to being able to swap ASR providers (principle #6, ADR 0001). If either provider's concrete type leaks into the domain or the extraction loop, that promise breaks.

Separately, the extraction loop and cadence logic are timing-driven. Tests that depend on real timers or real network are slow and flaky. We need a way to drive time and provider output deterministically (principle #11).

## Decision

**Ports:** `ASRProvider` and `ExtractionProvider` are TypeScript interfaces defined in `src/shared/providers/`. The domain core and extraction loop import only these interfaces — no vendor types anywhere in the domain.

**Adapters:** real implementations (Deepgram, Anthropic) live in `src/main/` and implement the interfaces. They are wired in at the app entry point, not in the domain.

**Boundary DTOs:** Zod schemas in `src/shared/providers/dtos.ts` define and validate what crosses the provider boundary. All LLM and ASR output is parsed through these schemas before entering the domain (principle #8).

**Fake providers:** `FakeASRProvider` and `FakeExtractionProvider` implement the interfaces using scripted in-memory data. Tests push scripted spans or responses; no real audio or network is involved.

**Injected Clock:** a `Clock` interface (`now(): number`) with a `RealClock` (delegates to `Date.now()`) and a `FakeClock` (only advances when `tick()` is called). The cadence logic (item 0008) will accept a `Clock` parameter; tests pass a `FakeClock` and advance it explicitly.

## ASR streaming model

`ASRProvider` uses a push-in / pull-out model:

- `start()` / `stop()` bracket the session
- `pushAudioFrame(chunk: Uint8Array)` feeds raw PCM
- `spans(): AsyncIterable<TranscriptSpan>` yields spans as they arrive

This shape fits both a WebSocket-based provider (Deepgram pushes results asynchronously, item 0011) and an ONNX-based local provider (Parakeet produces results synchronously per frame, item 0023). The extraction loop consumes the same iterator in both cases.

## Extraction request / response model

A single `extract(request: ExtractionRequest): Promise<ExtractionResponse>` method per turn. The `isFinalPass` boolean in the request distinguishes:

- **Rolling cadence:** extract Decisions and Actions from recent spans
- **Final pass (MeetingEnded):** same, plus per-Agenda-Item Discussion Summaries

The response includes `proposedDecisions`, `proposedActions`, and optionally `discussionSummaries`. All fields are Zod-validated before use.

## Why this is hard to reverse

Once real adapter code (Deepgram SDK types, Anthropic SDK types) is written to depend on a specific interface shape, changing the interface breaks all adapters simultaneously. The interface is effectively a public API contract across the team.

Changing the Clock abstraction after the extraction loop is built would require rewriting all cadence tests.

## Consequences

- No vendor imports appear outside `src/main/` adapter files
- All extraction-loop and cadence tests use `FakeExtractionProvider` + `FakeClock`; they run in milliseconds without network or timers
- The `ExtractionRequest` passes the full meeting context (agenda, participants, language) on every call, which is intentionally simple and stateless
- `FakeASRProvider` uses an async iterator with a waiter queue; tests that push scripted spans do not need to worry about timing
- The `isFinalPass` flag on `ExtractionRequest` is the only coupling between the extraction loop and the "final pass yields Discussion Summaries" behavior — the provider decides what to produce; the loop just sets the flag
