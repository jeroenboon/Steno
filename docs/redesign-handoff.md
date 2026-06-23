# Handoff: finalize the Cahier redesign

Goal for the next session: **finish the "Cahier" Final Master Spec redesign** and
land the in-flight rebrand. Context, decisions, and the design system already
exist in the repo, so this doc only covers what's left and where things stand.

## Read these first (don't re-derive)

- **Spec**: `docs/design/cahier-design-brief.md` (Final Master Spec). Its "Open
  follow-ups" section is the live to-do list for the design system.
- **Prototype**: `docs/design/cahier-prototype.html` (open in a browser) — the
  agreed visual target for every screen.
- **Tokens / styles**: `src/renderer/src/tokens.css`, `src/renderer/src/app.css`.
- **What already shipped** (3 atomic commits on `master`, all behind the full DoD
  gate — build, 766 tests incl. `npm run test:native`, lint, typecheck, prettier):
  - `21573e9` repaint to Final Master Spec (Myrtle = action colour, watercolor
    wash, borderless chrome, grid inversion, red restricted to the chrome dot).
  - `c94fe27` `HoldToConfirm` + wired into deleting a meeting.
  - `d811506` marginalia leaders (`leaderGeometry.ts` pure core + `MarginLeaders.tsx`).

## Working-tree state (important)

There is a **separate, pre-existing rebrand effort** sitting uncommitted in the
tree — it predates this redesign work and was deliberately left alone. Do not
fold it into design commits. It is one coherent "LiveTranscriber → Steno" change:

- Modified: `src/renderer/src/App.tsx`, `src/renderer/src/i18n/index.ts` (only
  `app.name: 'Steno'`), `src/main/index.ts`, `src/main/window-options.ts(.test.ts)`,
  `src/renderer/index.html`, `.claude/settings.json`.
- New: `src/renderer/src/components/Wordmark.tsx(.test.tsx)`, `src/renderer/src/assets/`,
  `src/renderer/public/`, `resources/`, `src/main/env.d.ts`, the `docs/design/steno-*.svg`
  brand assets, `docs/design/generate-brand.py`, `docs/design/brand-assets.md`.
- Deleted: `.github/workflows/ci.yml`, `docs/design/screen{1,2,3}.jpg`.

Note `.github/workflows/ci.yml` is staged for deletion — confirm with the user
whether CI is moving elsewhere before committing that; CLAUDE.md says CI must
mirror the DoD gate (rule #13).

## What "finalize" still needs

1. **Commit the rebrand** above as its own atomic commit(s) (use `/git-commit`).
   Verify `app.name`, window title, wordmark, favicon, and icons all read "Steno".
2. **Marginalia leaders — spatial alignment (the main open design item).** Today
   cards keep their agenda grouping, so a card and its source span aren't
   vertically aligned and a leader can run a long distance. The spec wants cards
   positioned next to their source span with collision avoidance. This is a real
   UX trade-off (spatial order vs agenda grouping) — **confirm the direction with
   the user before building** (see the brief's open follow-up). The geometry core
   already exists; this is a LiveScreen layout change.
3. **Fraunces Medium (500) for headings.** Only the 600 weight `.woff` is bundled
   (seen in the build output), so titles render at 600; the spec asks for 500.
   Bundle the 500 weight via the brand generator, or accept 600 and update the spec.
4. **Visual pass in the real app**: `npm run dev`, start a meeting, confirm an
   item to watch the leader and card ink pencil→Myrtle. Check the wash, borderless
   chrome, Settings dot-grid, and hold-to-confirm delete on Home. Use `/run` or
   `/verify`.
5. **Night variant** (charcoal notebook) is explicitly deferred in the spec — only
   if the user asks.

## House rules that bit me (so they don't bite you)

- **Native ABI dual-swap**: `npm test` leaves better-sqlite3 on the Node ABI; the
  app needs the Electron ABI. The pre-hooks self-heal, and `npm run test:native`
  is the gate that catches mismatches. Don't have `npm run dev` running during a
  test/native swap (it locks the binary). See CLAUDE.md.
- **Commit messages with quotes**: the PowerShell here-string mangled `-m` with
  embedded quotes. Write the message to a temp file and `git commit -F` instead.
- **jsdom has no layout** (`getBoundingClientRect` returns zeros, no
  `ResizeObserver`/`matchMedia`). Keep layout logic in pure functions (see
  `leaderGeometry.ts`) and stub per-element rects + fire a resize in component
  tests (see `MarginLeaders.test.tsx`).
- **Lint**: `@typescript-eslint/restrict-template-expressions` forbids bare
  numbers in template literals — wrap in `String()`.
- Run `format` / `format:check` **last** in the DoD gate.

## Suggested skills for the next session

- `/git-commit` — for the rebrand commit and any further atomic commits.
- `/tdd` — red-green-refactor for the spatial-alignment layout work.
- `/run` or `/verify` — drive the app to confirm the redesign visually.
- `AskUserQuestion` — to confirm the spatial-alignment direction (and the CI
  deletion) before building, since both are genuine trade-offs.
