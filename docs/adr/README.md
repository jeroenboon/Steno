# Architecture Decision Records

Each ADR captures one hard-to-reverse decision: the context, the choice, and the trade-offs we accepted. Read the relevant ADR before changing the area it covers.

## Numbering

The low numbers were assigned to match the original build items, so the sequence has gaps where a build item never produced a standalone decision record. Right now **0009** and **0016–0025** have no file, and the number does not always equal the build-item number (ADR 0013 covers item 0015, ADR 0015 covers item 0018). From **0026** onward the numbering is plain sequential: each new ADR takes the next free number.

So a missing number is expected, not a lost file. The directory currently runs to 0036.

## Index

| ADR                                                                              | Title                                                                              |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [0001](0001-electron-shell-with-onnx-local-asr.md)                               | Electron shell with local ASR via ONNX + DirectML (no Python)                      |
| [0002](0002-dual-stream-audio-capture.md)                                        | Dual-stream audio capture (microphone + system loopback)                           |
| [0003](0003-privacy-is-provider-dependent-with-explicit-egress.md)               | Privacy is provider-dependent, with explicit egress disclosure                     |
| [0004](0004-build-tooling-electron-vite-vitest.md)                               | Build tooling: electron-vite + Vitest                                              |
| [0005](0005-electron-security-baseline-and-process-discipline.md)                | Electron security baseline and process discipline                                  |
| [0006](0006-sqlite-hand-rolled-migrations-no-orm.md)                             | SQLite + hand-rolled forward-only migrations (no ORM)                              |
| [0007](0007-ports-and-adapters-provider-architecture.md)                         | Ports & Adapters provider architecture + deterministic testing                     |
| [0008](0008-extraction-loop-windowing-and-cadence.md)                            | Extraction loop: cadence, windowing, and pause-flush strategy                      |
| [0010](0010-anthropic-extraction-provider-model-selection-and-retry-strategy.md) | Anthropic ExtractionProvider: model selection and structured-output retry strategy |
| [0011](0011-deepgram-asr-adapter-raw-ws-interim-final-spans.md)                  | Deepgram ASR adapter: raw WebSocket, interim/final span model, bounded backoff     |
| [0012](0012-byo-provider-model-presets-and-openai-compatible-custom-endpoint.md) | BYO provider model: curated presets + OpenAI-compatible custom endpoint            |
| [0013](0013-audio-ipc-streaming-channels.md)                                     | Audio IPC streaming channels                                                       |
| [0014](0014-write-only-secret-ipc-renderer-never-reads-keys.md)                  | Write-only secret IPC: the renderer never reads API keys back                      |
| [0015](0015-live-extraction-runtime-lifecycle-and-ipc-event-design.md)           | Live extraction runtime: lifecycle binding and IPC event design                    |
| [0026](0026-audio-file-import-renderer-decode-and-asr-port-reuse.md)             | Audio file import via renderer decode and streaming ASR port reuse                 |
| [0027](0027-extraction-provider-protocol-discrimination.md)                      | Extraction provider protocol discrimination                                        |
| [0028](0028-asr-batch-first-no-shared-realtime-wire.md)                          | ASR is batch-first: no shared realtime wire, streaming deferred                    |
| [0029](0029-live-agenda-inference.md)                                            | Live agenda inference                                                              |
| [0030](0030-provider-connection-test-centralized-probe.md)                       | Provider "Test connection" is a centralized probe, not a per-adapter method        |
| [0031](0031-realtime-asr-resample-in-adapter.md)                                 | Realtime ASR resamples in the adapter; the capture contract stays 16 kHz           |
| [0032](0032-shared-realtime-span-stream-transport.md)                            | Shared realtime ASR transport: `RealtimeSpanStream`                                |
| [0033](0033-item-lifecycle-onproposed-seam.md)                                   | `ItemLifecycleService.onProposed` seam replaces the intercepting subclass          |
| [0034](0034-shared-extraction-engine-wire-seam.md)                               | Shared extraction engine behind an `ExtractionWire` seam                           |
| [0035](0035-final-pass-authoritative-meeting-notes.md)                           | The final pass produces the authoritative, deduplicated per-agenda notes           |
| [0036](0036-asr-terminal-state-surfaced-to-egress-indicator.md)                  | ASR terminal state surfaced end-to-end to the EgressIndicator                      |
| [0037](0037-drop-framer-motion-for-css-only-live-animation.md)                   | Drop framer-motion for CSS-only Live-screen animation                              |

When you add an ADR, add a row here (and take the next free number).
