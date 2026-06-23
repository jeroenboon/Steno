# Steno

A Windows desktop app (Electron + TypeScript + React) that transcribes live meetings and extracts structured **Decisions** and **Actions** in real time. A note-taker monitors and corrects extracted items as they appear, producing meeting notes that stay actionable and linked to the original transcript.

## Features

- **Live transcription**: Choose between local Whisper (via sherpa-onnx, audio stays on device) or bring-your-own cloud ASR (Deepgram).
- **Real-time extraction**: Proposed Decisions and Actions appear as the meeting progresses, driven by a rolling extraction loop.
- **Structured notes**: Every extracted item links back to its transcript span, carries metadata (owner, due date, rationale), and is editable in real time.
- **Audio import**: Transcribe audio files directly; same pipeline as live capture.
- **Draft → Live → Ended lifecycle**: Meetings move through states; you set an optional agenda and participant list upfront, and review/export notes after the meeting ends.
- **Running summary**: Query what's been discussed so far during the meeting.
- **Discussion summaries**: Post-meeting, one summary per agenda item.
- **Graceful degradation**: Missing ASR or extraction keys don't crash the app; the app degrades to transcription-only or extraction-only as appropriate.

## Terminology

See [CONTEXT.md](CONTEXT.md) for the complete domain vocabulary: **Meeting**, **Decision**, **Action**, **Owner**, **Participant**, **ASR Provider**, **Extraction Provider**, and more. These terms are used consistently throughout the codebase.

## Architecture & Engineering

See [CLAUDE.md](CLAUDE.md) for architecture, process discipline (main vs renderer), ports & adapters, and the non-negotiable engineering principles. See [docs/adr/](docs/adr/) for recorded architecture decisions.

## Development

### Quick start

```sh
npm install       # installs deps + rebuilds native modules for Electron
npm run dev       # Electron dev mode with HMR
npm run build     # production build
npm test          # run all tests (Vitest)
npm run test:native # smoke test: load native modules under real Electron
npm run lint      # ESLint
npm run typecheck # TypeScript (both tsconfig.json and tsconfig.node.json)
npm run format    # Prettier (writes)
npm run format:check # Prettier (check, used in CI)
```

### Native module dual-ABI swap

`better-sqlite3` and `sherpa-onnx` are native modules. **Vitest runs on system Node; the Electron app bundles a different Node ABI.** One compiled binary cannot serve both; you get a `NODE_MODULE_VERSION` mismatch if you try. Each dev command self-heals by swapping in the right prebuilt binary:

- `npm run dev` / `npm run build` → Electron ABI
- `npm test` → system Node ABI
- `npm run test:native` → Electron ABI (loads `better-sqlite3` under the real Electron runtime)

If the app crashes at startup with a Node version error, run `npm run rebuild:native`. If tests fail with one, run `npm run rebuild:native:node`. This is handled automatically by the pre-hooks, but understanding it matters for troubleshooting. See [CLAUDE.md](CLAUDE.md) for detail.
