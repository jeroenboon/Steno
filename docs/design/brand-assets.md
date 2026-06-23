# Steno brand assets

The wordmark is purely typographic: "Steno" set in **Fraunces Medium**, drawn as
self-contained vector outlines (no font needed at render time). It narrates the
"pencil to ink" rule from the [Cahier brief](cahier-design-brief.md): the mark
runs left to right from a cool, sketched pencil grey (listening / interim /
Proposed) into solid warm Kraft ink (committed / final / Confirmed).

Palette tracks `src/renderer/src/tokens.css`: pencil `#9A9388` → kraft `#A6794C`
→ deep ink `#86602F`, on ivory paper `#F6F1E7`.

## Files

| File                       | Use                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `steno-logo.svg`           | Hero wordmark, full sketch-to-ink texture (hatch, grain, wobbly contour). Large display only. |
| `steno-wordmark.svg`       | Flat gradient wordmark. The UI/chrome variant (texture muddies at small sizes).               |
| `steno-wordmark-ink.svg`   | Monochrome ink, transparent ground.                                                           |
| `steno-wordmark-paper.svg` | Monochrome paper, for dark grounds.                                                           |
| `steno-icon.svg`           | App icon: rounded paper tile, kraft binding seam, sketch-to-ink "S".                          |
| `steno-icon-dark.svg`      | App icon, charcoal-notebook night variant.                                                    |
| `steno-favicon.svg`        | Tightened, bolder "S" tile that stays legible at 16px.                                        |
| `raster/`                  | PNG renders: `icon-{256,512,1024}.png`, `favicon-{16,32,48}.png`.                             |

### Where the app consumes them

- Chrome wordmark: `src/renderer/src/assets/steno-wordmark.svg` (rendered by
  `src/renderer/src/components/Wordmark.tsx`).
- Document favicon: `src/renderer/public/steno-favicon.svg` (+ `favicon.ico`
  fallback), linked in `src/renderer/index.html`.
- Window / taskbar icon: `resources/icon.png`, imported in `src/main/index.ts`
  via electron-vite's `?asset` and passed to `createWindowOptions`.

These app copies are written by the generator, so they stay in sync.

## Regenerating

The SVGs are generated from the bundled Fraunces woff. The PNG/ICO raster step
is manual (needs a browser-grade SVG renderer for the gradients, masks, and
filters; the repo has no headless rasterizer dependency).

```sh
pip install fonttools
python docs/design/generate-brand.py   # rewrites every SVG + the two app copies
```

To re-render the rasters after an SVG change, open the icon/favicon SVGs in a
Chromium-based browser at the target pixel size and export with a transparent
background, then rebuild `favicon.ico` from the 16/32/48 PNGs and copy the 512px
icon to `resources/icon.png`.
