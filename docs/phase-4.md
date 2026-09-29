# Phase 4 — Monthly Police Register and Secure Share

Part of the [roadmap](../README.md). Built solo with Claude: each numbered step below is one short, single-feature session. Template and conventions: [`phase-1.md`](phase-1.md), [`phase-3.md`](phase-3.md) (whose patterns this phase reuses: storage service, token in the URL fragment and a header, audited reads, retention).

**Goal:** a manager produces one printable Police Register per property and month from the Fiches already collected, sees which records are incomplete before exporting, and can give an authority a time-limited link to a Fiche or a Register. Passports and Fiches stop travelling through chat groups and e-mail attachments.

**Why it matters:** this is the first feature that deliberately puts guest personal data in front of a person who has no account. A leaked or forwarded link is a data-protection incident, and an authority opening the wrong month's register is an embarrassment. The token handling, expiry, revocation and access log matter more than the screens.

**Phase 3 status this phase depends on:** the guest flow, Fiche PDFs and retention are built; the legal gates are still open (see the tracker in [`phase-3.md`](phase-3.md)). Phase 4 can be built and tested with synthetic data in parallel, and follows the same rule: behind a feature flag in production until the gates close.

---

## Carried over from Phase 3

| Item | Why it lands here |
|---|---|
| Hard gates still open (CNDP, hosting region, consent wording, official police form, retention of Fiche and register, mail provider, incident runbook) | The register is the document the official form most directly governs; a Secure Share link is a second way personal data leaves the system |
| Retention of the monthly register and of the Fiche PDFs (`StoredObject.expiresAt` is null today) | Counsel decides how long they are kept; set it as a `RuleConfig` row and let the retention job apply it |
| Staff access to the Fiche PDF (status only today) | Sharing raises the same question: who may create a share link, who may open a Fiche |
| WhatsApp delivery of links (the manager's button sends the message text, token included, to `wa.me`) | Share links will be sent the same way; the WhatsApp Business API is Phase 6, so document the exposure and keep tokens short-lived |
| A "Open the Fiche" check in a real PDF viewer (headless Chromium cannot render one) | Manual test on a phone before the pilot; note it in the pilot checklist |
| Production enablement checklist for `GUEST_CHECKIN_ENABLED` (bucket, worker network, alerts, backups, key backup) | Nothing new to build; run it before any real guest data |
| CIN / CNIE structured OCR, Arabic guest form | After real cards are tested and after the pilot, as decided in the solo plan |

---

## Scope

### In
- **Monthly Police Register** per property and month: every guest whose stay in that property overlaps the month, ordered by arrival, one row per guest, generated as a PDF (HTML → PDF with Playwright, as for the Fiche), stored encrypted, regenerable
- **Pre-export validation**: a report of incomplete records (missing mandatory fields, unverified guests, guests still in draft, stays with no check-in) shown before and after generating, so nothing incomplete goes out unnoticed
- **Secure Share** for a Fiche or a Register: 256-bit token (only its hash stored), expiry between 24 and 72 hours (bounds in `RuleConfig`), revocable at once, recipient label, access log, `no-store` and `noindex`, a confidentiality notice, a neutral page for unknown, expired and revoked links
- **Public viewer**: a page opened from the link that streams the PDF; no account, no navigation
- Manager screens: registers per property and month with the validation report; share dialog; list of links with status, views and revoke
- Audit of every register generation and read, every share creation, revocation and access
- Feature flag `POLICE_REGISTER_ENABLED` and `SECURE_SHARE_ENABLED` (off by default in production)

### Out (later phases)
- View limits and watermarking: not until customers ask (solo plan in the README)
- WhatsApp Business API delivery → Phase 6 (the manager sends the link with the same prefilled `wa.me` message)
- Automatic submission to the authorities, if a channel exists → to be researched with counsel
- Tax exports and the Accountant portal → Phase 5
- Arabic register layout beyond what the official form requires → after the pilot

---

## Decisions to lock before coding

| Topic | Recommendation | Reason |
|---|---|---|
| Register layout and content | Follow the official form once obtained (hard gate); versioned template, wording "laid out like the form" is never used: "indicative layout, compare with the official form" | Same rule as the Fiche (rule 2 in `CLAUDE.md`) |
| Which guests are in a month | Stays whose nights fall in the month (`checkIn` ≤ last day of month and `checkOut` > first day), listed under the month of **arrival** to avoid double counting; stays crossing months appear once, with a note | A guest must appear exactly once |
| What counts as incomplete | A `SUBMITTED` or `VERIFIED` guest missing any of the four mandatory fields or the document number; a stay with fewer submitted guests than its party size; a `PENDING` draft | Mirrors the server-side rules of the guest form |
| Who may generate and share | Owner/Manager only (`register:read`, `share:manage`); Staff see whether a register exists | Least privilege; Staff cannot read guest fields today |
| Share token | 256-bit random, hash stored, sent in the URL fragment and read from a header, as in Phase 3 (never in a path or query) | Keeps it out of logs and link-preview requests |
| Expiry | Chosen by the manager between the `share.min_hours` and `share.max_hours` RuleConfig bounds (24 and 72 by default); no "never expires" | Limits a forwarded link |
| What an access records | Time, share link id, and a coarse user-agent; **the viewer's IP address is stored only if counsel says the authority's access must be attributable** | The Phase 3 review removed IPs from guest audit rows for minimisation; an authority is a different case and needs a decision |
| Views | Count views (`viewCount` exists) but do not limit them (out of scope) | Solo plan |
| PDF served by | The API, decrypted in memory, `Content-Disposition: inline`, `no-store`, after the access is recorded (fail closed, as for images) | Same pattern as `guests/:id/document` |
| Register retention | A `RuleConfig` row, applied by the existing retention job to the register's `StoredObject.expiresAt` | Counsel sets it; not hard-coded |
| Recipient label | Free text, 2–80 characters, no markup; shown to the manager only | Helps the manager remember who got what; never shown to the recipient |

---

## Data model changes

| Model | Change |
|---|---|
| `PoliceRegister` | Add `accountId`, `pdfObjectId` (a `StoredObject`, replaces `pdfUrl`), `templateVersion`, `sha256`, `guestCount`, `validation` (JSON: counts by problem, never names); unique `(propertyId, month)` so regenerating replaces the row and shreds the old PDF; composite keys with `accountId` |
| `StoredObject.kind` | Add `POLICE_REGISTER_PDF` |
| `ShareLink` | Add composite `(id, accountId)` unique; keep `tokenHash`, `expiresAt`, `revokedAt`, `viewCount`; `resourceId` is validated in the service against the account (a polymorphic id cannot carry a foreign key, so the service and a test guard it) |
| `ShareAccess` (new) | `id`, `accountId`, `shareLinkId`, `at`, `userAgent` (trimmed); one row per successful view only, so failed attempts with unknown tokens never store attacker-supplied input |
| `RuleConfig` | `share.min_hours` (24), `share.max_hours` (72), `retention.police_register_days` and `retention.fiche_days` (values from counsel, unvalidated until then) |
| `AuditAction` | `register.generated`, `register.read`, `share.created`, `share.revoked`, `share.accessed` |
| Capabilities | `register:read` (Owner/Manager), `share:manage` (Owner/Manager); Staff and Accountant get neither |

---

## API surface

| Route | Method | Access | Notes |
|---|---|---|---|
| `/properties/:id/registers` | GET | `booking:read` | Months with status (none, generated, outdated) and the validation counts; Staff see status only |
| `/properties/:id/registers/:month/validation` | GET | `register:read` | The incomplete records, by guest id and problem |
| `/properties/:id/registers/:month` | POST | `register:read` | Generate or regenerate; audited |
| `/properties/:id/registers/:month/pdf` | GET | `register:read` | Decrypts, audits, streams; `no-store` |
| `/shares` | POST / GET | `share:manage` | Create for a Fiche or Register (returns the token and URL once); list with status and views |
| `/shares/:id` | DELETE | `share:manage` | Revoke; takes effect at once |
| `/shares/:id/access` | GET | `share:manage` | Who looked, when |
| `/share` | GET | public, token in `X-Share-Token` | Neutral 404 for unknown, expired and revoked; returns the PDF after recording the access |

Every route goes into the permission matrix; every `:id` route into the tenant-isolation suite; the public route gets its own abuse and logging tests, as in Phase 3.

---

## Screens

| # | Screen | Notes |
|---|---|---|
| 10 | Registers (per property) | Month list with status pills, validation counts, "Generate", "Open the PDF", "Share" |
| 11 | Validation report | The incomplete records with the missing field named and a link to the guest dialog |
| 12 | Share dialog | Choose expiry (within the bounds), recipient label; shows the link once with copy and WhatsApp buttons (same component pattern as the check-in link dialog) |
| 13 | Shares list | Links with status, expiry, views, revoke, access log |
| – | Public viewer (`/s#token=…`) | No navigation; confidentiality notice; the PDF; a neutral page when the link is not available |

---

## Work breakdown

| Step | Work | Model |
|---|---|---|
| 4.0 | Carry-overs that need code: retention rows for the Fiche and register, the production enablement check, the pilot manual-test list | fast |
| 4.1 | Data model, migration, capabilities, RuleConfig rows, feature flags | fast |
| 4.2 | **Register generator**: month query, validation report, versioned template, PDF, encrypted storage, regenerate, audit | strong |
| 4.3 | **Secure Share API**: create, list, revoke, access log, the public route with fail-closed access recording | strong |
| 4.4 | Web: registers, validation report, share dialog, shares list | fast |
| 4.5 | Web: public viewer page | fast |
| 4.6 | Hardening: abuse and logging tests for the public route, security review, phone e2e, docs, Phase 5 plan | strong |

Steps 4.2 and 4.3 carry the risk.

---

## Tests required

- **Register:** a guest appears exactly once across months; stays crossing a month boundary; cancelled stays and owner blocks excluded; incomplete records reported by id and problem (never names in the summary); regenerate replaces and shreds the previous PDF; another account gets 404; Staff and Accountant refused; every read audited before any byte is returned; the template escapes every value and never claims compliance.
- **Secure Share:** the token is stored only as a hash; expired, revoked, unknown and cancelled-resource links answer identically; expiry outside the bounds refused; revoking takes effect on the next request; a share for another account's resource is refused; access is recorded before the PDF is returned (fail closed); the token is in no URL, log or audit row; per-IP and per-link limits hold.
- **Logging:** the Phase 3 redaction suite extended to every new route, including a share link opened with a token in a wrong place.
- **E2E (phone viewport):** manager generates a register, sees the validation report, shares it, opens the link in a fresh browser context, then revokes it and the same link shows the neutral page.

---

## Security checklist for this phase

- [ ] Tokens: 256-bit, hash only, fragment + header, never in a URL, log, audit row or response after creation
- [ ] Public route: neutral errors, `no-store`, `noindex`, `Referrer-Policy: no-referrer`, rate limits, no third-party scripts, no cookies, no CORS
- [ ] The PDF is decrypted in memory, served only after the access is recorded, and never linked by URL
- [ ] Expiry and revocation enforced on every request (no cached authorisation)
- [ ] A share cannot point at another account's Fiche or Register (service check plus test)
- [ ] Feature flags off by default in production; the register and share routes answer 404 when off
- [ ] Retention applied to registers and Fiches from `RuleConfig`; the purge revokes shares that point at a purged file

---

## Definition of done

1. A manager generates a register for a month with synthetic guests, sees and fixes the incomplete records, regenerates it, and shares it.
2. The recipient opens the link on a phone without an account and sees the PDF; after expiry or revocation the same link shows the neutral page.
3. Every generation, read, share creation, revocation and access is in the audit trail; no token or personal data is in the logs.
4. The abuse, access, isolation and logging suites pass in CI.
5. Security review has no open high-severity finding.
6. `docs/phase-5.md` written; the hard gates above are tracked with an owner and a date.

## Risks

| Risk | Mitigation |
|---|---|
| A link is forwarded or leaked | Short expiry (24–72 h), instant revocation, access log the manager can read, no view of anything but the one file |
| An incomplete or wrong register reaches an authority | The validation report before export and after; the manager can correct and regenerate; wording "compare with the official form" |
| The official form changes the register layout | Template versioned and separate from the data; the register stores its template version |
| Access logs become a store of personal data of authority staff | Store time and a trimmed user agent only; the IP question is put to counsel |
| Sharing tempts managers to keep files longer than allowed | Registers and Fiches follow the retention rows; the purge revokes shares that point at a purged file |
| Chat apps see the token (`wa.me`) | Same accepted risk as the check-in link; short expiry; the Business API in Phase 6 |

## Open decisions (need your answer)

1. The official police form and register: who provides it, and does the prefecture accept a PDF or require paper?
2. Retention of the register and of the Fiche (a number of years?), from counsel.
3. Should the authority's access be attributable (store their IP address) or minimised (time and browser only)?
4. Who may create a share link: Owner/Manager only (recommended), or Staff too?
5. Is a 72-hour maximum right, and is 24 hours a useful minimum?
6. Do you want a view limit or a watermark in this phase, or wait until a customer asks (the solo plan says wait)?
