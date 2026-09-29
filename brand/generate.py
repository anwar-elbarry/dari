"""Generates the RiadTax logo files. Run: python3 generate.py (needs fonttools).

Concept: an orange "R" shaped like a riad door (horseshoe arch on top, shield base) that holds a check
mark and three rising bars: "your property is in order, and the numbers add up".
Wordmark: "Riad" white (or near-black on light backgrounds) + "Tax" orange, tagline "Legal & Tax Compliance".
The text is converted to outlines (Liberation Sans Bold, SIL Open Font License) so it renders the same
everywhere, without depending on installed fonts.
"""
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ORANGE = '#ff8a1e'       # logo orange (brand-500 in the web app)
ORANGE_DEEP = '#ff5a00'  # gradient end
ORANGE_DARK = '#c2500a'  # brand-600: buttons, links (4.7:1 on white)
NIGHT = '#0f0f10'        # dark background / wordmark on light
INK = '#1c1917'          # stone-900 in the web app
WHITE = '#ffffff'

BOLD = TTFont('/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf')
REG = TTFont('/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf')


def text_path(text: str, x: float, baseline: float, size: float, tracking: float = 0, font=BOLD):
    """SVG path data for `text`, and the x where it ends."""
    glyphs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font['head'].unitsPerEm
    scale = size / upm
    parts = []
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
        parts.append(pen.getCommands())
        x += glyphs[name].width * scale + tracking
    return ' '.join(parts), x - tracking


GRADIENT = f'''<linearGradient id="rt-g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{ORANGE}"/>
      <stop offset="1" stop-color="{ORANGE_DEEP}"/>
    </linearGradient>'''


def mark(x=0, y=0, s=64, fill='url(#rt-g)', panel=NIGHT, check=WHITE, bars=ORANGE):
    """64-unit mark: an R-shaped door/shield holding a check mark and three bars."""
    k = s / 64
    return f'''<g transform="translate({x} {y}) scale({k})">
    <path d="M8 22 A24 24 0 0 1 56 22 V27 A17 17 0 0 1 39 44 H35 L54 62 H20 A12 12 0 0 1 8 50 Z M21 18 V33 H37.5 A7.5 7.5 0 0 0 37.5 18 Z" fill="{fill}" fill-rule="evenodd"/>
    <path d="M8 50 V37 H30 V62 H20 A12 12 0 0 1 8 50 Z" fill="{panel}"/>
    <path d="M13.5 44 L17 47.5 L24.5 40" fill="none" stroke="{check}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M13 58 V54 M19 58 V50 M25 58 V46" fill="none" stroke="{bars}" stroke-width="3.6" stroke-linecap="round"/>
  </g>'''


def svg(w, h, body, bg=None, title='RiadTax', defs=GRADIENT):
    rect = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}">
  <title>{title}</title>
  <defs>
    {defs}
  </defs>
  {rect}{body}
</svg>
'''


def lockup(riad_fill, tax_fill, tagline_fill, name, bg=None, **mark_kw):
    size, baseline, gap = 40, 40, 16
    riad, end = text_path('Riad', 64 + gap, baseline, size, tracking=-0.6)
    tax, end = text_path('Tax', end + 0.5, baseline, size, tracking=-0.6)
    tag, tag_end = text_path('Legal & Tax Compliance', 64 + gap + 1, 58, 13.2, tracking=1.1, font=REG)
    w = round(max(end, tag_end) + 6)
    body = mark(**mark_kw) + f'\n  <path d="{riad}" fill="{riad_fill}"/>\n  <path d="{tax}" fill="{tax_fill}"/>\n  <path d="{tag}" fill="{tagline_fill}"/>'
    open(f'riadtax-{name}.svg', 'w').write(svg(w, 64, body, bg))
    return w


# Mark on its own: app icon, favicon, avatars (dark tile so the orange reads on any surface).
tile = '<rect width="64" height="64" rx="14" fill="%s"/>' % NIGHT
open('riadtax-icon.svg', 'w').write(svg(64, 64, tile + mark(x=6, y=4, s=52)))
open('riadtax-icon-mono.svg', 'w').write(svg(64, 64, mark(fill=NIGHT, panel=WHITE, check=NIGHT, bars=NIGHT), defs=''))

lockup(WHITE, ORANGE, '#d6d3d1', name='logo-dark', bg=None)
lockup(INK, ORANGE_DARK, '#57534e', name='logo', bg=None)
lockup(INK, INK, INK, name='logo-mono', fill=NIGHT, panel=WHITE, check=NIGHT, bars=NIGHT)
print('ok')
