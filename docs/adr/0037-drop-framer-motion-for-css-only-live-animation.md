# ADR 0037 — Drop framer-motion for CSS-only Live-screen animation

**Status:** accepted (implemented 2026-07-06)
**Relates to:** audit finding T5 (framer-motion imported by one file) and A1 (LiveScreen size); ADR 0005 (renderer is UI-only)

## Problem statement

`framer-motion` (~40 kB+ of runtime dependency) was imported by exactly one file, `LiveScreen.tsx`, to drive four kinds of motion: item entrance (fade + slide-up), item exit (fade + collapse) on retraction, item reorder (`layout` FLIP), and height `0→auto` accordions (inline edit form, manual-add form, transcript pane) plus an add-bar crossfade. One screen paying a whole animation library — and it is the screen the A1 split is about to break into components, which would have spread the library across four new files.

Electron 42 ships Chromium ~138, where the CSS features that cover these cases are all available: `@starting-style` (entrance from a mount-time start state), `interpolate-size: allow-keywords` (transition `height` to/from the `auto` keyword), and `transition`.

## Decision

Remove `framer-motion` entirely and reimplement the motion that earns its keep in plain CSS (`app.css`):

- **Entrance** — `.live-item` transitions `opacity`/`transform`, with a `@starting-style` block providing the `opacity: 0; translateY(6px)` start. New items fade + slide up on arrival.
- **Accordions** — `.live-edit-form`, `.live-add-form`, `.live-transcript__pane` transition `height`/`opacity` from a `@starting-style { height: 0; opacity: 0 }`, enabled by `interpolate-size: allow-keywords` on `:root`.
- **Add-bar crossfade** — the buttons fade in via `@starting-style` when the inline form closes.
- A `prefers-reduced-motion: reduce` guard disables all of the above.

The framer `motion.*` elements become plain elements and the `AnimatePresence` wrappers are dropped; markup structure, `data-testid`s and roles are unchanged.

## What we deliberately gave up

**Exit animations and reorder (FLIP).** CSS can do exit with `transition-behavior: allow-discrete`, and reorder only with real effort, but we chose to drop both. In a live note-taker screen those read as noise: the note-taker scans, confirms and dismisses fast, and an item fading out or a list resmoothing itself costs attention we do not want to ask for. An arriving item earning a glance is the one piece of motion worth keeping. Retracted/removed items now disappear immediately; groups do not animate their reordering.

## Trade-offs

- **Fidelity vs. dependency weight.** We trade two animation behaviours for shedding a whole runtime dependency and its bundle. Given the behaviours we dropped were the low-value ones, this is a net win.
- **Modern-CSS floor.** `@starting-style` / `interpolate-size` require a recent Chromium. That is fine here because the renderer only ever runs inside our bundled Electron (ADR 0005), never an arbitrary browser, so the floor is ours to set. A reduced-motion fallback and the fact that these are progressive enhancements (no motion → content still fully present) keep it safe.
