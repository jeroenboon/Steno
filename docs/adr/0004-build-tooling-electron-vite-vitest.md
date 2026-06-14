# Build tooling: electron-vite + Vitest

The project uses **electron-vite** as the build system and **Vitest** as the test runner.

## Considered options

- **electron-vite (chosen):** Purpose-built Vite wrapper for Electron that handles the three-process split (main, preload, renderer) out of the box. Hot-reload in dev, TypeScript-first, path aliases work across all three processes without extra config.
- **electron-forge + webpack:** The "official" starter, but webpack config overhead is substantial and slower to iterate on.
- **Create React App / Vite + manual Electron wiring:** More control but requires hand-rolling the main/preload/renderer build split every time.

- **Vitest (chosen):** Vite-native, runs tests through the same transform pipeline as the source. Zero config for path alias resolution (`@shared/*` just works). `jsdom` environment covers component tests later.
- **Jest:** Would require a separate Babel/ts-jest transform chain that duplicates Vite config. The two configs diverging is a recurring maintenance trap on Vite projects.

## Consequences

**Lock-in:** electron-vite's config file (`electron.vite.config.ts`) wraps Vite's config format. Migrating away means rewriting build config for all three processes. This is real but acceptable: electron-vite tracks Vite closely and the project is unlikely to outgrow it.

**Path aliases** (`@shared/*`) are declared once in `electron.vite.config.ts`, mirrored in both tsconfigs, and mirrored in `vitest.config.ts`. Three places to keep in sync when adding aliases -- accepted cost of the multi-project TypeScript structure electron-vite requires.

**Test environment:** Vitest runs with `environment: jsdom` globally. Main-process code that runs in Node does not need a DOM, but running it in jsdom doesn't break anything. If main-process tests need Node-specific APIs we can override per-file with `@vitest-environment node`.
