# RiadTax — logo

Concept "Badge R" (chosen from the five in `concepts/`): a bold orange R with a dark badge locked on the foot of the stem. The badge holds a white check mark and three rising orange bars: "the property is in order, and the numbers add up". Wordmark: **Riad** in white (Ink on light backgrounds), **Tax** in orange, tagline "Legal & Tax Compliance".

| File | Use |
|---|---|
| `riadtax-logo-dark.svg` / `riadtax-logo-dark-1290.png` | Main logo, on Night `#0f0f10` (reference version) |
| `riadtax-logo.svg` / `riadtax-logo-1290.png` | On white |
| `riadtax-logo-mono.svg` | One colour, on white (stamps, fax, black-and-white print) |
| `riadtax-icon.svg` / `riadtax-icon-512.png` | App icon, favicon, WhatsApp/social avatar |
| `riadtax-icon-mono.svg` | One-colour mark, on white |
| `preview.png` | Overview sheet |
| `concepts/` | The five concepts that were compared |

| Colour | Hex | Design token |
|---|---|---|
| Brand orange (mark, "Tax" on dark) | `#ff8a1e` → `#ff5a00` gradient | `brand-500`, `brand-deep` |
| Action orange ("Tax" on white, primary buttons) | `#c2500a` | `brand-600` |
| Night (badge, dark background, icon tile) | `#0f0f10` | `night` |
| Ink (wordmark on white) | `#202020` | `ink` |

- The badge sits in a ring of the background colour. Each lockup is drawn for one background: use the dark version on Night and the light one on white. On another background, use the icon (tile) or regenerate with that colour.
- Keep clear space around the logo equal to half the mark height. Do not stretch, recolour or add effects.
- Minimum size: mark 16 px; full logo 140 px wide.
- Text is converted to outlines from Liberation Sans (SIL Open Font License), so no font is needed.
- The web app draws the same mark in `apps/web/components/logo.tsx` (with a `surface` prop for the ring). Keep it in sync with `generate.py`.
- The full design system (colours, type, components) is in `docs/design-system.md`.
- Regenerate: `pip install fonttools && python3 generate.py`, then `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node render.mjs` for PNGs.
