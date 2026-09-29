# RiadTax — Design System
> A hardworking compliance dashboard on white. The visual language borrows from the product itself: dense lists, status pills, big numbers you can trust at a glance, and bold typographic claims that read like a clear tax statement.

**Theme:** light (a dark theme is defined for dark panels and later use)

**Brand mark:** Badge R (`brand/`): a lime R with a dark badge holding a check mark and rising bars.

RiadTax speaks in a sharp, high-contrast, reassuring dialect: a white canvas where bold headlines (34–80px, weight 700–800, tracking pulled to −0.04em) sit next to compact 14px button labels and a lime filled call to action. The signature move is the 9999px pill: buttons, chips, tags, nav items and status pills share one full-radius curve, which softens an interface that deals with serious topics (tax, police declarations, licences). Colour is used surgically: **lime is the brand**. Lime `#e4f222` is a fill colour: it carries identity (logo, highlights) and action (primary buttons) and always carries dark text (13:1). On white it has 1.2:1 contrast, so it is never used as text or as a thin shape on a light surface; dark olive `#5c6600` from the same hue takes that job. The rest of the system is grayscale. Status colours (green, amber, red, blue) mean a state and always come with a word. The only expressive moment is a rotating lime-gradient border around one element per page.

Two rules from the product override any visual choice:
- Every tax figure carries the notice "Estimate only — confirm with your accountant". Never write "certified", "guaranteed" or "DGSN-compliant" anywhere in the UI.
- Help text about tax or legal choices stays neutral. Design never states the law.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Signal White | `#ffffff` | `--color-white` | Page background, card surfaces, input fills. The default canvas. |
| Ink | `#202020` | `--color-ink` | Primary text, headlines, the dark filled button. 16.3:1 on white. |
| Night | `#0f0f10` | `--color-night` | Logo badge, dark panels, display headlines at 48px+. |
| Carbon | `#2a2a2a` | `--color-carbon` | Nav labels, ghost button text, strong secondary text. |
| Slate | `#646464` | `--color-slate` | Secondary text, hints, meta. 5.9:1 on white, 5.0:1 on Plaster. |
| Ash | `#767676` | `--color-ash` | Tertiary text, placeholders, disabled labels. 4.5:1 on white only (adjusted from `#838383`, which failed). |
| Line Strong | `#8a8a8a` | `--color-line-strong` | Input and select borders: 3.4:1 on white, so a field is always visible. |
| Fog | `#b3b3b3` | `--color-fog` | Disabled borders, low-contrast decorative dividers. |
| Cloud | `#d4d4d4` | `--color-cloud` | Hairlines, dashed dividers, table rules. |
| Bone | `#e8e8e8` | `--color-bone` | Default border: cards, ghost buttons, sidebar edge. |
| Mercury | `#eeeeee` | `--color-mercury` | Hover fill for nav and ghost items, neutral chip background. |
| Mist | `#f8f9fa` | `--color-mist` | App page background, secondary card surface. |
| Plaster | `#e9ebf0` | `--color-plaster` | Section band that breaks white rhythm on marketing pages. |
| Brand 50 | `#f6fac8` | `--color-brand-50` | Pale lime tint behind olive text (selected nav item, active tag). |
| Brand 100 | `#f0f79a` | `--color-brand-100` | Focus halo on inputs, borders of tinted blocks; Brand 800 text (8.0:1) reads on it. |
| **Brand Lime** | `#e4f222` | `--color-brand-500` | Brand identity and action: logo, badge bars, primary button fill, highlight words on dark, focus ring on dark. Always with **Ink** or **Night** text (13.2:1 and 15.5:1). Never as text or a shape on white (1.2:1). |
| Brand Deep | `#b9cc00` | `--color-brand-deep` | Gradient end of the logo, pressed state of the primary button. Fill only. |
| Brand 600 — Hover | `#cddd12` | `--color-brand-600` | Primary button hover fill (Ink text 10.8:1). |
| **Brand 700 — Olive** | `#5c6600` | `--color-brand-700` | Links and brand-coloured text on any light surface: 6.3:1 on white, 6.0:1 on Brand 50. Also "Tax" in the light logo. |
| Brand 800 | `#454d00` | `--color-brand-800` | Text on Brand 100 (8.0:1) and strong olive text. |
| Success | `#0f7b4b` on `#dcf5e8` | `--color-success` / `--color-success-soft` | "Compliant", "Declared", "Paid". Replaces the reference's mint/emerald/teal. |
| Warning | `#8a5300` on `#fff4d6` | `--color-warning` / `--color-warning-soft` | "To check", threshold approaching (for example the day counter nearing the limit stored in `RuleConfig`). Kept amber-brown so it never reads as the brand lime. |
| Danger | `#b42318` on `#fde8e6` | `--color-danger` / `--color-danger-soft` | Errors, "Missing", "Overdue". |
| Info | `#0b62c4` on `#e5f0fc` | `--color-info` / `--color-info-soft` | Neutral information, "In progress". The only blue in the system. |
| Lime Conic | `conic-gradient(from 90deg, #b9cc00 0%, #e4f222 22%, #f6fac8 42%, #ffffff 50%, #f6fac8 58%, #e4f222 78%, #b9cc00 100%)` | `--gradient-lime-conic` | Rotating border around one hero element per page. Replaces the reference's rainbow conic. |
| Brand Gradient | `linear-gradient(135deg, #e4f222 0%, #b9cc00 100%)` | `--gradient-brand` | The logo's R on dark, and at most one display word per dark panel. |
| Dark Fade | `linear-gradient(#111111 24%, #000000)` | `--gradient-dark-fade` | Dark feature panels. |

Colour rules:
- Lime is never text on a light surface. Brand-coloured text on light is **Brand 700** (olive); on dark surfaces the text may be Brand Lime itself (15.5:1 on Night).
- The primary button is a lime fill with **Ink** text, never white text. Lime on white has no visible edge, so the label and the focus ring carry the button.
- Success green and Brand Lime sit close in hue. Success is always a soft pill with a dark green word and a dot; lime is never used for a state.
- A status is never colour alone: every pill has a word, and success and danger also differ by icon (check, cross).
- Amounts are Ink. Never colour a number lime or green to suggest it is good or bad; use a status pill next to it.

## Tokens — Typography

### Plus Jakarta Sans — display and interface · `--font-display`
- **Use:** every heading 20px and up, button labels, nav, tags, stat numbers.
- **Weights:** 500, 600, 700, 800.
- **Sizes:** 14, 16, 20, 24, 34, 48, 60, 80.
- **Letter spacing:** −0.04em at 60–80px, −0.035em at 48px, −0.023em at 34px, −0.02em at 20–24px, normal at 14–16px.
- **Never below 14px.** Switch to Inter for captions.
- **Self-hosted** in the app (`@fontsource-variable/plus-jakarta-sans`). The content security policy blocks Google Fonts.

### Inter — body and data · `--font-sans`
- **Use:** body copy, form fields, tables, captions, help text, the tax disclaimer.
- **Weights:** 400, 500, 600.
- **Sizes:** 12, 14, 16, 18.
- **Letter spacing:** −0.01em at 16px, normal below. `font-variant-numeric: tabular-nums` for every column of amounts or dates.
- **Self-hosted** (`@fontsource-variable/inter`).

### JetBrains Mono — meta labels · `--font-mono`
- **Use:** uppercase meta labels ("ESTIMATE", "LAST SYNC"), references such as a licence number or booking ID.
- **Sizes:** 10px uppercase at +0.08em, 12px uppercase at +0.06em.
- **Self-hosted** (`@fontsource-variable/jetbrains-mono`). Replaces the reference's Sometype Mono.

### Arabic — IBM Plex Sans Arabic · `--font-arabic`
- **Use:** every text style when the page is in Arabic (`dir="rtl"`). Plus Jakarta and Inter have no Arabic glyphs.
- Same sizes, weight 400–700, **letter spacing always 0** (negative tracking breaks joined letters), line height +0.1.
- Add it (`@fontsource/ibm-plex-sans-arabic`) when the Arabic locale ships.

### Type Scale

| Role | Family | Weight | Size | Line Height | Letter Spacing | Token |
|------|--------|--------|------|-------------|----------------|-------|
| caption | Inter | 500 | 12px | 1.5 | 0 | `--text-caption` |
| meta | JetBrains Mono | 500 | 10px | 1.6 | 0.08em, uppercase | `--text-meta` |
| body-sm | Inter | 400 | 14px | 1.5 | 0 | `--text-body-sm` |
| label | Plus Jakarta Sans | 700 | 14px | 1.43 | 0 | `--text-label` |
| body | Inter | 400 | 16px | 1.5 | −0.01em | `--text-body` |
| subheading | Plus Jakarta Sans | 600 | 20px | 1.5 | −0.02em | `--text-subheading` |
| title | Plus Jakarta Sans | 700 | 24px | 1.33 | −0.02em | `--text-title` |
| heading-sm | Plus Jakarta Sans | 700 | 34px | 1.2 | −0.023em | `--text-heading-sm` |
| heading | Plus Jakarta Sans | 700 | 48px | 1.15 | −0.035em | `--text-heading` |
| heading-lg | Plus Jakarta Sans | 700 | 60px | 1.1 | −0.035em | `--text-heading-lg` |
| display | Plus Jakarta Sans | 800 | 80px | 1.05 | −0.04em | `--text-display` |

In the dashboard, page titles use **title** (24px) and section titles **subheading**. The 34–80px styles are for the marketing site, onboarding and empty states.

## Tokens — Spacing & Shapes

**Base unit:** 4px. **Density:** compact inside components, generous between sections.

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 4 | 4px | `--spacing-4` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 20 | 20px | `--spacing-20` |
| 24 | 24px | `--spacing-24` |
| 28 | 28px | `--spacing-28` |
| 32 | 32px | `--spacing-32` |
| 40 | 40px | `--spacing-40` |
| 48 | 48px | `--spacing-48` |
| 56 | 56px | `--spacing-56` |
| 72 | 72px | `--spacing-72` |
| 80 | 80px | `--spacing-80` |
| 100 | 100px | `--spacing-100` |

In Tailwind, use the default scale (`p-1` = 4px, `p-7` = 28px): it is the same 4px grid.

### Border Radius

| Element | Value | Tailwind |
|---------|-------|----------|
| buttons, tags, badges, status pills, nav items | 9999px | `rounded-full` |
| inputs, selects | 9px | `rounded-input` |
| cards | 12px | `rounded-card` |
| images, screenshots | 16px | `rounded-image` |
| large cards, dark panels | 20px | `rounded-card-lg` |
| app icon tile | 22% of the side | — |

### Shadows

| Name | Value | Token | Use |
|------|-------|-------|-----|
| subtle | `0 1px 3px rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)` | `--shadow-subtle` | Menus, popovers. |
| sm | `0 4px 4px rgba(13,21,48,0.04)` | `--shadow-sm` | Cards on Mist, the only card shadow. |
| lift | `0 1px 1px -0.5px rgba(15,15,16,0.04), 0 3px 3px -1.5px rgba(15,15,16,0.04), 0 6px 6px -3px rgba(15,15,16,0.04), 0 12px 12px -6px rgba(15,15,16,0.04)` | `--shadow-lift` | Product screenshot, dialogs. |
| focus | `0 0 0 3px #f0f79a` | `--shadow-focus` | Halo around a focused input, in addition to its Brand 700 border. |

### Layout

- **Marketing page max-width:** 1200px. **App content max-width:** 896px (`max-w-4xl`), tables up to 1200px.
- **Section gap:** 80px (marketing), 32px (app).
- **Card padding:** 28px desktop, 20px under 640px.
- **Element gap:** 12px.
- **Touch targets:** at least 44px high (`min-h-11`) for every button, input and nav item. Most managers use a phone.

## Components

### Primary Button
**Role:** the one main action of a screen ("Save", "Add property", "Send to the police").

Background Brand Lime `#e4f222`, text Ink `#202020` (13.2:1), Plus Jakarta Sans 14px weight 700, radius 9999px, padding 12px 24px, min height 44px, no border, no shadow. Hover Brand 600 `#cddd12`, pressed Brand Deep `#b9cc00`. Focus: 2px Ink ring, offset 2px. Disabled: 60% opacity. One per screen.

### Dark Button
**Role:** strong secondary action next to a primary one, or the primary action on a lime or tinted surface.

Background Ink `#202020`, text white, same shape as the primary button. Hover Carbon.

### Ghost Button
**Role:** secondary or alternative path ("Cancel", "Back", "Export").

Transparent, 1px Bone border, text Ink 14px weight 700, radius 9999px, padding 10px 20px. Hover fill Mercury. The **olive variant** (Brand 700 border and text) marks a secondary action that still belongs to the brand flow.

### Danger Button
**Role:** destructive actions ("Revoke link", "Delete").

Transparent, text Danger, hover fill Danger Soft. Always asks for confirmation in the page.

### Nav Pill
**Role:** sidebar and top-bar items.

Text Carbon 14px weight 600, radius 9999px, padding 8px 12px, min height 44px. Hover fill Mercury. Current page: fill Brand 50, text Brand 700, `aria-current="page"`.

### Tag
**Role:** categories and filters ("Riad", "Apartment", "Auto-entrepreneur").

Background Mist or transparent, 1px Bone border, text Ink 14px weight 700, radius 9999px, padding 6px 14px. Active: fill Brand 50, border Brand 100, text Brand 700.

### Status Pill
**Role:** the state of a property, booking or declaration.

Radius 9999px, padding 3px 10px, Inter 12px weight 600, a 6px dot in the status colour, then the word. Tones: success (Compliant, Declared), warning (To check, Near threshold), danger (Missing, Overdue), info (In progress), neutral (Draft: Mercury fill, Carbon text). The word is always there.

### Stat Card
**Role:** one key number: nights rented this year, estimated tax, pending declarations.

White, 1px Bone border, radius 12px, padding 28px. Meta label (JetBrains Mono 10px, uppercase, Slate), then the number in Plus Jakarta Sans 48–60px weight 700, tracking −0.035em, Night, tabular numbers, then a caption in Inter 14px Slate. A tax figure always shows the estimate notice under it.

### Estimate Notice
**Role:** the mandatory disclaimer on every tax output (screen, PDF, CSV).

Inline block, Warning Soft background, radius 12px, padding 12px 16px, an info icon, Inter 14px Ink: "Estimate only — confirm with your accountant." Never hidden behind a tooltip, never smaller than 12px.

### Card
**Role:** groups related content in the app.

White, 1px Bone border, radius 12px, padding 20–28px, shadow `sm` only on a Mist page. Never stack more than two levels of surface.

### Dark Feature Card
**Role:** a contrast section on the marketing site or onboarding.

Dark Fade background, radius 20px, padding 56–80px vertical. Heading white Plus Jakarta Sans 48px weight 700; body Fog `#b3b3b3` 16px Inter; accent words Brand Lime.

### Checklist Item
**Role:** benefit bullets and onboarding steps ("Police forms ready in one tap").

Brand 700 check icon 18px, lead text Ink 16px weight 600, descriptor Slate. Row gap 8–12px.

### Field (label, input, hint, error)
**Role:** every form input.

Label Ink 14px weight 500 above the input. Input white, 1px Line Strong border, radius 9px, min height 44px, padding 0 12px, Inter 16px (16px avoids zoom on iPhone). Focus: Brand 600 border plus the focus halo. Error: Danger border and a Danger message under the field, linked with `aria-describedby`. Hint in Slate 14px.

### Avatar Cluster
**Role:** team members on a property or task.

Circles 24–32px, overlapping by 8px, 2px white ring. Initials on Mercury, or on Brand 50 with Brand 700 text for the current user.

### Lime Border
**Role:** one hero call to action or the plan the user is on.

A 2px Lime Conic border rotating at 4s linear infinite (slower than the reference: calm, not flashy), inner fill white, radius matching its content. Static under `prefers-reduced-motion`. One per page.

## Do's and Don'ts

### Do
- Use Plus Jakarta Sans at weight 700–800 for any text 34px or larger, with the negative tracking above.
- Default every button, tag, badge, status pill and nav item to radius 9999px.
- Use Brand Lime for the primary action fill (with Ink text) and Brand 700 for brand-coloured text and links on light surfaces.
- Use Ink `#202020` (not `#000`) for text and the dark button.
- Keep every text pair at 4.5:1 or more; borders of controls and focus rings at 3:1.
- Snap spacing to the 4px grid.
- Use 1px Bone as the default border; Line Strong for inputs.
- Put a word in every status pill, and the estimate notice under every tax figure.
- Give every interactive element a visible focus ring (2px Ink on light surfaces, Brand Lime on dark; offset 2px).
- Mirror layouts in Arabic (`dir="rtl"`, logical properties such as `ps-4`, `ms-auto`).

### Don't
- Don't put white text on Brand Lime `#e4f222`, and don't use lime as text, an icon or a thin line on a white or mist surface (1.2:1); use Brand 700 or Ink.
- Don't use lime for success or for "good" numbers; lime is the brand, not a state.
- Don't use Plus Jakarta Sans below 14px; switch to Inter.
- Don't mix radii within one component family.
- Don't stack more than two surface levels in a section.
- Don't use letter-spacing above 0 for body text; positive tracking is for uppercase mono labels only.
- Don't add gradients to cards or backgrounds; gradients belong to the logo, one hero word and the lime border.
- Don't write "certified", "guaranteed" or "DGSN-compliant", and don't imply a figure is final.
- Don't show ID scans or guest personal data as decoration or in marketing screenshots; use invented sample data clearly marked as such.

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 1 | Canvas | `#ffffff` | Marketing page background, cards, inputs. |
| 2 | Mist | `#f8f9fa` | App page background, secondary panels. |
| 3 | Plaster | `#e9ebf0` | Marketing section band. |
| 4 | Dark Panel | `#111111` → `#000000` | Dark feature sections. |
| 5 | Night | `#0f0f10` | Logo tile, app icon, dark theme canvas. |

## Elevation

Elevation is negative space rather than shadow. Cards are defined by a 1px Bone border or a Mist to white shift. The product screenshot and dialogs get the `lift` shadow; nothing else does.

## Imagery

Product first. The marketing site shows real RiadTax screens (the dashboard, the day counter, a status list) with invented sample data. Secondary visuals: partner and platform logos in grayscale, and the Badge R mark. No stock photos of tourists, no guest faces, no ID documents. Icons are line icons at 1.5–2px stroke (Lucide), Ink or Slate, Brand 600 only for the active state.

## Layout

**App:** a 224px sidebar (logo, account name, nav pills) and a content column up to 896px, on Mist. The top bar holds the language switch, the user and "Log out". Under 768px the sidebar becomes a top bar with horizontally scrolling nav pills.

**Marketing:** max-width 1200px. Hero in two columns: headline (60–80px), checklist, primary button and tags on the left; product screenshot on the right. Then a platform-logo strip, a stats band, a dark feature card and the footer. Section gaps 80px, element gaps 8–12px.

## Motion

Durations: 150ms for hover and focus, 250–300ms for state changes, 450ms with `cubic-bezier(0.33, 1, 0.68, 1)` for content settling in. The lime border rotates at 4s linear. Everything respects `prefers-reduced-motion: reduce` (no rotation, instant transitions).

## Agent Prompt Guide

**Quick Color Reference**
- Text: `#202020` (primary), `#646464` (secondary), `#767676` (tertiary)
- Background: `#ffffff` (canvas), `#f8f9fa` (app page), `#e9ebf0` (section band)
- Border: `#e8e8e8` (default), `#8a8a8a` (inputs), `#202020` (focus on light)
- Brand: `#e4f222` (identity and primary fill, always with dark text), `#5c6600` (links, brand text on light)

**Example component prompts**

1. **Primary button:** `#e4f222` background, `#202020` Plus Jakarta Sans 14px/700 text, radius 9999px, padding 12px 24px, min height 44px; hover `#cddd12`; 2px `#202020` focus ring.
2. **Stat card:** white, 1px `#e8e8e8` border, radius 12px, padding 28px. Label "NIGHTS RENTED 2026" in JetBrains Mono 10px uppercase `#646464`; number "87" in Plus Jakarta Sans 60px/700 `#0f0f10`, tracking −0.035em; caption "of the yearly limit set in your rules" in Inter 14px `#646464`.
3. **Dark feature card:** dark fade background, radius 20px, padding 80px 40px. White headline Plus Jakarta Sans 48px/700; body `#b3b3b3` Inter 16px; one word in `#e4f222`; a primary button inside the lime border.

## Quick Start

### Tailwind v4 (`apps/web/app/globals.css`)

```css
@theme {
  --color-ink: #202020;
  --color-night: #0f0f10;
  --color-carbon: #2a2a2a;
  --color-slate: #646464;
  --color-ash: #767676;
  --color-line-strong: #8a8a8a;
  --color-fog: #b3b3b3;
  --color-cloud: #d4d4d4;
  --color-bone: #e8e8e8;
  --color-mercury: #eeeeee;
  --color-mist: #f8f9fa;
  --color-plaster: #e9ebf0;

  --color-brand-50: #f6fac8;
  --color-brand-100: #f0f79a;
  --color-brand-500: #e4f222;
  --color-brand-deep: #b9cc00;
  --color-brand-600: #cddd12;
  --color-brand-700: #5c6600;
  --color-brand-800: #454d00;

  --color-success: #0f7b4b;
  --color-success-soft: #dcf5e8;
  --color-warning: #8a5300;
  --color-warning-soft: #fff4d6;
  --color-danger: #b42318;
  --color-danger-soft: #fde8e6;
  --color-info: #0b62c4;
  --color-info-soft: #e5f0fc;

  --font-display: "Plus Jakarta Sans Variable", "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
  --font-sans: "Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace;

  --radius-input: 9px;
  --radius-card: 12px;
  --radius-image: 16px;
  --radius-card-lg: 20px;

  --shadow-subtle: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
  --shadow-sm: 0 4px 4px 0 rgb(13 21 48 / 0.04);
  --shadow-lift: 0 1px 1px -0.5px rgb(15 15 16 / 0.04), 0 3px 3px -1.5px rgb(15 15 16 / 0.04), 0 6px 6px -3px rgb(15 15 16 / 0.04), 0 12px 12px -6px rgb(15 15 16 / 0.04);
  --shadow-focus: 0 0 0 3px #f0f79a;
}
```

### Dark theme values

| Token | Light | Dark |
|-------|-------|------|
| canvas | `#ffffff` | `#0f0f10` |
| mist (page) | `#f8f9fa` | `#141416` |
| card | `#ffffff` | `#1a1a1d` |
| ink | `#202020` | `#f5f5f4` |
| slate | `#646464` | `#a8a8a8` |
| ash | `#767676` | `#8a8a8a` |
| bone (border) | `#e8e8e8` | `#2e2e33` |
| line-strong | `#8a8a8a` | `#6b6b73` |
| primary fill / text on it | `#e4f222` / `#202020` | `#e4f222` / `#0f0f10` |
| link, brand text | `#5c6600` | `#e4f222` |
| brand-50 (tint) | `#f6fac8` | `#22260a` |
| success / soft | `#0f7b4b` / `#dcf5e8` | `#5ee0a0` / `#10281c` |
| warning / soft | `#8a5300` / `#fff4d6` | `#ffc857` / `#2b2108` |
| danger / soft | `#b42318` / `#fde8e6` | `#ff8a80` / `#2d1210` |
| info / soft | `#0b62c4` / `#e5f0fc` | `#7ab8ff` / `#0f1f33` |
