# LiveTranscriber

A Windows desktop app (Electron + TypeScript + React) that transcribes live meetings and extracts structured Decisions and Actions in real time.

## Status

Work in progress. See [BACKLOG.md](BACKLOG.md) for the build plan and [CONTEXT.md](CONTEXT.md) for the domain vocabulary.

## Dev setup

```sh
npm install
npm run dev       # start in dev mode
npm run build     # production build
npm test          # run tests
npm run lint      # lint
npm run typecheck # type check
npm run format    # format (writes)
npm run format:check # format check (CI)
```

## Architecture

See [docs/adr/](docs/adr/) for recorded architecture decisions.
