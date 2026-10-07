# UI refresh: "premium dashboard" layout (inspiration: Fynix case study)

Source: the 8 images in `insperation/` (Fynix, an AI finance dashboard). We take its **layout and composition only**.
We keep the RiadTax logo, colour tokens and fonts unchanged (`design/tokens.json`). No Fynix green (#9FE870 / #062F28) enters the code.

## 1. What the inspiration does (analysis)

| Trait | In Fynix | How it maps to RiadTax |
|---|---|---|
| Page frame | Soft grey page, white sidebar, content in a **bento grid** of white cards with large radius (~16–20 px), hairline border, very soft shadow, generous padding | `bg-mist` page, `bg-card` tiles, `rounded-card-lg` (20 px), `border-bone`, `shadow-sm`. All existing tokens |
| Sidebar | Account card on top (avatar, name, "Personal account", chevron); sectioned nav ("MAIN MENU", "PREFERENCE") with a line icon per item; active item = filled pill; promo card ("Upgrade plan") pinned at the bottom | Account card = company name + role; sections "Workspace" / "Settings"; active pill `bg-brand-50 text-link` (already the rule); bottom card = rules status or help, not an upsell |
| Top bar | Page title + one-line subtitle, search with ⌘F hint, round icon buttons (settings, help), avatar | Title + subtitle from messages; locale switch; help; avatar menu holding logout. Search only if we decide to build it (open decision) |
| Hero card | One **lime-filled** card with the key number, a decorative swirl, two pill buttons (white + dark) | Lime `primary` fill with `on-primary` text (allowed: lime is a fill). Key figure = portfolio nights / properties at risk; buttons "Add property" (canvas) + "Import stays" (dark) |
| KPI strip | One card holding 3 mini-tiles: icon chip, label, big value, small trend chip | Properties · At risk · To review (data already in `GET /dashboard`) |
| Score card | Label, word ("Excellent"), %, segmented bar | Check-in completion or licence-checklist progress. Never "compliance score" wording (rule 2) |
| Charts | Stacked bars (dark + lime), area line with hover tooltip, donut with legend, "This year ▾" selector in each card header | Hand-made SVG charts in tokens: nights per property vs cap (data exists), nights per month and platform split (need API, phase C) |
| Tables | Light header band, small grey meta under each name, status chips, filter bar (search, selects, date range, dark "Download" pill) | Restyle stays, shares, team, reports, arrivals; status stays `StatusPill` (dot + word) |
| Icons | Thin line icons, often inside 40 px round grey buttons | New `IconButton` (44 px for touch, rule: 44 px controls) + a small icon set |
| AI assistant card | Chat box in the dashboard | **Dropped.** Rule 4: no guest data to an LLM. That slot becomes "Quick actions" (new check-in link, import CSV, generate tax estimate, share register), each shown by capability |
| Landing page | Top nav (links, "Log in" ghost, "Sign up" dark pill), big left headline, right side = floating product cards overlapping; metric cards with dot-progress; problem/solution cards; device mock-ups; grey→white gradient glass cards | New public `/` page (open decision), in FR/EN, neutral legal wording |
| Mobile | Same cards stacked, hamburger menu, round icon buttons | Sidebar becomes a drawer on < md; bento collapses to one column |

Things we deliberately do **not** copy: their greens, their logo, AI features, "Upgrade plan" upsell (no billing yet), fake metrics/testimonials on the landing page.

## 2. Constraints carried from CLAUDE.md

- Tokens only: no raw palette classes, no hex. Lime is a fill, always with `on-primary` text.
- **Chart contrast:** lime on white is 1.2:1, so lime may not carry data alone on a white card. Data bars use `ink`/`night`; lime only as the second series *on a mist/night panel* or with an ink outline, plus a legend word. Every chart has a text equivalent (table or `aria` description).
- Pill buttons, 44 px controls, sentence case, no emoji, `StatusPill` for states.
- All text in `messages/fr.json` + `messages/en.json`; logical properties (`ms-`, `me-`, `start`) for RTL.
- Navigation by capability is convenience only; Staff see no financials/tax card, Accountant only `/reports`.
- Tax card (if shown on the dashboard) carries the BETA banner + disclaimer from `GET /tax/rules`, behind `TAX_REPORTS_ENABLED`.
- Thresholds and caps always from the API (`NightGauge` rule).
- Every new kind of screen/pattern goes into `design/README.md` (and the RiadTax artifact if the founder wants it there).
- No Prettier on existing files.

## 3. Work breakdown (one short session each)

### A. Foundations (no API change)
1. **Primitives** in `components/ui.tsx` + `components/icons.tsx`:
   `Panel` (bento card: title, optional subtitle, header actions slot, `rounded-card-lg`), `IconButton`, `KpiTile` (icon chip + label + value + optional pill), `SegmentBar`, `SectionLabel` (mono uppercase, reuse `Meta`), `Menu` (avatar dropdown on native `<details>` or popover), `EmptyState`.
   Icon set: ~20 line icons (home, building, calendar, users, share, file, bell, settings, help, plus, upload, download, chevron, more, search, logout, check, alert, link, chart).
2. **Charts** in `components/charts/`: `BarChart` (vertical, optional stacked 2 series), `HBarChart` with threshold ticks, `Donut`. Pure SVG, token colours via CSS vars, RTL-aware, `role="img"` + `aria-label` + hidden data table. Unit tests for the scale maths in `lib/chart.ts`.
3. **Design notes**: add the new patterns (bento grid, sidebar sections, chart colour rules) to `design/README.md`.

### B. App shell + dashboard (existing data)
4. **App shell** (`components/app-shell.tsx`): sidebar with account card, sections + icons, help/contact card at the bottom; top bar with a greeting and subtitle, locale switch, avatar, visible logout. Mobile: logo bar + scrollable icon pill nav (see section 7). `main` widens to `max-w-7xl` on the dashboard; other screens keep `max-w-4xl` until step D.
5. **Dashboard** (`app/(app)/dashboard/page.tsx`) bento, desktop 12-col:
   - Row 1: lime hero (portfolio nights or properties at risk + 2 actions) · KPI strip (3 tiles) · rules-status card (validated / not validated, replaces the warning alert).
   - Row 2: "Nights per property" `HBarChart` with amber/red ticks from `thresholds` (8 cols) · Quick actions (4 cols).
   - Row 3: Alerts as a table-like list with resolve buttons (8 cols) · property cards with `NightGauge` (4 cols, scroll) or full-width property table.
   - Role variants: Staff = counters, no tax/feed status (as today); empty state when no property.

### C. Dashboard data (API, optional, after B)
6. ~~Extend `GET /dashboard`~~ (done 2026-10-07: `activity` = `nightsByMonth`, `nightsBySource`, `upcomingArrivals` within `upcomingDays`, from `alerts/activity.ts` with unit tests and an int test; check-in completion counts left out because only `CheckInEnabledGuard` may branch on `GUEST_CHECKIN_ENABLED`: they need their own flag-guarded route or a decision). Planned as: `nightsByMonth[12]` (confirmed BOOKING nights, Casablanca months), `platformSplit`, `checkins: { upcoming, complete, pending }` (counts only). Unit tests for the aggregation, int test for tenant isolation, Staff/Accountant shape in the permission matrix. Then: stacked monthly bar card, platform donut, check-in score card, "Upcoming arrivals" table (no guest names for Staff).
7. Optional tax card (Owner/Manager, flag on): latest report status + amount with BETA banner/disclaimer from `GET /tax/rules`.

### D. Other screens in the same style
8. Tables: shared `DataTable` styling (header band, row meta, status column, filter bar with search/select/date + Download pill). Apply to stays, shares, team, reports, arrivals.
9. ~~Properties list as card grid~~ (done 2026-10-07 from the "Cartes Biens — Dari" canvas: status filters, cards, add card, skeletons; counters from `GET /dashboard`) + ~~property detail~~ (done 2026-10-07: header card with section tabs, counter panel with figure tiles, details panel, review list, stays with date tiles, calendars). Sub-pages (arrivals, registers, tax, checklist, import) still use their own headers: move the header + tabs into a `properties/[id]/layout.tsx` when they are restyled.
10. Auth pages: split layout, form card left, decorative product panel right (static mock-up built from our own components with demo numbers, hidden < lg).

### E. Homepage
11. ~~Public landing at `/`~~ (done 2026-10-07: `app/page.tsx`, server-rendered; `SignedInRedirect` sends a signed-in visitor to `/dashboard`; CTAs use `NEXT_PUBLIC_SUPPORT_EMAIL` and fall back to "Se connecter"). Planned as: nav (Features, How it works, Pricing?, Log in, Sign up/Contact), hero headline + floating product cards (lime "nights this year" card overlapping a property card), 3 feature cards (night counter, guest check-in & police register, tax estimate *BETA*), "how it works" steps, FAQ, footer. Signed-in users still go to `/dashboard`. SSR, `noindex` off only for `/`. Copy must avoid "certified / guaranteed / compliant"; claims about the law stay neutral.

### F. QA
12. Update Playwright selectors (e2e uses the demo account; shell markup changes), check FR/EN/AR (RTL), dark theme, 360 px width, keyboard and focus ring, contrast of every new pair, `npm run lint && npm run typecheck && npm test && npm run test:e2e`.

## 4. Definition of done
- Shell, dashboard, tables, auth and (if approved) landing use the bento style, with zero new colours, the same logo, and no hard-coded strings.
- Every role sees only what it saw before (permission matrix unchanged unless phase C adds fields).
- Lighthouse a11y ≥ 95 on dashboard and landing; no horizontal scroll at 360 px; RTL mirrored.
- e2e green.

## 5. Risks
- e2e breakage from markup changes → step 12 budgets for it; prefer role/label selectors.
- Lime contrast in charts → rule in section 2.
- Scope creep into features (search, AI, billing) → each is an open decision, not part of this refresh.

## 6. Decisions (founder, 2026-10-07)
1. **Homepage**: `/` becomes a public marketing page. Accepting an invitation now lands on `/dashboard` (the role guard sends an Accountant on to `/reports`).
2. **Search**: left out of the top bar.
3. **Icons**: hand-drawn SVG set in `components/icons.tsx`, no dependency.
4. **Dashboard data (phase C)**: approved (monthly nights, platform split, check-in counts). The charts are built with it, not before.
5. **Sidebar bottom card**: help / contact.
6. **Design system**: the new patterns go into `design/README.md` and into the RiadTax design-system artifact.

## 7. Notes found while building
- The e2e suite runs on a phone viewport and clicks nav links directly, so the mobile nav stays a visible scrollable pill row (no hamburger drawer), and "Se déconnecter" stays a visible button.
- The dashboard must keep exactly one `meter` per property (e2e `getByRole('meter')`): the night gauge lives only in the properties panel, never repeated in a chart.
- Quick-action labels must not contain a nav label ("Équipe", "Estimations fiscales", "Liens partagés"): Playwright matches link names by substring.
