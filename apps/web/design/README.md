# Design tokens

`tokens.json` is a snapshot of the **RiadTax design system** (Claude design-system artifact "RiadTax", `project/tokens.json`).
The artifact is the source of truth: to change a colour, font or radius, change it there, copy the new
`tokens.json` here, and run `npm run tokens -w apps/web`. That regenerates `styles/tokens.css` (committed).

Rules that come with the system (see the artifact's README for the full brand book):
- Lime (`brand-500`) is a fill: always with `on-primary` text, never text or a thin line on white. Links use `link`.
- Status colours always come with a word. Buttons, tags and pills are pill-shaped; inputs use `radius-input`.
- Every control is at least 44px high. Focus ring: 2px `focus`, offset 2px.
- Fonts are self-hosted (`@fontsource`), so no request leaves for Google Fonts.
