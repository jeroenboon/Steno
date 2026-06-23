#!/usr/bin/env python3
"""Generate the full Steno brand kit from real Fraunces (Medium/500) outlines.

One source of truth for every mark. The word "Steno" is drawn as self-contained
vector outlines (no font dependency at render time) and dressed per variant.

The core idea (docs/design/cahier-design-brief.md, "pencil to ink"): the mark
moves left-to-right from a cool, sketched pencil grey (the listening / interim /
Proposed state) into solid warm Kraft ink (the committed / final / Confirmed
state). Colours track src/renderer/src/tokens.css:

    pencil #9A9388  ->  kraft #A6794C  ->  deep ink #86602F

Outputs (docs/design/):
    steno-logo.svg            hero wordmark, full sketch->ink texture
    steno-wordmark.svg        flat gradient wordmark (UI / chrome use)
    steno-wordmark-ink.svg    monochrome ink, transparent ground
    steno-wordmark-paper.svg  monochrome paper, for dark grounds
    steno-icon.svg            app icon: paper tile, seam, sketch->ink "S"
    steno-icon-dark.svg       app icon, charcoal-notebook night variant
    steno-favicon.svg         tightened "S" tile for tiny sizes

Requires fonttools (`pip install fonttools`) and the bundled Fraunces woff.
Run from the repo root:  python docs/design/generate-brand.py
"""
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / "node_modules/@fontsource/fraunces/files/fraunces-latin-500-normal.woff"
OUT = ROOT / "docs/design"

# --- palette (Cahier tokens) ------------------------------------------------
PENCIL = "#9A9388"
WARM = "#9C8B77"
KRAFT = "#A6794C"
DEEP = "#86602F"
INK = "#1E1B17"
PAPER = "#F6F1E7"
BORDER = "#D8CDB8"
PAPER_ON_DARK = "#C9C3B6"  # pencil grey lifted to read on charcoal

# --- pull outlines ----------------------------------------------------------
font = TTFont(str(FONT))
glyph_set = font.getGlyphSet()
cmap = font.getBestCmap()
hmtx = font["hmtx"]


def glyph_path(text: str, x0: float = 0.0) -> str:
    """SVG path data for `text` laid on the baseline (y=0), y-axis flipped to SVG."""
    x = x0
    parts = []
    for ch in text:
        g = cmap[ord(ch)]
        pen = SVGPathPen(glyph_set)
        glyph_set[g].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
        parts.append(pen.getCommands())
        x += hmtx[g][0]
    return " ".join(parts)


WORD = glyph_path("Steno")
ESS = glyph_path("S")

# laid-out ink boxes (font units), measured once via fontTools BoundsPen:
#   word: x 99..5361, y -1428..33      S: x 99..1104, y -1428..33
WX0, WX1 = 99, 5361
WORD_VB = "-130 -1660 5720 1940"
SX0, SX1, SY0, SY1 = 99, 1104, -1428, 33
S_W, S_H = SX1 - SX0, SY1 - SY0
S_CX, S_CY = (SX0 + SX1) / 2, (SY0 + SY1) / 2

SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg"'


def write(name: str, body: str) -> None:
    (OUT / name).write_text(body, encoding="utf-8")
    print(f"  {name} ({len(body)} bytes)")


# ---------------------------------------------------------------------------
# 1. Hero wordmark — full sketch->ink texture
# ---------------------------------------------------------------------------
def hero() -> str:
    d = WORD
    return f"""{SVG_OPEN} viewBox="{WORD_VB}" width="1144" height="388" role="img" aria-label="Steno">
  <title>Steno</title>
  <defs>
    <linearGradient id="ink" gradientUnits="userSpaceOnUse" x1="{WX0}" y1="0" x2="{WX1}" y2="0">
      <stop offset="0" stop-color="{PENCIL}"/>
      <stop offset="0.32" stop-color="{WARM}"/>
      <stop offset="0.62" stop-color="{KRAFT}"/>
      <stop offset="1" stop-color="{DEEP}"/>
    </linearGradient>
    <linearGradient id="fillRamp" gradientUnits="userSpaceOnUse" x1="{WX0}" y1="0" x2="{WX1}" y2="0">
      <stop offset="0" stop-color="#3a3a3a"/>
      <stop offset="0.30" stop-color="#6f6f6f"/>
      <stop offset="0.60" stop-color="#e2e2e2"/>
      <stop offset="0.85" stop-color="#ffffff"/>
    </linearGradient>
    <mask id="mFill"><rect x="-200" y="-1700" width="6200" height="2000" fill="url(#fillRamp)"/></mask>
    <linearGradient id="leftRamp" gradientUnits="userSpaceOnUse" x1="{WX0}" y1="0" x2="{WX1}" y2="0">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.32" stop-color="#cfcfcf"/>
      <stop offset="0.58" stop-color="#000000"/>
    </linearGradient>
    <mask id="mLeft"><rect x="-200" y="-1700" width="6200" height="2000" fill="url(#leftRamp)"/></mask>
    <pattern id="hatch" patternUnits="userSpaceOnUse" width="64" height="64" patternTransform="rotate(28)">
      <rect width="64" height="64" fill="none"/>
      <line x1="0" y1="0" x2="0" y2="64" stroke="#6f685c" stroke-width="9" stroke-linecap="round"/>
      <line x1="26" y1="0" x2="26" y2="64" stroke="#7d7669" stroke-width="6" stroke-linecap="round"/>
    </pattern>
    <filter id="grain" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.018 0.03" numOctaves="3" seed="7" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.27  0 0 0 0 0.25  0 0 0 0 0.21  0 0 0 0.9 0"/>
    </filter>
    <filter id="wobble" x="-12%" y="-12%" width="124%" height="124%">
      <feTurbulence type="fractalNoise" baseFrequency="0.011 0.014" numOctaves="2" seed="4" result="t"/>
      <feDisplacementMap in="SourceGraphic" in2="t" scale="34" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <clipPath id="glyphs"><path d="{d}"/></clipPath>
  </defs>
  <g clip-path="url(#glyphs)">
    <rect x="-200" y="-1700" width="6200" height="2000" fill="url(#ink)" mask="url(#mFill)"/>
  </g>
  <g clip-path="url(#glyphs)" mask="url(#mLeft)">
    <rect x="-200" y="-1700" width="6200" height="2000" fill="url(#hatch)" opacity="0.55"/>
    <rect x="-200" y="-1700" width="6200" height="2000" filter="url(#grain)" opacity="0.5"/>
  </g>
  <g mask="url(#mLeft)">
    <path d="{d}" fill="none" stroke="#6f675b" stroke-width="9" filter="url(#wobble)" opacity="1"/>
    <path d="{d}" fill="none" stroke="#8c8478" stroke-width="4" filter="url(#wobble)" opacity="0.75"/>
  </g>
</svg>
"""


# ---------------------------------------------------------------------------
# 2-4. Flat / monochrome wordmarks
# ---------------------------------------------------------------------------
def wordmark_flat() -> str:
    return f"""{SVG_OPEN} viewBox="{WORD_VB}" width="1144" height="388" role="img" aria-label="Steno">
  <title>Steno</title>
  <defs>
    <linearGradient id="ink" gradientUnits="userSpaceOnUse" x1="{WX0}" y1="0" x2="{WX1}" y2="0">
      <stop offset="0" stop-color="{PENCIL}"/>
      <stop offset="0.32" stop-color="{WARM}"/>
      <stop offset="0.62" stop-color="{KRAFT}"/>
      <stop offset="1" stop-color="{DEEP}"/>
    </linearGradient>
  </defs>
  <path d="{WORD}" fill="url(#ink)"/>
</svg>
"""


def wordmark_mono(fill: str, label: str) -> str:
    return f"""{SVG_OPEN} viewBox="{WORD_VB}" width="1144" height="388" role="img" aria-label="Steno">
  <title>Steno {label}</title>
  <path d="{WORD}" fill="{fill}"/>
</svg>
"""


# ---------------------------------------------------------------------------
# 5-7. Icons (1024 square tiles)
# ---------------------------------------------------------------------------
def _s_transform(target_h: float, cx: float, cy: float) -> str:
    s = target_h / S_H
    tx = cx - S_CX * s
    ty = cy + S_CY * -s  # S_CY is negative; place glyph centre at cy
    return f"translate({tx:.2f} {ty:.2f}) scale({s:.5f})"


def icon(dark: bool = False) -> str:
    tile = INK if dark else PAPER
    border = "#2b2722" if dark else BORDER
    g0 = PAPER_ON_DARK if dark else PENCIL
    stitch = INK if dark else PAPER
    seam_op = 0.9
    tform = _s_transform(650, 528, 512)
    # diagonal pencil->ink gradient bound to the S bounding box
    return f"""{SVG_OPEN} viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="Steno">
  <title>Steno</title>
  <defs>
    <linearGradient id="sg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{g0}"/>
      <stop offset="0.42" stop-color="{WARM if not dark else '#B9925F'}"/>
      <stop offset="0.72" stop-color="{KRAFT}"/>
      <stop offset="1" stop-color="{DEEP if not dark else '#A6794C'}"/>
    </linearGradient>
    <clipPath id="sclip"><path d="{ESS}"/></clipPath>
    <linearGradient id="sketch" gradientUnits="userSpaceOnUse" x1="{SX0}" y1="{SY0}" x2="{SX1}" y2="{SY1}">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.45" stop-color="#7a7a7a"/>
      <stop offset="0.7" stop-color="#000000"/>
    </linearGradient>
    <mask id="sketchMask"><rect x="{SX0}" y="{SY0}" width="{S_W}" height="{S_H}" fill="url(#sketch)"/></mask>
    <pattern id="hatch" patternUnits="userSpaceOnUse" width="60" height="60" patternTransform="rotate(28)">
      <line x1="0" y1="0" x2="0" y2="60" stroke="{'#6f685c' if not dark else '#8b8478'}" stroke-width="9" stroke-linecap="round"/>
    </pattern>
    <clipPath id="tileclip"><rect x="32" y="32" width="960" height="960" rx="224"/></clipPath>
  </defs>

  <rect x="32" y="32" width="960" height="960" rx="224" fill="{tile}"/>
  <g clip-path="url(#tileclip)">
    <!-- binding seam + stitches -->
    <line x1="120" y1="120" x2="120" y2="904" stroke="{KRAFT}" stroke-width="16" stroke-linecap="round" opacity="{seam_op}"/>
    <line x1="120" y1="120" x2="120" y2="904" stroke="{stitch}" stroke-width="5" stroke-dasharray="2 38" stroke-linecap="round"/>
    <!-- sketch -> ink S -->
    <g transform="{tform}">
      <path d="{ESS}" fill="url(#sg)"/>
      <g clip-path="url(#sclip)" mask="url(#sketchMask)">
        <rect x="{SX0}" y="{SY0}" width="{S_W}" height="{S_H}" fill="url(#hatch)" opacity="0.4"/>
      </g>
    </g>
  </g>
  <rect x="32.5" y="32.5" width="959" height="959" rx="223.5" fill="none" stroke="{border}" stroke-width="1"/>
</svg>
"""


def favicon() -> str:
    # Tighter, bolder, no hatch: a serif S goes delicate at 16px, so the favicon
    # keeps the pencil->ink hue but drops the pale end and fills dark enough to read.
    tform = _s_transform(820, 512, 512)
    return f"""{SVG_OPEN} viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="Steno">
  <title>Steno</title>
  <defs>
    <linearGradient id="sg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{KRAFT}"/>
      <stop offset="0.55" stop-color="{DEEP}"/>
      <stop offset="1" stop-color="#5e431f"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="1024" height="1024" rx="180" fill="{PAPER}"/>
  <rect x="78" y="150" width="14" height="724" rx="7" fill="{KRAFT}" opacity="0.85"/>
  <g transform="{tform}"><path d="{ESS}" fill="url(#sg)"/></g>
</svg>
"""


# ---------------------------------------------------------------------------
print("writing brand kit:")
write("steno-logo.svg", hero())
write("steno-wordmark.svg", wordmark_flat())
write("steno-wordmark-ink.svg", wordmark_mono(INK, "ink"))
write("steno-wordmark-paper.svg", wordmark_mono(PAPER, "paper"))
write("steno-icon.svg", icon(dark=False))
write("steno-icon-dark.svg", icon(dark=True))
write("steno-favicon.svg", favicon())

# App-consumed copies (single source of truth: regenerating updates these too).
print("writing app assets:")
(ROOT / "src/renderer/src/assets").mkdir(parents=True, exist_ok=True)
(ROOT / "src/renderer/src/assets/steno-wordmark.svg").write_text(wordmark_flat(), encoding="utf-8")
print("  src/renderer/src/assets/steno-wordmark.svg")
(ROOT / "src/renderer/public").mkdir(parents=True, exist_ok=True)
(ROOT / "src/renderer/public/steno-favicon.svg").write_text(favicon(), encoding="utf-8")
print("  src/renderer/public/steno-favicon.svg")
print("done.")
