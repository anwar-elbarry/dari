# Phase 2 — Calendar sync and 120-day counter

Part of the [roadmap](../README.md). Built solo with Claude: each numbered step below is one short, single-feature session. Template and conventions: [`phase-1.md`](phase-1.md).

**Goal:** for each unlicensed property, an accurate and trustworthy count of booked nights in the calendar year, fed by Airbnb / Booking.com iCal links and a historical import, with alerts at 90 and 110 nights.

**Why it matters:** the day counter is the first thing customers pay for. A wrong count is worse than none: it either scares the manager for nothing or lets them cross the cap without warning. Accuracy and transparency (showing *why* a night counts) matter more than screens.

---

## Carried over from Phase 1

| Item | Why it lands here |
|---|---|
| Production mail driver (Resend or Brevo) | Alerts are emailed; the API cannot start in production without it |
| Move login lockout and rate-limit counters to Redis | Redis arrives with the job runner; allows more than one API instance |
| Edge proxy overwrites `X-Forwarded-For` (see [`deployment.md`](deployment.md)) | Must be in place before any public deployment |
| Hosting region decision | Needed before any real calendar or revenue data is stored |
| `__Host-` cookie prefix once the domain is fixed | Security review follow-up (see `deployment.md`) |
| Composite (ownerId, accountId) foreign key, same pattern for new tables | Database-level guard behind the account scope |

---

## Scope

### In
- iCal feeds per property and platform (Airbnb, Booking.com, direct/other): add, edit, remove, last sync status
- Background job runner (BullMQ + Redis) and scheduled sync every 1–4 h, plus "sync now"
- Event classification: booking vs owner block, with a **review list** and manual override
- Historical import since 1 January: Dari CSV template + column mapper + preview with error rows (revenue columns stored for Phase 5)
- Day counter per unlicensed property and calendar year; projected breach date from future bookings
- Alerts at 90 (amber) and 110 (red) nights, once per threshold per property per year; email to Owner/Manager; dashboard feed
- Screens: onboarding iCal step (skippable), import, dashboard, property detail (screens 4–7 of the Tech Spec)

### Out (later phases)
- Guest check-in, Fiche de Police → Phase 3
- Revenue reports and tax → Phase 5 (revenue fields are imported and stored now, not computed)
- WhatsApp alerts → Phase 6 (email only here)
- Notifications centre with read/unread → fast-follow
- Parsing platform-specific earnings exports (Airbnb / Booking CSV formats) → after the pilot; the Dari template comes first

---

## Decisions to lock before coding

| Topic | Recommendation | Reason |
|---|---|---|
| Legal rule | Confirm with counsel: which properties the 120-night cap applies to, calendar year vs rolling 12 months, and what counts as a night | The counter encodes a legal rule; thresholds (90 / 110 / 120) go in `RuleConfig`, never in code |
| Tenancy for new tables | Add `accountId` to `Booking`, `IcalFeed`, `ImportBatch` and register them in `TENANT_MODELS` | Keeps the Phase 1 account scope simple and fail-closed instead of relation-based rules |
| iCal URL secrecy | Treat iCal URLs as secrets: Owner/Manager only, never sent to Staff, not written to logs or audit | Anyone with the link can read the calendar |
| SSRF protection | HTTPS only; resolve DNS and refuse private, loopback, link-local and metadata IPs (also after redirects); 10 s timeout; 2 MB max; max 3 redirects | The server fetches URLs typed by users |
| Host allowlist | Start permissive (any public HTTPS host) plus the SSRF rules; log the host of each feed | Direct-booking tools use many hosts; revisit after the pilot |
| Past vs future events | Past nights (checkout before today) are **frozen**: never deleted because they disappeared from a feed. Future events missing from the feed are marked cancelled | Platforms trim old events from exports; the count must not drop |
| Owner blocks | Auto-classify by summary patterns per platform; anything uncertain goes to the review list as "uncertain" and does **not** count until confirmed | Booking.com and Airbnb do not always distinguish blocks from bookings |
| Date semantics | Dates only (no times), `Africa/Casablanca` for "today"; a stay covers `[checkIn, checkOut)` | Matches `countNights` from Phase 0 |
| Alert channel | Email now; dashboard feed; WhatsApp in Phase 6 | Avoids waiting on Meta verification |
| Redis hosting | Managed Redis in the same region as Postgres | Job queue + limiters |

---

## Data model changes

| Model | Change |
|---|---|
| `IcalFeed` (new) | `id`, `accountId`, `propertyId`, `platform` (AIRBNB / BOOKING / DIRECT / OTHER), `url` (secret), `lastSyncedAt`, `lastStatus` (OK / ERROR / NEVER), `lastError` (sanitised, no URL), `eventCount`, `createdAt`. Unique (`propertyId`, `platform`) |
| `Booking` | Add `accountId`, `feedId?`, `classification` (BOOKING / OWNER_BLOCK / UNCERTAIN), `classifiedBy` (AUTO / MANUAL), `status` (CONFIRMED / CANCELLED), `cancelledAt`, `summary` (trimmed, no guest names stored if present), `importBatchId?`, `confirmationCode?`. Unique (`feedId`, `externalUid`) replaces (`propertyId`, `externalUid`) |
| `ImportBatch` (new) | `id`, `accountId`, `propertyId`, `fileName`, `rowCount`, `importedCount`, `errorCount`, `createdBy`, `createdAt` |
| `Notification` | Add unique (`accountId`, `type`, `propertyId`, `year`) for threshold alerts so each fires once |
| `RuleConfig` | Seed `day_counter.thresholds = { amber: 90, red: 110, cap: 120 }` with `validatedBy = null` until counsel confirms |

---

## API surface

| Route | Method | Capability | Notes |
|---|---|---|---|
| `/properties/:id/feeds` | GET / POST | `ical:manage` | URL validated (HTTPS, SSRF rules) on create |
| `/properties/:id/feeds/:feedId` | PATCH / DELETE | `ical:manage` | Deleting a feed keeps frozen past bookings |
| `/properties/:id/feeds/:feedId/sync` | POST | `ical:manage` | Enqueue a sync now; rate limited |
| `/properties/:id/day-counter?year=` | GET | `booking:read` | Nights counted, level, projected breach date, thresholds used |
| `/properties/:id/bookings?from=&to=` | GET | `booking:read` | Staff: dates, source, classification only. Owner/Manager: + revenue fields |
| `/bookings/:id/classification` | PATCH | `booking:write` | Confirm booking / owner block; audited |
| `/properties/:id/imports/preview` | POST | `booking:write` | CSV upload (≤ 1 MB), mapping → preview rows with errors, nothing saved |
| `/properties/:id/imports` | POST | `booking:write` | Commit a previewed import; idempotent by confirmation code or dates |
| `/imports/template.csv` | GET | `booking:write` | Dari CSV template |
| `/dashboard` | GET | `booking:read` | Property cards + counters + open alerts for the account |
| `/alerts` / `/alerts/:id` | GET / PATCH | `booking:read` | Feed; resolve (Owner/Manager) |

New capabilities: `booking:read` (Owner/Manager, Staff), `booking:write` and `ical:manage` (Owner/Manager), `revenue:read` (Owner/Manager). Add each route to the permission matrix and every `:id` route to the tenant-isolation suite (both tests fail otherwise).

---

## Screens

| # | Screen | Notes |
|---|---|---|
| 4 | Onboarding — Connect iCal | Optional step at the end of the add-property wizard; paste link per platform; help text on where to find it in Airbnb / Booking.com |
| 5 | Historical import | Template download → upload → column mapping → preview with error rows → import |
| 6 | Main dashboard | Property cards with counter (green < 90, amber 90–110, red > 110), open alerts, "needs review" count |
| 7 | Property detail | Counter gauge and breakdown, projected breach date, list/calendar of stays, review list for uncertain events, feeds with last sync status |

Staff see counters and dates, never revenue or iCal URLs.

---

## Work breakdown

| Step | Work | Model |
|---|---|---|
| 2.0 ✅ | Carry-overs: Redis + BullMQ module, limiters on Redis, production mail driver (once chosen) | fast |
| 2.1 | Data model and migration; scope rules for new models; capabilities; seed `RuleConfig` | fast |
| 2.2 | **Safe iCal fetcher** (SSRF rules, limits) + parser + classifier with fixture files | strong |
| 2.3 | Sync job: schedule, upsert by UID, cancellations, frozen past, per-feed status, "sync now" | strong |
| 2.4 | Day counter service (thresholds from `RuleConfig`), projected breach date, `/day-counter` | fast |
| 2.5 | CSV import: template, mapping, preview, idempotent commit | fast |
| 2.6 | Threshold alerts: once per threshold/year, email, dashboard feed, resolve | fast |
| 2.7 | Web: iCal step in wizard + feeds panel; import screens | fast |
| 2.8 | Web: dashboard and property detail with review list | fast |
| 2.9 | Hardening: SSRF tests, accuracy check against real calendars, E2E, docs, Phase 3 plan | strong |

Rough effort solo: 3–4 weeks full-time. Steps 2.2 and 2.3 carry the risk.

---

## Tests required

- **Counter accuracy:** fixtures from real (anonymised) Airbnb and Booking.com exports; overlapping platforms; stays across 31 Dec / 1 Jan; blocks excluded; uncertain events excluded until confirmed.
- **Sync:** idempotent re-sync; event removed in the future → cancelled; event removed in the past → kept; feed error keeps previous data and records status.
- **SSRF:** refuses `http://`, `localhost`, `127.0.0.1`, `10.x`, `169.254.169.254`, IPv6 loopback, DNS names resolving to private IPs, and redirects to any of those; enforces size and time limits.
- **Import:** template round-trip; error rows reported with line numbers; re-importing the same file creates no duplicates.
- **Alerts:** 90 and 110 fire once each per property and year; licensed properties never alert.
- **Access:** matrix rows for every new route; tenant-isolation cases for every `:id` route; Staff never receive revenue fields or iCal URLs.
- **E2E:** add feed (served by a local fixture server) → sync → counter visible on dashboard.

---

## Security checklist for this phase

- [ ] SSRF protection on every outbound fetch, tested
- [ ] iCal URLs never in logs, errors, audit rows or Staff responses
- [ ] CSV upload: size limit, CSV only, no formula injection when exporting back (`=`, `+`, `-`, `@` prefixes escaped)
- [ ] Job payloads carry ids only, never URLs or personal data
- [ ] Redis not publicly reachable; password or TLS set

---

## Definition of done

1. A manager connects an Airbnb and a Booking.com calendar, imports earlier stays, and sees a counter that matches a manual count on a real property.
2. Owner blocks and uncertain events are visible in a review list and excluded until confirmed.
3. Alerts at 90 and 110 nights arrive by email once each.
4. Staff see counters but no revenue or iCal links.
5. SSRF, matrix and isolation suites pass in CI.
6. `docs/phase-3.md` written.

## Risks

| Risk | Mitigation |
|---|---|
| Wrong legal rule encoded | Thresholds and scope in `RuleConfig`, validated by counsel before real use |
| Platforms change iCal formats | Fixture tests; classifier falls back to "uncertain" rather than guessing |
| SSRF through iCal URLs | Dedicated fetcher with IP checks after DNS resolution and on redirects |
| Past nights lost when platforms trim feeds | Freeze past bookings |
| Count disputes with customers | Property detail shows exactly which nights count and why |

## Open decisions (need your answer)

1. Counsel: exact scope of the 120-night rule (which properties, calendar year or rolling, principal residence condition).
2. Provide 2–3 real iCal exports (Airbnb, Booking.com) and one earnings CSV, anonymised, as test fixtures.
3. Sync frequency: every 2 hours by default?
4. Mail provider (still open from Phase 1): Resend or Brevo.
5. Redis provider and region.
