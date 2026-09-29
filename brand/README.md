# RiadTax — logo

Concept: an orange "R" shaped like a riad door (horseshoe arch, shield base) holding a check mark and three rising bars: "the property is in order, and the numbers add up". Wordmark: **Riad** in white (near-black on light backgrounds), **Tax** in orange, tagline "Legal & Tax Compliance".

| File | Use |
|---|---|
| `riadtax-logo-dark.svg` / `riadtax-logo-dark-1290.png` | Main logo, on dark backgrounds (reference version) |
| `riadtax-logo.svg` / `riadtax-logo-1290.png` | On light backgrounds |
| `riadtax-logo-mono.svg` | One colour (stamps, fax, black-and-white print) |
| `riadtax-icon.svg` / `riadtax-icon-512.png` | App icon, favicon, WhatsApp/social avatar |
| `riadtax-icon-mono.svg` | One-colour mark, no tile |
| `preview.png` | Overview sheet |

| Colour | Hex | Web app token |
|---|---|---|
| Orange (mark, "Tax" on dark) | `#ff8a1e` → `#ff5a00` gradient | `brand-500` |
| Dark orange (buttons, links, "Tax" on light) | `#c2500a` | `brand-600` |
| Night (background, tile) | `#0f0f10` | `night` |
| Ink (wordmark on light) | `#1c1917` | `stone-900` |
| White | `#ffffff` | |

- Keep clear space around the logo equal to half the mark height; do not stretch, recolour or add effects.
- Minimum size: mark 16 px; full logo 140 px wide.
- Text is converted to outlines from Liberation Sans (SIL Open Font License), so no font is needed.
- The web app embeds the same mark in `apps/web/components/logo.tsx`; keep both in sync when the mark changes.
- Regenerate: `pip install fonttools && python3 generate.py`, then `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node render.mjs` for PNGs.
