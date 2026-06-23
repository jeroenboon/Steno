# Steno

A Windows desktop app (Electron + TypeScript + React) that transcribes live meetings and extracts structured Decisions and Actions in real time.

## Status

See [CONTEXT.md](CONTEXT.md) for the domain vocabulary and [CLAUDE.md](CLAUDE.md) for architecture and the engineering rules of engagement.

## Dev setup

```sh
npm install       # also rebuilds native deps for Electron (postinstall)
npm run dev       # start in dev mode
npm run build     # production build
npm test          # run tests
npm run test:native # load native modules under Electron (ABI gate)
npm run lint      # lint
npm run typecheck # type check
npm run format    # format (writes)
npm run format:check # format check (CI)
```

`better-sqlite3` is a native module and Vitest (system Node) and the app
(Electron) embed different Node ABIs, so the single compiled binary can't serve
both. Each command self-heals: `dev`/`preview`/`postinstall` swap it to the
Electron ABI, `test` swaps it to the Node ABI. If the app ever crashes at
startup with a `NODE_MODULE_VERSION` error, run `npm run rebuild:native`; if
tests hit it, run `npm run rebuild:native:node`. See CLAUDE.md for the detail.

## Architecture

See [docs/adr/](docs/adr/) for recorded architecture decisions.
