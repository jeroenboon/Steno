# Design brief: "Cahier"

Status: Final Master Specification. Supersedes the "Precision Instrument" tokens
and the earlier v1 of this brief. Written for LiveTranscriber (see `CONTEXT.md`
for the domain vocabulary this brief leans on).

## One line

A working note-taker's notebook: warm ivory paper, drafted in pencil, committed
in ink, and acted on with a Myrtle-green fountain pen. Calm to read,
unmistakable when live. An editorial, tactile workspace that feels like
compiling a beautifully typeset document in real time.

## What changed in the Final Master Spec

Two things moved from the v1 direction, both deliberate:

1. **Action colour: ink to Myrtle.** v1 made ink the action colour and reserved
   green for the Confirmed state. The Final Spec promotes **Myrtle green to the
   "Fountain Pen" action colour**: primary buttons, active nav, selected states.
   Confirming and acting are now one inked-green gesture. Ink steps back to the
   neutral/secondary role (body text, ghost outlines, destructive buttons). The
   old rule below is rewritten to match.
2. **Canvas: flat ivory to a watercolor wash.** The base is no longer a flat
   hex; it is a diffuse radial wash with a faint mossy pool at the foot, plus a
   barely-there paper grain. And the drawn grid inverts: meeting spaces go
   grid-free for calm, Settings alone keeps a faint pencil dot-grid.

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
Canvas (paper)        #F6F1E7   warm ivory, the solid base (fallback)
  wash crown          #FCF9F1   lightest, top-centre of the radial wash
  wash moss           rgba(47,79,62,0.08)   faint Myrtle pooling at the foot
Surface raised        #FBF7EF   cards, the right margin
Surface recessed      #ECE4D5   wells, inputs, code-ish blocks
Ink (text, neutral)   #1E1B17   body text, ghost outlines, destructive buttons
Pencil (tentative)    #9A9388   interim spans, proposed items, hints, dot-grid
Hairline / grid       rgba(30,27,23,0.06)   dividers

Kraft (identity)      #A6794C   wordmark, spine seam, live edge-breath
Myrtle (ACTION)       #2F4F3E   primary buttons, active nav, selected, Confirmed
Ink-red (LIVE only)   #A8322D   the recording dot in the top chrome, nothing else
```

Three hard rules:

- **Myrtle is the action colour (the "Fountain Pen").** Solid Myrtle fills with
  paper text for primary buttons; a Myrtle underline for active nav; Myrtle for
  selected states and the Confirmed checkmark. It is the same hue as the
  Confirmed state on purpose: to act and to confirm are one inked-green gesture.
  Myrtle on ivory is ~8:1, so it passes as a fill and as text. **Ink is the
  neutral/secondary colour:** body text, ghost-button outlines and labels, and
  destructive buttons (which lean on friction, not colour).
- **Kraft is identity, never interaction.** Brown on ivory is roughly 2.5:1; it
  fails as a button or link colour and fails WCAG. So Kraft carries the wordmark,
  the seam, hairlines, and the faint live edge-breath, and never anything
  clickable or anything that must be read.
- **Ink-red is sacred to "live".** Red is restricted to the recording dot in the
  top chrome and nothing else. In-page liveness uses a calm Kraft breath at the
  binding edge, not red. Destructive actions (delete a meeting, clear a
  transcript) use a plain ink button plus deliberate friction (hold-to-confirm),
  not colour. Deleting a meeting must never look like recording one.

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

## The canvas: a watercolor wash, grid only where it's technical

The base is not a flat hex. It is a diffuse radial wash, warm ivory at the crown
settling into a barely-there mossy hue at the foot, with a faint paper grain
(~3.5% alpha) layered over it. The warmth of a Studio Ghibli background with the
editorial restraint of a premium news platform. `--color-base` stays the solid
fallback; the wash and grain live on `body` so they never scroll.

The drawn grid then earns its place only where the surface is technical:

- **Meeting work (Draft -> Live -> Review) and the overview: no grid.** The wash
  is the only floor. Maximum calm for reading transcript and minding the margin.
- **Settings: a faint pencil dot-grid (~10% pencil).** The one place the grid
  appears, to signal "technical mode" on the form-dense configuration surface.

Wayfinding here is "am I working on a meeting, or configuring the app", not a
per-screen gimmick.

## Shell and layout

Top chrome for navigation and the egress badge, plus a thin Kraft seam down the
left edge as the only physical motif (decorative, the notional binding). The page
is bound left and written rightward, like a real notebook.

The chrome is identical on every in-meeting screen: wordmark left, the
Concept / Live / Notulen nav centred, and the persistent egress badge right.
There is no login, account, or marketing nav anywhere. This is a local desktop
app (ADR 0003); the only place data leaves the device is the egress the badge
already discloses.

**The chrome is borderless.** No hard divider under it. It sits on a gradient
veil that fades to transparent at its lower edge, so the content beneath reads as
one continuous page rather than a header bar bolted on top.

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

- **Live signal: a Kraft edge-breath.** The page centre stays calm and readable.
  Red is reserved for the recording dot in the chrome (see the hard rules), so
  in-page liveness is a faint **Kraft** wash that bleeds in from the left seam
  edge and pulses slowly while recording. Liveness lives at the edge, off the
  same binding the seam marks. This keeps Live legible, avoids a glaring
  white-then-red dashboard, and keeps the screen from face-lighting the user on a
  video call.
- **Proposed items: marginalia, joined by a leader.** Live Decisions and Actions
  appear as pencil notes in the **right** margin, horizontally aligned to the
  transcript paragraph they were derived from. A delicate, curved **dotted SVG
  leader** connects the source span to the margin item. This ties the domain
  (every item links to a transcript span, per CONTEXT.md) directly to the
  metaphor (a reader's notes in the margin). Confirm inks the note in (italic
  drops, a Myrtle check fades in, the leader recolours to Myrtle); dismiss
  strikes it through and fades it out. The leader needs JS measurement in a
  resizable window, so below ~980px the margin stacks under the transcript and
  the leaders hide.

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
- Live: the Kraft edge-breath pulses slowly while recording.
- Hold-to-confirm: a Myrtle progress bar fills the button left to right over
  1.5s; releasing early cancels and the fill retracts.

Reuse the existing motion tokens (`--duration-*`, `--ease-*`). We are repainting,
not rebuilding: the 4px spacing grid, radii, and motion stay.

## Open follow-ups

- Pick and bundle the three typefaces (offline Electron app, so self-host).
- Decide the night variant's exact inversion (charcoal notebook), later.
- Destructive-action friction: decided. **Hold-to-confirm** (press and hold 1.5s,
  Myrtle fill, cancels on early release), with a keyboard path (hold Enter/Space).
  Built as `HoldToConfirm`, wired into deleting a meeting.
- Marginalia leaders: **built.** A pure geometry core (`leaderGeometry.ts`) maps
  span/card rects to curved SVG paths; a thin overlay (`MarginLeaders.tsx`)
  measures the live layout and paints them, pencil by default and Myrtle once an
  item is confirmed. Hidden below 980px where the margin stacks. Still open:
  positioning cards to vertically align with their source span (with collision
  avoidance), so leaders stay short; today the cards keep their agenda grouping.

A standalone, high-fidelity reference of this spec lives at
`docs/design/cahier-prototype.html` (open in a browser).
