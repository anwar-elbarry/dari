"""Generates the RiadTax logo files. Run: python3 generate.py (needs fonttools).

Concept: a Moroccan horseshoe arch (the riad door) holding a check mark: "your property is in order".
The wordmark is converted to outlines (Liberation Sans Bold, SIL Open Font License) so it renders
the same everywhere, without depending on installed fonts.
"""
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

TEAL = '#1f6f6a'      # brand-600 in the web app
TEAL_DARK = '#134541' # brand-800
CLAY = '#c2663d'      # clay-500
CLAY_LIGHT = '#e3895f'
CREAM = '#fbf7f2'
NIGHT = '#10231f'

FONT = TTFont('/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf')
GLYPHS = FONT.getGlyphSet()
CMAP = FONT.getBestCmap()
UPM = FONT['head'].unitsPerEm
KERN = None


def text_path(text: str, x: float, baseline: float, size: float, tracking: float = 0):
    """SVG path data for `text`, and the x where it ends."""
    scale = size / UPM
    parts = []
    for ch in text:
        name = CMAP[ord(ch)]
        pen = SVGPathPen(GLYPHS)
        GLYPHS[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
        parts.append(pen.getCommands())
        x += GLYPHS[name].width * scale + tracking
    return ' '.join(parts), x - tracking


def icon(x=0, y=0, s=64, bg=TEAL, door=CREAM, check=CLAY):
    """64-unit icon: rounded tile, horseshoe-arch door, check mark."""
    k = s / 64
    return f'''<g transform="translate({x} {y}) scale({k})">
    <rect width="64" height="64" rx="14" fill="{bg}"/>
    <path d="M17 56 V30 A16 16 0 1 1 47 30 V56 Z" fill="{door}"/>
    <path d="M24 39.5 L30 45.5 L40.5 32.5" fill="none" stroke="{check}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>'''


def svg(w, h, body, bg=None, title='RiadTax'):
    rect = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}">
  <title>{title}</title>
  {rect}{body}
</svg>
'''


def lockup(word_riad, word_tax, tile=TEAL, door=CREAM, check=CLAY, bg=None, name='logo'):
    size, baseline, gap = 44, 47, 18
    riad, end = text_path('Riad', 64 + gap, baseline, size, tracking=-0.4)
    tax, end = text_path('Tax', end + 1, baseline, size, tracking=-0.4)
    w = round(end + 6)
    body = icon(bg=tile, door=door, check=check) + f'\n  <path d="{riad}" fill="{word_riad}"/>\n  <path d="{tax}" fill="{word_tax}"/>'
    open(f'riadtax-{name}.svg', 'w').write(svg(w, 64, body, bg))
    return w


open('riadtax-icon.svg', 'w').write(svg(64, 64, icon()))
open('riadtax-icon-mono.svg', 'w').write(svg(64, 64, icon(bg=TEAL_DARK, door='#ffffff', check=TEAL_DARK)))
lockup(TEAL_DARK, CLAY, name='logo')
lockup(CREAM, CLAY_LIGHT, tile=TEAL, bg=None, name='logo-dark')
lockup(TEAL_DARK, TEAL_DARK, tile=TEAL_DARK, door='#ffffff', check=TEAL_DARK, name='logo-mono')
print('ok')
