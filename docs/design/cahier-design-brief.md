# Design brief: "Cahier"

Status: agreed direction, v1. Supersedes the "Precision Instrument" tokens in
`src/renderer/src/tokens.css`. Written for LiveTranscriber (see `CONTEXT.md` for
the domain vocabulary this brief leans on).

## One line

A working note-taker's notebook: warm ivory paper, drafted in pencil, committed
in ink. Calm to read, unmistakable when live.

## What we take from Moleskine, and what we refuse

We take the spirit of the **Cahier** line specifically: the cheap-on-purpose,
beat-it-up notebook. Kraft cardboard cover, visible stitched binding, an honest
surface meant to be written in hard rather than admired. Restraint, tactility,
trust in the blank page.

We refuse skeuomorphism outright. No paper photo-texture, no leather, no
page-curl shadows, no 3D stitching. Every notebook idea is translated into flat,
modern, functional UI. The grid earns its place by being structural; the only
physical motif we keep is a single quiet seam.

## The core idea: pencil and ink

A notebook has two marks. You draft in pencil, you commit in ink. LiveTranscriber
has two domain pairs that mean exactly that, so one metaphor carries both with no
extra colour:

| Domain pair (CONTEXT.md)              | Pencil (tentative)  | Ink (committed)           |
| ------------------------------------- | ------------------- | ------------------------- |
| Transcript: interim span / final span | pencil-gray, light  | inked solid               |
| Item: Proposed / Confirmed            | pencil-gray outline | inked solid, Myrtle check |

Dismissed items are struck through and fade (erased). Confirming literally inks
the mark in. An interim transcript span renders pencil-gray and darkens to ink in
place when it finalises, with no layout shift: the colour change is the commit.

## Palette

Light is the identity. A night variant ships later as an inversion; it is not the
primary surface.

```
Canvas (paper)        #F6F1E7   warm ivory, the base everywhere
Surface raised        #FBF7EF   cards, the right margin
Surface recessed      #ECE4D5   wells, inputs, code-ish blocks
Ink (text + action)   #1E1B17   body text, buttons, links, active nav
Pencil (tentative)    #9A9388   interim spans, proposed items, hints
Hairline / grid       rgba(30,27,23,0.06)   drawn grid and dividers

Kraft (identity)      #A6794C   wordmark, spine seam, decorative only
Myrtle (confirmed)    #2F4F3E   the Confirmed state, success
Ink-red (LIVE only)   #A8322D   recording signal, nothing else
```

Two hard rules, both fought for during design:

- **Kraft is identity, never interaction.** Brown on ivory is roughly 2.5:1; it
  fails as a button or link colour and fails WCAG. So Kraft carries the wordmark,
  the seam, and hairlines, and never anything clickable or anything that must be
  read. **Ink is the action colour:** solid ink fills for buttons, ink +
  underline for links, ink with a small Kraft tick for active nav.
- **Ink-red is sacred to "live".** Recording is the only thing allowed to be red.
  Destructive actions (delete a meeting, clear a transcript) use a plain ink
  button plus deliberate friction (hold-to-confirm or type-to-confirm), not
  colour. Deleting a meeting must never look like recording one.

Contrast sanity: ink on ivory ~14:1, Myrtle on ivory ~8:1, ink-red on ivory
~5:1, all pass. Pencil on ivory is intentionally low (~3:1); acceptable because
pencil text is transient and always resolves to ink, but pencil is never used for
information the user must act on while it stays pencil.

## Typography: three voices

- **Editorial serif for headings** (screen titles, Agenda Item headings): the
  "printed book" voice. Recommendation: **Fraunces** or **Newsreader**, used at
  18px and up so it never looks frail on Windows ClearType. Must carry Dutch
  diacritics cleanly.
- **Warm sans for body and chrome**: humanist, crisp at 13px. Recommendation:
  **IBM Plex Sans**.
- **Mono for data**: transcript spans, timestamps, IDs. Keep the existing mono
  instinct. Recommendation: **IBM Plex Mono** so sans and mono share a designer
  and harmonise.

A typewriter-on-paper read for the transcript is on-brand and wanted.

**Copy:** no em-dashes in UI text. Use a middle dot, a colon, or a comma instead
(`Notulen · Roadmap Q3`, not `Notulen — Roadmap Q3`). Holds for titles, labels,
and generated disclosure copy alike.

## Grid as paper, stabilised by mode

The drawn grid is a single hairline tint at ~6% alpha, never competing with
content. It is functional, not decorative, but it does not shift under a meeting
in progress:

- **Meeting work (Draft -> Live -> Review): dotted.** The floor stays put across
  the whole lifecycle of one meeting; only the content changes. Dotted is
  structure that does not shout, and transcript flows over it like handwriting
  over a dot-journal page.
- **Settings: squared.** Graph grid for the technical, form-dense surface.
  "Squared paper" reads as configuration, distinct from meeting work.

Wayfinding here is "am I working on a meeting, or configuring the app", not a
per-screen gimmick.

## Shell and layout

Top chrome for navigation and the egress badge, plus a thin Kraft seam down the
left edge as the only physical motif (decorative, the notional binding). The page
is bound left and written rightward, like a real notebook.

The chrome is identical on every in-meeting screen: wordmark, the
Concept / Live / Notulen nav, and the persistent egress badge. There is no login,
account, or marketing nav anywhere. This is a local desktop app (ADR 0003); the
only place data leaves the device is the egress the badge already discloses.

```
+=== chrome: wordmark    nav    egress badge ==============+
| s |  Agenda Item (serif)                                 |
| e |  transcript line                                     |
| a |  transcript line   ........ [pencil: Action] ....    |  <- right margin
| m |  transcript line                  marginalia         |
| | |  (dotted paper)                                       |
+===+======================================================+
 ^ left seam + live ink-red bleed off this edge when recording
```

- **Live signal: margin ink-bleed.** The page centre stays calm and readable.
  While recording, a thin ink-red wash bleeds in from the left seam edge and
  pulses faintly. Liveness lives at the edge, off the same binding the seam marks.
  This keeps Live legible and avoids a glaring white-then-red dashboard, and it
  keeps the screen from face-lighting the user on a video call.
- **Proposed items: marginalia.** Live Decisions and Actions appear as pencil
  notes in the **right** margin, aligned to the transcript line they were derived
  from, with a hairline leader back to the source span. This ties the domain (every
  item links to a transcript span, per CONTEXT.md) directly to the metaphor (a
  reader's notes in the margin). Confirm inks the note in and a Myrtle check
  appears; dismiss strikes it through and fades it out.

## Egress: deliberately literal, not cute

We considered styling the egress disclosure as a Moleskine "in case of loss /
return to" custody page with a postage-stamp mark for active egress. We rejected
it. A privacy disclosure (ADR 0003) must be unambiguous and never decorative;
being misread here actually harms the user. So the existing persistent
`EgressIndicator` badge stays a literal status chip, restyled in this palette and
nothing more: `[ audio via Deepgram . notulen via Anthropic ]`. The recording dot
on it follows the ink-red "live only" rule.

## Motion

- Interim -> final: pencil-gray darkens to ink in place, no layout shift.
- Confirm: pencil note darkens to ink and settles, Myrtle check fades in.
- Dismiss: quick strike-through, then fade out.
- Live: the margin ink-bleed pulses slowly while recording.

Reuse the existing motion tokens (`--duration-*`, `--ease-*`). We are repainting,
not rebuilding: the 4px spacing grid, radii, and motion stay.

## Open follow-ups

- Pick and bundle the three typefaces (offline Electron app, so self-host).
- Decide the night variant's exact inversion (charcoal notebook), later.
- Confirm the destructive-action friction pattern (hold vs type-to-confirm).
