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
| Production mail driver (Resend or Brevo) and hosting region | Guest and alert emails; storage location. **Drivers built (3.0)**; the provider and the hosting region are still your decision |
| `__Host-` session cookies once the domain is fixed | Security review follow-up; more sensitive data now. **Done (3.0)** for secure deployments; see `docs/deployment.md` |
| Composite (ownerId, accountId) foreign key, and the same pattern for new tenant tables (`GuestCheckIn.accountId`) | Database-level guard behind the account scope. **Done (3.0)** for Property → owner and Booking / IcalFeed / ImportBatch → property; new tables in 3.2 must follow the pattern |
| Redact personal data from logs by construction (a logging test) | Guests' names and document numbers must never appear in logs. **Layer and test done (3.0)**; step 3.9 extends the test to every new route |
| Confirm the 90 / 110 / 120 night thresholds with counsel; compare the counter with real Airbnb / Booking.com exports | Before the pilot; the counter is what customers pay for |
| Wire the 4 Phase 2 accepted limits into the pilot checklist (see `phase-2.md` outcome) | Nothing new to build; track them |

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
| `GuestCheckIn` | Reworked (nothing wrote to it yet). Added `accountId`, `propertyId`, `linkId`, `guestIndex`, `status` (PENDING draft / SUBMITTED / VERIFIED), `docImageId` (a `StoredObject` id), `docExpiryDate`, `ocrFieldsFlagged`, `consentTextId`, `createdAt`. Removed `tokenHash`, `docFileUrl`, `expiresAt`, `consentVersion` (the token lives on `CheckInLink`; images and their purge date live on `StoredObject`; the consent row id says which wording). One composite key `(bookingId, propertyId, accountId)` ties guest, booking and property together; `(bookingId, guestIndex)` is unique |
| `CheckInLink` (new) | `id`, `accountId`, `bookingId`, `tokenHash` (unique), `expiresAt`, `revokedAt`, `createdBy`, `guestsSubmitted`, `maxGuests`, `createdAt`. Composite key to the booking |
| `ConsentText` (new) | `id`, `version`, `locale`, `body`, `approvedBy`, `approvedAt`; unique per **(version, locale)** (FR and EN are separate rows of one version). Only approved rows are served |
| `FicheDePolice` | Added `accountId`, `pdfObjectId` (a `StoredObject` id, replaces `pdfUrl`), `templateVersion`, `sha256` |
| `StoredObject` (new, built in 3.1) | `id`, `accountId`, `key`, `kind` (ID_IMAGE / FICHE_PDF), `sizeBytes`, `sha256`, `wrappedKey`, `createdAt`, `expiresAt`, `deletedAt` |
| `RuleConfig` | Rows `retention.id_images_days` (`{"days": 30}`) and `checkin.link_grace_hours` (`{"hours": 48}`), unvalidated, read by `RulesService` with bounds checks and plan defaults as fallback |
| `AuditAction` | `guest.document.read`, `guest.fiche.read`, `storage.object.deleted` (3.1), `checkin.link.created`, `checkin.link.revoked`, `checkin.submitted`, `retention.purged` |

**Changes from the first draft of this table, and why:** `docImageKey` + `docImageSha256` became `docImageId` (the storage service works on `StoredObject` rows, which already hold the key and hash); `tokenExpiresAt` / `usedAt` were dropped from the guest (the link carries the expiry and `submittedAt` says it was used); `ConsentText.version` alone was not unique across languages, so the key is `(version, locale)`; every new tenant table has composite `(x, accountId)` keys, as `CLAUDE.md` requires.

**Feature flag.** `GUEST_CHECKIN_ENABLED`: true in development and test, **false by default in production**. `CheckInEnabledGuard` makes every guest route answer 404 when it is off. Production needs the storage settings (s3, master keys, SSE) only when the flag is on.

**Consent wording.** Counsel's FR/EN text is inserted with SQL (or a migration) with `approvedBy` and `approvedAt` set, e.g. `INSERT INTO "ConsentText" (id, version, locale, body, "approvedBy", "approvedAt") VALUES (gen_random_uuid(), 'v1', 'fr', '…', 'Me X', now());`. With no approved row the guest flow refuses to start. The dev seed inserts clearly marked development text; never use it with real guests.

`MaritalDocument` is left unused.

---

## API surface

| Route | Method | Access | Notes |
|---|---|---|---|
| `/bookings/:id/checkin-links` | POST / GET | `checkin:manage` (Owner/Manager, Staff) | Create (returns the token and URL **once**) and list links for a booking. Only for confirmed bookings of type BOOKING whose window is still open |
| `/checkin-links/:id` | DELETE | `checkin:manage` | Revoke (idempotent) |
| `/checkin-links/:id/resend` | POST | `checkin:manage` | Issues a fresh token and revokes the old one |
| `/checkin` | GET | public, token in the `X-Checkin-Token` header | Property name, stay dates, consent text (`?lang=fr\|en`), limits, required fields. Nothing about other guests |
| `/checkin/document` | POST | public | Photo upload (≤ 8 MB) → sanitised, encrypted, stored, OCR run → **suggestions** and a `draftId` (never the stored image). Max 3 photos per guest |
| `/checkin/submit` | POST | public | Final fields, consent; server enforces the four mandatory fields |
| `/properties/:id/arrivals` | GET | `booking:read` | Current and upcoming stays with check-in status per guest (`?days=`, default 60). Staff: status only, no names |
| `/guests/:id` | GET | `guest:read_meta` | Staff: status only. Owner/Manager: the fields, consent and OCR flags |
| `/guests/:id` | PATCH | `guest:write` (Owner/Manager) | Correct fields, mark VERIFIED; audited without values |
| `/guests/:id/document` | GET | `id:read` (Owner/Manager) | Decrypts and streams the image; audited **before** any byte is returned; `no-store` |
| `/guests/:id/fiche`, `/guests/:id/fiche/regenerate` | GET / POST | `police:read` | Step 3.5 |

**Changes from the first draft of this table, and why**

- **The token is in the URL fragment and the `X-Checkin-Token` header, not in a `/checkin/:token` path.** A path token lands in edge access logs and, more importantly, in the request that WhatsApp (Meta's servers) makes to build a link preview as soon as a manager pastes the link into a chat. A fragment (`/checkin#token=…`) is never sent to any server; the guest page reads it, removes it from the address bar and sends it in a header.
- **A guest is a draft first.** The first photo creates a `PENDING` `GuestCheckIn` (that is what `draftId` names); submit turns it `SUBMITTED` and gives it its guest number, atomically with the link's counter. An unfinished draft is invisible to the team and its photo is purged with the others.
- **`PATCH /guests/:id` and the `guest:write` capability** were added: the risk table promises that the manager can correct a field and regenerate the Fiche.
- **Party size** is asked in the form only to guide the "add the next guest" loop; the server's limit is the link's `maxGuests` (the booking's party size, or 2, set when the link is created).
- **Entry stamp for Moroccan nationals.** The four mandatory fields are enforced for every guest, as `CLAUDE.md` rule 5 says. Whether a Moroccan national or CIN holder should be exempt from the entry stamp is a question for counsel and the prefecture; if they are, that becomes a `RuleConfig` decision, not code.

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
| 3.0 | Carry-overs: mail driver, `__Host-` cookies, composite FKs, log-redaction layer and test — **done** | fast |
| 3.1 | **Storage service**: S3 client, envelope encryption, private access, streaming, `StoredObject`, audit hooks; MinIO in dev and CI — **done** (objects are buffered in memory, capped at 16 MB, which is enough for images ≤ 8 MB and PDFs; GCM needs the whole object to authenticate) | strong |
| 3.2 | Data model, migration, capabilities, consent texts, feature flag, retention settings — **done** (see the changes from the table above, below it) | fast |
| 3.3 | **OCR worker**: MRZ parsing with check digits, image pre-checks, CIN approach after the card test, confidence scores; synthetic ICAO specimen fixtures only | strong |
| 3.4 | Check-in links API (create, list, resend, revoke) and the public API (view, upload with sanitising, submit with server-side rules and consent) — **done** (see the API changes below) | strong |
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
