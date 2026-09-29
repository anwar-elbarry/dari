"""Five RiadTax logo concepts as vector SVG. Run: python3 generate.py (needs fonttools).

Each concept gives: dark lockup, light lockup, app icon. overview.svg shows all of them.
Text is converted to outlines (Liberation Sans, SIL Open Font License): no font needed.
"""
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

ORANGE, ORANGE_DEEP, ORANGE_DARK = '#ff8a1e', '#ff5a00', '#c2500a'
NIGHT, INK, WHITE = '#0f0f10', '#1c1917', '#ffffff'
BOLD = TTFont('/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf')
REG = TTFont('/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf')


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


def glyph_centered(ch, cx, cy, cap):
    """Outline of one bold glyph, scaled to cap height `cap`, centred on (cx, cy)."""
    glyphs, name = BOLD.getGlyphSet(), BOLD.getBestCmap()[ord(ch)]
    bp = BoundsPen(glyphs); glyphs[name].draw(bp)
    x0, y0, x1, y1 = bp.bounds
    k = cap / (y1 - y0)
    tx = cx - (x0 + x1) / 2 * k
    ty = cy + (y0 + y1) / 2 * k
    pen = SVGPathPen(glyphs)
    glyphs[name].draw(TransformPen(pen, (k, 0, 0, -k, tx, ty)))
    return pen.getCommands()


def grad(gid):
    return (f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="64" y2="64">'
            f'<stop offset="0" stop-color="{ORANGE}"/><stop offset="1" stop-color="{ORANGE_DEEP}"/></linearGradient>')


# ---- Marks: 64 x 64 units. `bg` is the surface colour behind the mark. ----

def badge_r(g, bg):
    """1. Badge R: bold R, a check-and-bars badge locked on the foot of the stem."""
    return f'''<path d="M8 62 V6 H36 A17 17 0 0 1 43.5 38.4 L58 62 H43 L31 42 H23 V62 Z M23 19 V29 H36 A5 5 0 0 0 36 19 Z" fill="url(#{g})" fill-rule="evenodd"/>
<rect x="3" y="36" width="28" height="28" rx="8" fill="{bg}"/>
<rect x="5.5" y="38.5" width="23" height="23" rx="6" fill="{NIGHT}"/>
<path d="M10.5 47 L15 51.5 L24 42.5" fill="none" stroke="{WHITE}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M11 58.5 V56 M17 58.5 V54 M23 58.5 V51.5" fill="none" stroke="{ORANGE}" stroke-width="2.8" stroke-linecap="round"/>'''


def check_leg_r(g, bg):
    """2. Check-leg R: the leg of the R is a check mark."""
    return f'''<path d="M8 62 V6 H35 A16.5 16.5 0 0 1 35 39 H23 V62 Z M23 18.5 V26.5 H35 A4 4 0 0 0 35 18.5 Z" fill="url(#{g})" fill-rule="evenodd"/>
<path d="M30 36 L41 54 L60 27" fill="none" stroke="url(#{g})" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>'''


def door_r(g, bg):
    """3. Door R: the bowl is a horseshoe arch (riad door) holding the check; bars in the stem."""
    return f'''<path d="M10 62 V27 A22 22 0 0 1 54 27 A22 22 0 0 1 40 47.5 L56 62 H42 L30 51 H24 V62 Z M25.5 37 V25 A8.5 8.5 0 1 1 42.5 25 V37 Z" fill="url(#{g})" fill-rule="evenodd"/>
<path d="M28.5 28.5 L32 32 L39.5 23.5" fill="none" stroke="{ORANGE}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M13.5 58 V54.5 M18 58 V50.5 M22.5 58 V46.5" fill="none" stroke="{bg}" stroke-width="3" stroke-linecap="round"/>'''


R_SHIELD = glyph_centered('R', 32, 27, 21)
R_STAR = glyph_centered('R', 32, 32, 27)


def shield_r(g, bg):
    """4. Shield R: protection and compliance; the R is cut out of the shield, a check seals the base."""
    return f'''<path d="M32 2 L58 10 V32 C58 47.5 46.5 57.5 32 62.5 C17.5 57.5 6 47.5 6 32 V10 Z" fill="url(#{g})"/>
<path d="{R_SHIELD}" fill="{bg}"/>
<path d="M26 48.5 L30.5 52.5 L38.5 45" fill="none" stroke="{bg}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>'''


def star_r(g, bg):
    """5. Khatam R: the eight-point Moroccan star (khatam, zellige) as a seal, R in its centre."""
    return f'''<g fill="url(#{g})">
  <rect x="11" y="11" width="42" height="42" rx="3"/>
  <rect x="11" y="11" width="42" height="42" rx="3" transform="rotate(45 32 32)"/>
</g>
<path d="{R_STAR}" fill="{bg}"/>'''


CONCEPTS = [
    ('1-badge-r', 'Badge R', 'Bold R with a check-and-bars badge on the foot of the stem. Closest to the reference.', badge_r),
    ('2-check-leg-r', 'Check-leg R', 'The leg of the R is a check mark: "R, validated". Cleanest, best at small sizes.', check_leg_r),
    ('3-door-r', 'Door R', 'The bowl is a horseshoe arch (riad door) holding the check; rising bars in the stem.', door_r),
    ('4-shield-r', 'Shield R', 'R cut out of a shield, sealed by a check: protection and compliance.', shield_r),
    ('5-khatam-r', 'Khatam R', 'R at the centre of the eight-point Moroccan star (zellige), like an official seal.', star_r),
]


def lockup_body(fn, gid, dark, x=0, y=0):
    bg = NIGHT if dark else WHITE
    riad_c, tax_c, tag_c = (WHITE, ORANGE, '#d6d3d1') if dark else (INK, ORANGE_DARK, '#57534e')
    riad, end = text_path('Riad', x + 80, y + 40, 40, tracking=-0.6)
    tax, end = text_path('Tax', end + 0.5, y + 40, 40, tracking=-0.6)
    tag, tag_end = text_path('Legal & Tax Compliance', x + 81, y + 58, 13.2, tracking=1.1, font=REG)
    body = (f'<g transform="translate({x} {y})">{fn(gid, bg)}</g>'
            f'<path d="{riad}" fill="{riad_c}"/><path d="{tax}" fill="{tax_c}"/><path d="{tag}" fill="{tag_c}"/>')
    return body, max(end, tag_end) - x


def svg_doc(w, h, defs, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" width="{w * 2:.0f}" height="{h * 2:.0f}" role="img" aria-label="{title}">\n'
            f'<title>{title}</title>\n<defs>{defs}</defs>\n{body}\n</svg>\n')


PAD = 24
overview_rows, oy = [], 0
for slug, name, desc, fn in CONCEPTS:
    gid = 'g' + slug[0]
    for dark in (True, False):
        body, w = lockup_body(fn, gid, dark, PAD, PAD)
        W, H = w + 2 * PAD, 64 + 2 * PAD
        bg = f'<rect width="{W:.0f}" height="{H}" rx="16" fill="{NIGHT if dark else WHITE}"/>'
        suffix = '' if dark else '-light'
        open(f'concept-{slug}{suffix}.svg', 'w').write(svg_doc(W, H, grad(gid), bg + body, f'RiadTax — {name}'))
    icon = f'<rect width="64" height="64" rx="14" fill="{NIGHT}"/><g transform="translate(8 8) scale(0.75)">{fn(gid, NIGHT)}</g>'
    open(f'concept-{slug}-icon.svg', 'w').write(svg_doc(64, 64, grad(gid), icon, f'RiadTax — {name} icon'))

# Overview: one row per concept (dark lockup, light lockup, icon at 3 sizes), with its name.
rows, y, WIDTH = [], 20, 900
defs = ''.join(grad('o' + s[0]) for s, *_ in CONCEPTS)
for slug, name, desc, fn in CONCEPTS:
    gid = 'o' + slug[0]
    label, _ = text_path(f'{slug[0]}. {name}', 20, y + 14, 15)
    note, _ = text_path(desc, 20, y + 32, 10.5, font=REG)
    rows.append(f'<path d="{label}" fill="{INK}"/><path d="{note}" fill="#57534e"/>')
    y += 44
    for i, dark in enumerate((True, False)):
        x0 = 20 + i * 330
        rows.append(f'<rect x="{x0}" y="{y}" width="315" height="104" rx="12" fill="{NIGHT if dark else WHITE}" stroke="#e7e5e4"/>')
        body, _ = lockup_body(fn, gid, dark, 0, 0)
        rows.append(f'<g transform="translate({x0 + 20} {y + 20}) scale(1)">{body}</g>')
    ix = 680
    for s in (64, 40, 24):
        rows.append(f'<g transform="translate({ix} {y + 104 - s})"><rect width="{s}" height="{s}" rx="{s * 0.22:.1f}" fill="{NIGHT}"/>'
                    f'<g transform="translate({s * 0.125:.2f} {s * 0.125:.2f}) scale({s * 0.75 / 64:.4f})">{fn(gid, NIGHT)}</g></g>')
        ix += s + 16
    y += 104 + 28
open('overview.svg', 'w').write(svg_doc(WIDTH, y, defs, f'<rect width="{WIDTH}" height="{y}" fill="#f5f2ed"/>' + ''.join(rows), 'RiadTax — logo concepts'))
print('ok')
