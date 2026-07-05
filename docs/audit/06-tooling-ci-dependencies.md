# Audit 06 — Tooling, CI & dependencies

## Verdict

This is the strongest area of the repo. The build/test/CI chain is unusually well thought out for a project this size, and the hard problem (dual-ABI native modules) is solved with self-healing hooks plus a real Electron-runtime smoke test. Findings here are mostly hygiene-level.

## What's good

- **CI mirrors the local gate exactly.** `npm run verify` = typecheck → lint → format:check → build → test → test:native → audit; `ci.yml` runs the same steps in the same cheap-first order on `windows-latest` (the target OS, which is the only OS where the native ABI trap is real). Concurrency cancellation, 30-min timeout, read-only `permissions: contents: read`.
- **Actions are pinned to full commit SHAs** with version comments, and Dependabot's `github-actions` ecosystem keeps the pins current. This is above-baseline supply-chain hygiene.
- **The dual-ABI native story** (`scripts/rebuild-native.mjs` + `pre*` hooks + `scripts/smoke-electron-native.mjs`) is the correct answer to a trap that once shipped a startup crash past a green suite. `test:native` loads better-sqlite3 under `ELECTRON_RUN_AS_NODE` — the check Vitest structurally cannot perform. The script degrades gracefully for modules without `binding.gyp`.
- **Security job split** onto cheap Linux: `npm audit --audit-level=high` + gitleaks over full history (`fetch-depth: 0`). A local mirror exists (`scripts/secret-scan.mjs`) that fails loudly when gitleaks is absent rather than passing silently.
- **CodeQL** runs on PR, push, and weekly cron. Advisory (per repo memory: promotion to required check is still pending — do that).
- **Dependabot** grouped weekly updates; auto-merge is gated behind the required DoD checks. The `pull_request_target` workflow is written safely (actor check, never checks out PR code, only calls `gh pr merge --auto`).
- **Husky pre-push** runs the fast half of the gate (typecheck · lint · format · test) and documents the escape hatch.
- **Lockfile committed, npm version pinned in CI** to match the lockfile (with a comment explaining the @emnapi resolution quirk), Electron binary cached.
- `npm audit`: **0 vulnerabilities** at audit time.

## Findings

### T1 — `lint-output.txt` committed to the repo (MEDIUM, hygiene)

A UTF-16 lint log (capturing a then-current lint error) is tracked in git. `.gitignore` already anticipates `test-output.txt` but not this one. **Fix:** `git rm lint-output.txt`, add `*-output.txt` (or `lint-output.txt`) to `.gitignore`.

### T2 — `electron-updater` is a dependency but never imported (MEDIUM)

`grep` finds no usage in `src/` or `scripts/`. Dead runtime dependency = wasted install weight and attack surface. Either wire up auto-update (see potential_features.md) or remove it until needed. Violates rule #14 (keep deps minimal).

### T3 — No packaging/distribution config exists (MEDIUM, roadmap)

`electron-builder` is a devDependency but there is no `electron-builder.yml` / `build` key in `package.json`. The app currently only runs via `npm run dev` / `preview`. Fine for the current phase, but several documented assumptions ("no-op in a packaged build", devlog init) are untested until a packaged build exists. When packaging lands, note that native modules will need `asarUnpack` and the ABI-swap interplay with `electron-builder install-app-deps` is already documented as a known hazard in CLAUDE.md.

### T4 — Build-time tools sit in `dependencies` (LOW)

`tailwindcss`, `autoprefixer` (and arguably the `@fontsource/*` packages, which Vite bundles) are runtime `dependencies`. Vite processes all of these at build time; in a packaged app they'd be dead weight (electron-builder ships `dependencies`). Move to `devDependencies` before packaging.

### T5 — `framer-motion` imported by exactly one file (LOW)

Only `LiveScreen.tsx` uses it. ~40 kB+ of animation library for one screen. Not wrong, but worth checking whether CSS transitions cover the actual usage before packaging.

### T6 — Lint gate tolerates warnings (LOW)

`react-hooks/exhaustive-deps` and `import/order` are `warn`, and `npm run lint` has no `--max-warnings 0`. The DoD gate says "zero lint errors", so this is consistent — but warnings can accumulate invisibly. Consider `--max-warnings 0` once the current count is zero, especially for `exhaustive-deps` (whose violations are real bugs more often than style).

### T7 — Zod pinned exact, everything else caret (NIT)

`"zod": "4.4.3"` is the only exact pin among carets. If deliberate (Zod 4 minor churn), document it with a one-line comment or in an ADR; otherwise align it.

### T8 — `overrides` block for @emnapi (NIT, watch item)

The three `@emnapi` overrides pin transitive wasm-fallback deps. These have a habit of breaking `npm ci` on npm version drift (already documented in ci.yml). Revisit whether the overrides are still needed at each major toolchain bump.

## Config quality notes

- ESLint: flat config, `strictTypeChecked` + `stylisticTypeChecked` with type-aware parsing over both tsconfigs, `no-explicit-any: error`. Strong; matches rule #6.
- Two tsconfig projects (`tsconfig.node.json` main/preload/shared, `tsconfig.web.json` renderer) with `typecheck` running both. The gitignored preview harness is correctly excluded from the lint project.
- Prettier config matches the documented conventions (no semicolons, single quotes, 100 cols, LF); `.editorconfig` and `.gitattributes` present.
