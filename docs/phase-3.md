# Phase 3 — Guest check-in and Fiche de Police

Part of the [roadmap](../README.md). Built solo with Claude: each numbered step below is one short, single-feature session. Template and conventions: [`phase-1.md`](phase-1.md), [`phase-2.md`](phase-2.md).

**Goal:** replace passport photos in WhatsApp groups with a link the guest opens on their phone: they photograph their passport or CIN, review what was read, add the four fields a passport cannot give, consent, and submit. The manager gets a Fiche de Police PDF and never touches a photo in a chat again.

**Why it matters:** this is the first phase that stores personal data of people who are not customers (guests, often foreign nationals) and the most sensitive files in the product (ID scans). Every rule in `CLAUDE.md` about ID data applies from the first commit: encrypted private storage, no public URLs, access only for Owner/Manager, every read audited, automatic purge, no foreign processors. A mistake here is a CNDP incident, so tests and the security review matter more than screens.

---

## Hard gates before any real guest data

These are not code. Until they are done, the feature stays behind `GUEST_CHECKIN_ENABLED=false` in production and is used only with synthetic data.

| Gate | Owner |
|---|---|
| CNDP declaration filed and accepted (or the authorization it requires) for guest data processing | Founder + counsel |
| Hosting region for storage and database decided (Morocco or EU) and the cross-border position confirmed | Founder + counsel |
| Consent wording (FR/EN) and retention periods approved: raw images 30 days after checkout by default; retention of the Fiche and of the monthly register to be set | Counsel |
| The official police form (fields, layout) obtained from the prefecture / DGSN so the PDF follows it | Founder |
| Real Moroccan CIN / CNIE cards tested for an MRZ on the back (decides the OCR approach) | Founder |
| Incident runbook for a personal-data leak written | Founder |

---

## Carried over from Phase 2

| Item | Why it lands here |
|---|---|
| Production mail driver (Resend or Brevo) and hosting region | Guest and alert emails; storage location |
| `__Host-` session cookies once the domain is fixed | Security review follow-up; more sensitive data now |
| Composite (ownerId, accountId) foreign key, and the same pattern for new tenant tables (`GuestCheckIn.accountId`) | Database-level guard behind the account scope |
| Redact personal data from logs by construction (a logging test) | Guests' names and document numbers must never appear in logs |
| Phase 2 review follow-ups | Listed in `phase-2.md` outcome once the review is closed |

---

## Scope

### In
- Encrypted, private object storage service (S3-compatible; MinIO in development): upload, stream through the API, delete; no public or presigned-public URLs
- Check-in link per booking: create, list, resend, revoke; 256-bit token, only its hash stored; single use per guest, expiring
- Public guest flow (no login): document photo → extraction → review/correction → the four mandatory fields, party size, dual-nationality question, explicit consent → submit
- OCR/MRZ worker (self-hosted): passport MRZ (ICAO 9303) with check-digit validation; CIN by structured OCR or manual entry; confidence scores; assistive only
- Fiche de Police PDF per guest, generated on submission (HTML → PDF with Playwright)
- Manager/Staff screens: arrivals with check-in status, send link (prefilled `wa.me` message), view Fiche; Owner/Manager only: view the ID image
- Retention job: delete raw images and extraction artefacts after the window; keep structured records
- Audit of every read of an ID image, every link creation and revocation
- Consent record: timestamp, wording version, per submission
- Feature flag `GUEST_CHECKIN_ENABLED` (env; must be explicitly true in production)
- FR and EN guest form (Arabic and right-to-left come after the pilot, as decided in the solo plan)

### Out (later phases)
- Marriage-certificate flow: **not built** until counsel has reviewed it (the schema table exists and stays unused)
- Monthly Police Register and Secure Share links → Phase 4
- WhatsApp Business API delivery → Phase 6 (a prefilled `wa.me` link for now)
- Multi-language guest form in Arabic → after the pilot
- Upsell store in the check-in page → fast-follow

---

## Decisions to lock before coding

| Topic | Recommendation | Reason |
|---|---|---|
| Storage encryption | Private bucket with server-side encryption (SSE), plus **application-level envelope encryption** with a per-object data key wrapped by a master key from the secret store | A misconfigured bucket or a leaked backup still yields ciphertext; key rotation is possible |
| Serving images | Only through the API (`GET /guests/:id/document`), Owner/Manager, `Cache-Control: no-store`, audited; never a presigned URL | Rule 3 in `CLAUDE.md`; every read is logged |
| OCR engine | Self-hosted worker in the same private network; passports via an MRZ library plus Tesseract on the MRZ strip; CIN: decide after testing real cards | No foreign processor; MRZ has check digits, so reads are verifiable |
| OCR trust | Extracted fields are suggestions; the guest edits them; check-digit failures are flagged; the server never treats OCR output as verified | Rule 5 in `CLAUDE.md` |
| Guests per booking | One check-in per adult guest of the party; the link lets the same person add the next guest | The police form is individual; to confirm with the prefecture |
| Link lifetime | Valid from creation until 48 h after the booked checkout; single use per guest; revocable | Limits exposure of a forwarded link |
| Image handling | Client resizes to ≤ 2000 px JPEG before upload; server validates magic bytes, dimensions and size (≤ 8 MB), strips EXIF, re-encodes | Smaller uploads, no GPS/EXIF data stored, no polyglot files |
| Upload abuse | Per-token and per-IP rate limits; max attempts per link; max 3 images per guest | Public endpoint on a link |
| Worker access | The API calls the worker over the private network with a shared secret; the worker keeps nothing on disk and logs no content | Least privilege |
| PDF | Playwright HTML → PDF, Arabic-safe fonts embedded; wording "formatted like the official form", never "compliant" or "certified" | Rule 2 in `CLAUDE.md`; layout follows the official form once obtained |
| Staff access to the Fiche | Staff see status only until counsel confirms; Owner/Manager can download | The spec lets Staff view; the safer default is status only |
| Consent text | Stored as versioned records; the version id is saved with each submission; text approved by counsel | Proof of what the guest agreed to |
| Logging | A logging redaction layer plus a test that submits fake PII and greps the logs | Prevent accidental PII in logs |

---

## Data model changes

| Model | Change |
|---|---|
| `GuestCheckIn` | Add `accountId` (tenant scope), `propertyId`, `status` (PENDING / SUBMITTED / VERIFIED), `docImageKey` (object key), `docImageSha256`, `tokenExpiresAt`, `usedAt`, `docExpiryDate`, `ocrFieldsFlagged` (JSON: which fields were edited), `guestIndex`; remove nothing. Existing columns stay |
| `CheckInLink` (new) | `id`, `accountId`, `bookingId`, `tokenHash` (unique), `expiresAt`, `revokedAt`, `createdBy`, `guestsSubmitted`, `maxGuests`, `createdAt` |
| `ConsentText` (new) | `id`, `version` (unique), `locale`, `body`, `approvedBy`, `approvedAt` |
| `FicheDePolice` | Add `accountId`, `pdfKey` (replaces `pdfUrl`), `templateVersion`, `sha256` |
| `StoredObject` (new) | `id`, `accountId`, `key`, `kind` (ID_IMAGE / FICHE_PDF), `sizeBytes`, `sha256`, `wrappedKey`, `createdAt`, `expiresAt`, `deletedAt` — the retention job works from this table |
| `RuleConfig` | `retention.id_images_days` (default 30), `checkin.link_grace_hours` (48) |
| `AuditAction` | `guest.document.read`, `checkin.link.created`, `checkin.link.revoked`, `checkin.submitted`, `retention.purged` |

`MaritalDocument` is left unused.

---

## API surface

| Route | Method | Access | Notes |
|---|---|---|---|
| `/bookings/:id/checkin-links` | POST / GET | `checkin:manage` (Owner/Manager, Staff) | Create and list links for a booking; returns the link once |
| `/checkin-links/:id` | DELETE | `checkin:manage` | Revoke |
| `/checkin-links/:id/resend` | POST | `checkin:manage` | Issues a fresh token, revokes the old one |
| `/checkin/:token` | GET | public | Booking dates and property name only, consent texts, form config; `no-store`, `noindex` |
| `/checkin/:token/document` | POST | public | Image upload → sanitised, stored, OCR run → extracted fields for review (never the stored image) |
| `/checkin/:token/submit` | POST | public | Final fields; server enforces entry stamp number, city of origin, next destination, profession; records consent |
| `/properties/:id/arrivals` | GET | `booking:read` | Bookings with check-in status per guest (Staff: status only) |
| `/guests/:id` | GET | `guest:read_meta` (Staff: status; Owner/Manager: fields) | |
| `/guests/:id/document` | GET | `id:read` (Owner/Manager) | Streams the image; audited; `no-store` |
| `/guests/:id/fiche` | GET | `police:read` | Streams the PDF |
| `/guests/:id/fiche/regenerate` | POST | `police:read` | After a correction |

New capabilities: `checkin:manage`, `guest:read_meta`, `id:read`, `police:read`. Every route goes into the permission matrix; every `:id` route into the tenant-isolation suite; the public routes get their own abuse tests.

---

## Screens

| # | Screen | Notes |
|---|---|---|
| 8 | Guest check-in form (public) | Mobile-first, no navigation, FR/EN. Steps: (1) property and dates for confidence, (2) camera/upload with framing guidance, (3) review of read fields, editable, (4) the four mandatory fields, party size, dual-nationality question, (5) consent text directly above the submit button, (6) done. Uses the design system's Field, Button, Alert |
| 9 | Fiche de Police list / preview / download | Manager: table with status pills, view PDF, view ID image, resend link. Staff: status only |
| – | Arrivals | Upcoming bookings with per-guest status; "send link" opens a prefilled WhatsApp message |
| – | Link created dialog | Shows the link once with copy and WhatsApp buttons |

---

## Work breakdown

| Step | Work | Model |
|---|---|---|
| 3.0 | Carry-overs: mail driver, `__Host-` cookies, composite FKs, log-redaction layer and test | fast |
| 3.1 | **Storage service**: S3 client, envelope encryption, private access, streaming, `StoredObject`, audit hooks; MinIO in dev and CI | strong |
| 3.2 | Data model, migration, capabilities, consent texts, feature flag, retention settings | fast |
| 3.3 | **OCR worker**: MRZ parsing with check digits, image pre-checks, CIN approach after the card test, confidence scores; synthetic ICAO specimen fixtures only | strong |
| 3.4 | Check-in links API (create, list, resend, revoke) and the public API (view, upload with sanitising, submit with server-side rules and consent) | strong |
| 3.5 | Fiche de Police PDF generator (template version, checksum, stored encrypted) | fast |
| 3.6 | Retention job (Redis queue): purge images and artefacts after the window, keep structured records, audit | strong |
| 3.7 | Web: arrivals, link dialog, guest list, Fiche and ID viewers | fast |
| 3.8 | Web: guest form (mobile-first, camera guidance, review screen, consent) | fast |
| 3.9 | Hardening: abuse tests, log-redaction test, security review, E2E on a phone with a synthetic passport, docs, Phase 4 plan | strong |

Rough effort solo: 4–6 weeks full-time. Steps 3.1, 3.3, 3.4 and 3.6 carry the risk.

---

## Tests required

- **Storage:** stored bytes are not the plaintext; wrong key fails; deletion removes the object and marks the row; no code path returns a public or presigned URL.
- **OCR:** valid MRZ (TD3) parsed; each check digit failure flagged; garbage, blurred, rotated and oversized images handled without crashing; the worker keeps nothing on disk and logs no content; only synthetic specimen data in the repo.
- **Public flow:** token is single-use per guest; expired, revoked and unknown tokens answer the same neutral page; a missing mandatory field is refused server-side; consent version and timestamp are stored; the response never contains the stored image or other guests' data; rate limits and attempt caps hold.
- **Uploads:** wrong magic bytes, polyglots, decompression bombs, > 8 MB and EXIF/GPS metadata are refused or stripped.
- **Access:** ID image readable only by Owner/Manager, audited on every read, `no-store`; Staff and Accountant refused; another account gets 404; matrix rows for every route.
- **Retention:** images deleted after the window (time-shifted test), structured records kept, purge audited, idempotent.
- **Logging:** a test submits fake PII through every route and asserts none appears in logs or audit rows.
- **E2E (phone viewport):** manager creates a link → guest completes the form with a synthetic passport → manager sees status and downloads the Fiche → manager views the image (audited) → Staff sees status only.

---

## Security checklist for this phase

- [ ] Bucket private, encrypted, no public policy; envelope encryption tested; master key from the secret store, never in the repo
- [ ] No route returns an image URL; images only through audited, `no-store` API routes
- [ ] Public routes: tokens hashed, neutral errors, rate limits, `no-store`, `noindex`, no third-party scripts, `Referrer-Policy: no-referrer`
- [ ] Uploads validated by content, re-encoded, EXIF stripped, size-capped; the worker never writes content to disk
- [ ] OCR worker reachable only on the private network with a shared secret
- [ ] Logs and audit rows carry ids only; redaction test in CI
- [ ] `GUEST_CHECKIN_ENABLED` false by default in production until the gates above are closed
- [ ] Retention job monitored; a failed purge raises an alert
- [ ] Backups: images excluded from long-term backups or encrypted with the same envelope keys, and deleted within the retention window

---

## Definition of done

1. On a phone, a guest with a synthetic passport completes the form in under two minutes and the manager receives a Fiche de Police PDF.
2. ID images are stored encrypted, readable only by Owner/Manager through an audited route, and deleted automatically after the window.
3. No personal data appears in logs; the redaction test passes.
4. The abuse, access, retention and isolation suites pass in CI.
5. Security review has no open high-severity finding.
6. `docs/phase-4.md` written; the hard gates above are tracked with an owner and a date.

## Risks

| Risk | Mitigation |
|---|---|
| A personal-data leak (storage, logs, backups, a forwarded link) | Envelope encryption, audited reads, log redaction test, short link lifetime, retention job, runbook |
| CIN cards have no readable MRZ | Test real cards first; structured OCR with a manual-entry fallback that is always available |
| OCR errors reach the police form | The guest reviews every field; check digits flagged; the manager can correct and regenerate |
| The official form differs from the assumed one | Obtain it first; template versioned; wording never claims compliance |
| CNDP delay blocks the pilot | Start now; ship behind the flag; pilot with synthetic data and managers' own test guests |
| Guests refuse or abandon the form | Short mobile flow, clear consent text, manual entry fallback, resend link |
| Cost of OCR compute on a small server | Lightweight MRZ path first; queue and limit concurrency |

## Open decisions (need your answer)

1. Hosting region and object-storage provider (Morocco or EU), confirmed with counsel.
2. The official police form: who provides it, and does the prefecture accept a PDF or require paper?
3. One form per adult guest, or one per party? What does the prefecture expect for children?
4. Staff access to the Fiche PDF: status only (recommended) or download?
5. Consent and privacy wording: counsel to provide FR/EN text; the retention period for the Fiche itself.
6. Real CIN / CNIE samples (with owners' permission, not stored in the repo) to choose the OCR approach.
7. Mail provider (still open from Phase 1).
