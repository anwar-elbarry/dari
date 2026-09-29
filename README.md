# Dari

Morocco STR Compliance & Tax Platform — SaaS for short-term-rental managers (3–20 properties), launching in Marrakech.

Sources of truth: *Business MVP Spec V3 (EN/AR)* and *Technical Spec V2*. Layout, commands and non-negotiable rules are in [`CLAUDE.md`](CLAUDE.md).

**Quick start:** `cp .env.example .env && docker compose up -d && npm install && npm run db:generate`
**Checks:** `npm run lint` · `npm run typecheck` · `npm test` · `cd services/ocr && pytest`

---

## Roadmap at a glance

| Phase | Scope | Gate to exit | Status |
|---|---|---|---|
| 0 | Foundations + legal kickoff | Repo builds, CI checks pass, legal tracks started | Code done · legal open |
| 1 | Auth, RBAC, accounts, properties, onboarding | A manager can sign up and add a property | **Done** (see outcome in `docs/phase-1.md`) |
| 2 | iCal sync, CSV import, 120-day counter, dashboard, alerts | Day counter matches a hand-checked real calendar | In progress (steps 2.0–2.2 done) — [`docs/phase-2.md`](docs/phase-2.md) |
| 3 | Guest check-in, OCR/MRZ, Fiche de Police, consent, retention | A test guest completes check-in and a PDF is produced | Not started |
| 4 | Monthly Police Register, Secure Share | Share link expires and revokes correctly, access logged | Not started |
| 5 | Tax engine, exports, Accountant portal | **Fiduciaire has validated formulas and seeded TaxRule** | Blocked on fiduciaire |
| 6 | Licensing checklist, team management, WhatsApp | Invites and seat limits work; WhatsApp message delivered | Not started |
| 7 | Security review, hardening, pilot | Counsel sign-off + 5–10 pilot customers onboarded | Not started |
| 8 | Fast-follow | Driven by pilot feedback | Not started |

The Tech Spec estimates ~12–14 weeks for 2–3 engineers. **This project is built solo with Claude**, so the plan below applies the solo adjustments in the next section. Realistic solo estimate: about 5–7 months full-time, longer part-time. Cut scope before cutting quality on anything touching ID data or tax.

---

## Solo plan: what changes

**Ship a thin compliance core first, sell it, then widen.** The 120-day counter and the check-in / Fiche de Police flow are the reason customers pay. Tax and the rest come after the first paying pilots.

| Change vs the full plan | Why |
|---|---|
| Re-order: 0 → 1 → 2 → 3 → **pilot** → 4 → 5 → 6 | Get 3–5 real conciergeries on the counter and check-in before building tax and sharing |
| Languages: **FR + EN first**, Arabic/RTL added after the pilot | RTL doubles UI and PDF testing; Marrakech conciergeries work in French |
| Phase 4 Secure Share: ship the expiring link only; skip view limits and watermark until asked | Smallest version that removes passports from WhatsApp groups |
| Phase 6 WhatsApp API: start with a prefilled `wa.me` link the manager sends | Avoids waiting on Meta verification; add the API once customers ask |
| Marital-certificate flow: **not built** until counsel has reviewed it | Highest legal risk, lowest revenue value |
| Tax engine: start with the **report and exports only** on data the fiduciaire has validated | Blocked on an outside party anyway, so schedule it after the pilot |
| Billing, notifications centre, Upsell, vendor ledger, KPIs | Stay fast-follow; manual invoicing for the first customers |
| Use managed services (hosted Postgres, Redis, object storage) rather than running your own | You are also the on-call engineer |

**Your time is split three ways:** building with Claude, the legal and fiduciaire track, and selling. Block time for the second and third every week; the legal items have waiting periods that code cannot shorten.

**Credits ($250):** treat them as covering roughly Phases 1–3 with careful use, not the whole product. Plan the rest on a subscription plan or further credits. Keep sessions short and single-feature, and use the stronger model only for architecture, tax, RBAC and security review.

**Solo risk controls:** automated tests on the permission matrix and retention job (you will not catch regressions by eye), daily database backups with one tested restore, and a written runbook for an ID-data incident before the first pilot.

---

## Parallel legal / business track (gates releases)

Not code, but it decides when real customer data may be processed. Start in week 1.

| Item | Needed before | Owner |
|---|---|---|
| CNDP declaration (company level); check whether the marriage-certificate flow needs an authorization rather than a declaration | Processing any real guest data | Founder + counsel |
| Meta WhatsApp Business verification | Phase 6 | Founder |
| Fiduciaire validation: tax formulas, rates, thresholds, Taxe de Séjour treatment, and whether furnished tourist rental falls under property income or professional income | Phase 5 | Fiduciaire |
| Lawyer review of the Article 490 marital flow | Enabling it for real customers | Counsel |
| Retention period for police registers vs the 30-day ID purge | Phase 4 | Counsel |
| Hosting region for personal data (Morocco / EU) | Phase 1 infrastructure choice | Founder + counsel |
| Terms of use, privacy policy, professional liability insurance (RC Pro) | Pilot | Founder + counsel |
| Test real Moroccan CIN / CNIE cards for MRZ presence | Phase 3 OCR spike | Founder |

---

## Phase 0 — Foundations

**Goal:** a repo any session can build, test and lint from a cold start.

- [x] Monorepo: NestJS API, Next.js web, Python OCR worker
- [x] Prisma schema (15 core + 3 fast-follow entities), `CLAUDE.md`, SessionStart hook
- [x] Pure, tested day counter and gross-base functions
- [x] CI (GitHub Actions): lint, typecheck, tests, `prisma validate`, migrate + seed on Postgres, OCR tests (done in Phase 1 step 1.0)
- [x] First Prisma migration and seed script (demo account, one user per role)
- [ ] Legal track kicked off (table above)

## Phase 1 — Identity, accounts and properties

**Detailed plan:** [`docs/phase-1.md`](docs/phase-1.md)

**Goal:** a manager signs up, invites staff, and adds properties and owners.

- Auth: signup, login, password reset, invitations; JWT with refresh
- RBAC guard enforced on every route for the 3 roles (Owner/Manager, Staff, Accountant), with tests for the permission matrix (Tech Spec §7)
- Account, User, PropertyOwner, Property CRUD (license status and type, tax regime, Taxe de Séjour mode)
- Onboarding wizard (screens 1–3) and app shell with FR / EN / AR and RTL
- Audit log service (used by every later phase)

**Exit:** permission-matrix tests pass; a Staff user cannot reach any financial or ID endpoint.

## Phase 2 — Calendar sync and 120-day counter

**Detailed plan:** [`docs/phase-2.md`](docs/phase-2.md)

**Goal:** an accurate, trustworthy day count per unlicensed property.

- Background job runner (BullMQ + Redis)
- iCal sync every 1–4 h, idempotent by event UID; owner blocks flagged and excluded, shown for review
- Historical CSV import with column mapper and error preview (revenue, cleaning, discounts, refunds, commission)
- Day counter service wired to `countNights`, thresholds read from `RuleConfig`
- Dashboard and Property Detail (screens 6–7): green / amber / red, projected breach date
- Notification service: 90 and 110 alerts by email

**Exit:** a real Airbnb + Booking.com calendar pair gives the same count as a manual check, including overlapping bookings and block events.

## Phase 3 — Guest check-in and Fiche de Police

**Goal:** replace WhatsApp passport sharing with a consented, secure flow.

- OCR spike first (1 week max): passport MRZ library, CIN / CNIE approach, confidence scores; self-hosted worker only
- Encrypted object storage (AES-256), private access only, retention job (default 30 days post-checkout)
- Single-use check-in link (hashed token), mobile-first form, FR / EN / AR, OCR review screen
- Server-enforced mandatory fields (entry stamp, city of origin, next destination, profession), dual-nationality question
- Consent capture with timestamp and version
- Fiche de Police PDF (HTML → PDF with Playwright, Arabic-safe), list and preview screen
- Marital-certificate flow **built behind a feature flag, off by default**, with red alert and resolve / exempt actions

**Exit:** end-to-end test on a phone; every ID read appears in the audit log; the retention job deletes raw images and keeps structured records.

## Phase 4 — Police register and Secure Share

**Goal:** one printable monthly register and safe sharing with authorities.

- Monthly Police Register generator with pre-export validation of incomplete records
- Secure Share: 256-bit token (hash stored), expiry 24–72 h, view limit, instant revocation, access log, `no-store` / `noindex`, confidential notice
- Public viewer page and expired / revoked state

**Exit:** expired and revoked links show the neutral page; tokens never appear in logs.

## Phase 5 — Tax engine and Accountant portal

**Goal:** monthly estimates the fiduciaire can rely on. **Do not start before the fiduciaire has confirmed the rules.**

- `TaxRule` and `RuleConfig` seeded from the fiduciaire's validation, with `validatedBy`
- Pipeline: gross base → Taxe de Séjour treatment → regime (property income / professional / company) → local taxes → output
- Nights revenue and add-on commissions reported separately; non-resident / MRE statement
- PDF and Excel export with the mandatory "estimate only" disclaimer (versioned)
- Accountant portal: read-only reports, no guest data
- Golden-file tests built from fiduciaire-supplied worked examples

**Exit:** the engine reproduces the fiduciaire's worked examples to the centime.

## Phase 6 — Licensing checklist, team and messaging

- Marrakech checklist filtered by license type, document attachments, progress bar
- Team management: invitations, role changes, seat limits by plan
- WhatsApp Cloud API delivery of check-in links and alerts (email as fallback)

**Exit:** a manager can run a full property onboarding without help.

## Phase 7 — Hardening and pilot

*Solo: run a small pilot (3–5 customers, no real ID data until the CNDP filing is accepted) after Phase 3, then do the full hardening below before widening the launch.*

- `/security-review` and an independent pass on storage, tokens, RBAC and logging
- Pen-test checklist on public token routes; rate limiting; backup and restore drill
- Mobile and RTL testing on low-end Android devices
- Counsel sign-off on retention, consent wording, Secure Share and the marital flow
- Onboard 5–10 Marrakech pilot customers; manual invoicing

**Exit:** no open high-severity finding; legal sign-off recorded; pilot customers live.

## Phase 8 — Fast-follow (after pilot)

Order by pilot feedback. Default: tax report history → notifications centre → settings → billing (CMI / Payzone) → Upsell store with guardrails → vendor ledger → KPIs (Occupancy, ADR, RevPAR). Upsell adds roughly 3–4 weeks if pulled into the MVP.

---

## Success metrics (90 days after launch)

10–15 paying conciergeries in Marrakech · monthly tax-export usage above 70% · net revenue retention above 90% · zero confirmed CNDP or guest-data incident.

## Working rules for building with Claude

- One feature per session, on its own branch; keep `CLAUDE.md` current.
- When a phase is finished, create the detailed plan for the next one in `docs/phase-N.md` and link it here (rule recorded in `CLAUDE.md`).
- Use the stronger model for architecture, tax, RBAC and security review; the faster one for CRUD, screens and tests.
- Every PR needs tests; anything touching ID data, tokens or tax also gets a security review.
- Ambiguity in a legal or fiscal rule is a question for counsel or the fiduciaire, never a guess in code.
