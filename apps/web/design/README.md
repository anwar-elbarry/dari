# Design tokens

`tokens.json` is a snapshot of the **RiadTax design system** (Claude design-system artifact "RiadTax", `project/tokens.json`).
The artifact is the source of truth: to change a colour, font or radius, change it there, copy the new
`tokens.json` here, and run `npm run tokens -w apps/web`. That regenerates `styles/tokens.css` (committed).

Rules that come with the system (see the artifact's README for the full brand book):
- Lime (`brand-500`) is a fill: always with `on-primary` text, never text or a thin line on white. Links use `link`.
- Status colours always come with a word. Buttons, tags and pills are pill-shaped; inputs use `radius-input`.
- Every control is at least 44px high. Focus ring: 2px `focus`, offset 2px.
- Fonts are self-hosted (`@fontsource`), so no request leaves for Google Fonts.

## Dashboard patterns (UI refresh, `docs/ui-refresh.md`)

Layout ideas taken from a premium dashboard reference; colours, logo and fonts stay RiadTax.

- **App frame** (`components/app-shell.tsx`): `mist` page, `card` sidebar with the logo, an account card
  (initials on a `night` disc in lime, company, role), nav sections under a mono uppercase label, an icon on
  every item, the active item `brand-50` + `link`, and a help/contact card at the bottom. Top bar: greeting,
  subtitle, language, a visible logout. On phones the nav is a scrollable pill row and logout stays visible.
- **Bento grid**: `grid grid-cols-1 lg:grid-cols-12 gap-5`. Always give the column `grid-cols-1` (minmax 0),
  never an implicit grid, or the widest child pushes the page sideways on a phone.
- **Panel** (`Panel` in `ui.tsx`): `card` fill, `radius-card-lg`, `bone` border, `shadow-sm`, h2 title in the
  header and an optional action at the end.
- **Hero tile**: one per screen at most. `primary` fill, `on-primary` text, the key figure in display 5xl,
  decorative rings in `brand-deep` (hidden from assistive tech), a `light` (canvas) and a `dark` pill button.
- **KpiTile**: icon chip on `card`, label, big number, on a `mist` well inside a panel; a row on phones.
- **IconChip**: 40px round well for icons, tones neutral/raised/brand/dark/warning/danger. Decorative only.
- **Icons** (`components/icons.tsx`): hand-drawn 24px line icons, 1.8 stroke, `currentColor`. Direction
  icons (arrow, logout) get `rtl:-scale-x-100`.
- **Charts** (`components/charts.tsx`: `BarChart`, `Donut`; axis maths in `lib/chart.ts`): data in `ink`/`night` or `brand-700`; lime is never the only
  carrier of a value on white (1.2:1); every chart has a text equivalent.
- **Property card** (`components/property/property-card.tsx`, design canvas "Cartes Biens — Dari",
  https://claude.ai/artifact/QQjCNDpbSh6cJLHuFfk1jh): type icon in a `radius-card` well, name (two lines at most),
  licence pill + mono type, address/owner list, night counter section (level pill only when amber/red, bar in
  `ink`/`warning`/`danger`, cap from the API), warning pills, "Voir le bien" footer. The name's link is stretched
  over the card, so the card is one link; nothing else in it is interactive. Grid:
  `repeat(auto-fill, minmax(min(100%,320px),1fr))`, then a dashed "add" card for those who may add.
- **Homepage** (`app/page.tsx`): hero inside a `radius-card-lg` panel with a `mist`→`canvas` gradient, headline
  in display weight 500 with the strong half in 700, a product preview built from the app's own pieces with
  sample data (one `role="img"`), feature cards (the middle one lime), numbered steps, a `plaster` band for
  security, `<details>` FAQ, lime closing panel. Server component: import `buttonClass` from
  `components/button-class.ts`, not from the client module `ui.tsx`.
- **Property header** (`components/property/property-header.tsx`, rendered by `app/(app)/properties/[id]/layout.tsx`):
  breadcrumb, identity card (type icon on `night`, name, address, licence pill) and the section tabs. The name is
  the h1 on the overview only; every section page keeps its own h1.
- **Auth pages** (`app/(auth)/layout.tsx`): form card on the left, a lime panel on the right from `lg` up.
- **Buttons**: each variant sets its own border colour (`components/button-class.ts`); never combine a base
  `border-transparent` with a variant colour, the winner would depend on CSS order (ghost borders were invisible).
