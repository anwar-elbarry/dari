# RiadTax — logo

Concept: a Moroccan horseshoe arch (the riad door) holding a check mark, meaning "the property is in order". The colours match the web app's theme.

| File | Use |
|---|---|
| `riadtax-logo.svg` / `riadtax-logo-1290.png` | Main logo, on light backgrounds |
| `riadtax-logo-dark.svg` / `riadtax-logo-dark-1290.png` | On dark backgrounds |
| `riadtax-logo-mono.svg` | One colour (stamps, fax, black-and-white print) |
| `riadtax-icon.svg` / `riadtax-icon-512.png` | App icon, favicon, WhatsApp/social avatar |
| `riadtax-icon-mono.svg` | One-colour icon |
| `preview.png` | Overview sheet |

| Colour | Hex |
|---|---|
| Teal (tile) | `#1f6f6a` |
| Dark teal (wordmark) | `#134541` |
| Terracotta (check, "Tax") | `#c2663d` (`#e3895f` on dark) |
| Cream (door) | `#fbf7f2` |

- Keep clear space around the logo equal to half the icon height; do not stretch, recolour or add effects.
- Minimum size: icon 16 px; full logo 120 px wide.
- The wordmark is converted to outlines from Liberation Sans Bold (SIL Open Font License), so no font is needed.
- Regenerate: `pip install fonttools && python3 generate.py`, then `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node render.mjs` for PNGs.
