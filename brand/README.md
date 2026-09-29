# RiadTax — logo

Concept "Badge R" (chosen from the five in `concepts/`): a bold lime R with a dark badge locked on the foot of the stem. The badge holds a white check mark and three rising lime bars: "the property is in order, and the numbers add up". Wordmark: **Riad** in white (Ink on light backgrounds), **Tax** in lime (olive on white), tagline "Legal & Tax Compliance".

| File | Use |
|---|---|
| `riadtax-logo-dark.svg` / `riadtax-logo-dark-1290.png` | Main logo, on Night `#0f0f10` (reference version) |
| `riadtax-logo.svg` / `riadtax-logo-1290.png` | On white: the mark sits on a night tile, because lime on white is 1.2:1 |
| `riadtax-logo-mono.svg` | One colour, on white (stamps, fax, black-and-white print) |
| `riadtax-icon.svg` / `riadtax-icon-512.png` | App icon, favicon, WhatsApp/social avatar |
| `riadtax-icon-mono.svg` | One-colour mark, on white |
| `preview.png` | Overview sheet |
| `concepts/` | The five concepts that were compared |

| Colour | Hex | Design token |
|---|---|---|
| Brand lime (mark, "Tax" on dark, primary fill) | `#e4f222` → `#b9cc00` gradient | `brand-500`, `brand-deep` |
| Olive ("Tax" on white, links) | `#5c6600` | `brand-700` |
| Night (badge, dark background, icon tile) | `#0f0f10` | `night` |
| Ink (wordmark on white) | `#202020` | `ink` |

Lime always carries dark text (13:1) and is never text or a thin shape on white (1.2:1).

- On Night the badge sits in a ring of the background colour; the light lockup puts the mark on its own night tile. On any other background, use the icon (tile) or regenerate with that colour.
- Keep clear space around the logo equal to half the mark height. Do not stretch, recolour or add effects.
- Minimum size: mark 16 px; full logo 140 px wide.
- Text is converted to outlines from Liberation Sans (SIL Open Font License), so no font is needed.
- The web app draws the same mark in `apps/web/components/logo.tsx` (with a `surface` prop for the ring). Keep it in sync with `generate.py`.
- The full design system (colours, type, components) is in `docs/design-system.md`.
- Regenerate: `pip install fonttools && python3 generate.py`, then `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node render.mjs` for PNGs.
