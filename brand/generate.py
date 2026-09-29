"""Generates the RiadTax logo files (concept 1, "Badge R"). Run: python3 generate.py (needs fonttools).

Mark: a bold lime R with a dark badge locked on the foot of the stem. The badge holds a white
check mark and three rising orange bars: "the property is in order, and the numbers add up".
Wordmark: "Riad" white (ink on light backgrounds) + "Tax" lime, tagline "Legal & Tax Compliance".
Text is converted to outlines (Liberation Sans, SIL Open Font License): no font needed.
On dark backgrounds the badge sits in a ring of the background colour. On white the lime R would vanish
(1.2:1), so the light lockup sets the mark on a night tile, like the app icon.
"""
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

LIME = '#e4f222'         # brand lime (logo, highlights, primary fills; always with dark text)
LIME_DEEP = '#b9cc00'    # gradient end
OLIVE = '#5c6600'        # "Tax" and links on light backgrounds (6.3:1 on white)
NIGHT = '#0f0f10'        # dark background, badge
INK = '#202020'          # wordmark on light backgrounds
WHITE = '#ffffff'

BOLD = TTFont('/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf')
REG = TTFont('/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf')

# Mark geometry, 64 x 64 units. Keep in sync with apps/web/components/logo.tsx.
R_PATH = 'M8 62 V6 H36 A17 17 0 0 1 43.5 38.4 L58 62 H43 L31 42 H23 V62 Z M23 19 V29 H36 A5 5 0 0 0 36 19 Z'


def text_path(text, x, baseline, size, tracking=0.0, font=BOLD):
    glyphs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font['head'].unitsPerEm
    k = size / upm
    parts = []
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(TransformPen(pen, (k, 0, 0, -k, x, baseline)))
        parts.append(pen.getCommands())
        x += glyphs[name].width * k + tracking
    return ' '.join(parts), x - tracking


GRADIENT = (f'<linearGradient id="rt-g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="64" y2="64">'
            f'<stop offset="0" stop-color="{LIME}"/><stop offset="1" stop-color="{LIME_DEEP}"/></linearGradient>')


def mark(bg, x=0, y=0, s=64, r_fill='url(#rt-g)', badge=NIGHT, check=WHITE, bars=LIME):
    """Badge R. `bg` is the colour behind the mark (the badge's ring)."""
    k = s / 64
    return f'''<g transform="translate({x} {y}) scale({k:.4f})">
    <path d="{R_PATH}" fill="{r_fill}" fill-rule="evenodd"/>
    <rect x="3" y="36" width="28" height="28" rx="8" fill="{bg}"/>
    <rect x="5.5" y="38.5" width="23" height="23" rx="6" fill="{badge}"/>
    <path d="M10.5 47 L15 51.5 L24 42.5" fill="none" stroke="{check}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M11 58.5 V56 M17 58.5 V54 M23 58.5 V51.5" fill="none" stroke="{bars}" stroke-width="2.8" stroke-linecap="round"/>
  </g>'''


def svg(w, h, body, title='RiadTax', defs=GRADIENT):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}">\n'
            f'  <title>{title}</title>\n  <defs>{defs}</defs>\n  {body}\n</svg>\n')


def lockup(name, bg, riad_c, tax_c, tag_c, tiled=False, **mark_kw):
    riad, end = text_path('Riad', 80, 40, 40, tracking=-0.6)
    tax, end = text_path('Tax', end + 0.5, 40, 40, tracking=-0.6)
    tag, tag_end = text_path('Legal & Tax Compliance', 81, 58, 13.2, tracking=1.1, font=REG)
    w = round(max(end, tag_end) + 4)
    head = (f'<rect width="64" height="64" rx="14" fill="{NIGHT}"/>' + mark(NIGHT, x=7, y=7, s=50)) if tiled else mark(bg, **mark_kw)
    body = (head + f'\n  <path d="{riad}" fill="{riad_c}"/>\n  <path d="{tax}" fill="{tax_c}"/>\n  <path d="{tag}" fill="{tag_c}"/>')
    open(f'riadtax-{name}.svg', 'w').write(svg(w, 64, body))


# App icon / favicon: dark tile, mark inset.
tile = f'<rect width="64" height="64" rx="14" fill="{NIGHT}"/>' + mark(NIGHT, x=7, y=7, s=50)
open('riadtax-icon.svg', 'w').write(svg(64, 64, tile))
# One-colour mark (stamps, fax, black-and-white print), for a white background.
open('riadtax-icon-mono.svg', 'w').write(svg(64, 64, mark(WHITE, r_fill=INK, badge=INK, check=WHITE, bars=WHITE), defs=''))

lockup('logo-dark', NIGHT, WHITE, LIME, '#d6d3d1')          # reference version, on #0f0f10
lockup('logo', WHITE, INK, OLIVE, '#57534e', tiled=True)       # on white: mark on a night tile
lockup('logo-mono', WHITE, INK, INK, INK, r_fill=INK, badge=INK, check=WHITE, bars=WHITE)
print('ok')
