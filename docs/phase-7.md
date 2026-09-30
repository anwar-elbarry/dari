# Phase 7 — Hardening and pilot

Part of the [roadmap](../README.md). Built solo with Claude: each numbered step below is one short session, except the ones that are yours (counsel, the pilot customers), which have waiting periods no code shortens. Conventions: [`phase-1.md`](phase-1.md); the trackers of the legal gates are at the end of [`phase-3.md`](phase-3.md), [`phase-4.md`](phase-4.md), [`phase-5.md`](phase-5.md) and [`phase-6.md`](phase-6.md); the manual checks are in [`pilot-checklist.md`](pilot-checklist.md).

**Goal:** the product is safe enough for 5 to 10 real Marrakech conciergeries: no open high-severity finding, the legal sign-offs recorded, every feature flag decided on purpose, and a written way to recover from a bad day (a leak, a lost key, a lost database).

**Why it matters:** Phases 3 to 6 built the features behind flags, on synthetic data. This is the phase where real guest data, real tax figures and real phone numbers first enter the system, and where a mistake stops being a bug and becomes an incident with the CNDP. Nothing here adds a feature.

**Solo note (README):** run a small pilot (3 to 5 customers, no real ID data until the CNDP filing is accepted) as soon as the counter and the check-in are ready, then do the full hardening below before widening the launch. The order below is the order of risk, not of calendar.

---

## Carried over from Phase 6

| Item | Why it lands here |
|---|---|
| Hard gates of Phase 6: Meta verification, approved templates, CNDP position on Meta, the Marrakech checklist and its validation, licence-document retention | Not code. Tracker in [`phase-6.md`](phase-6.md); `WHATSAPP_ENABLED` and a validated checklist wait on them |
| Seat limits: Starter 1, Growth 3, Conciergerie 6 are the founder's pricing (unvalidated by design); Enterprise has no figure; a new account starts on the column default (1) | Decide the Enterprise figure and who changes a limit before billing exists (Phase 8); until then it is an operator task |
| Owners cannot be promoted, demoted or removed from the team screen | A second Owner/Manager (and the "last owner" rule that goes with it) is a founder decision |
| A WhatsApp message that Meta accepts and later fails to deliver is shown as failed but does not trigger an e-mail | Deliberate (nothing personal is kept to do it); revisit if pilot managers miss messages |
| The daily WhatsApp cap is soft (two racing requests can each pass by one) | Acceptable at pilot scale; harden with a counter if the bill matters |
| Licence documents: retention counted from the upload date | Counsel may prefer another anchor |
| Guest phone numbers are typed for one message and kept nowhere | Confirm with counsel that this is enough for the CNDP file, or that a stored number is wanted |
| The Phase 3 passport reading test needs Tesseract; the e2e suite was run without it here | CI has it; run the whole suite there before the pilot |

---

## Scope

### In
- **Security review**, in two passes: the built-in `/security-review` on the whole diff since Phase 3, then an independent read-only pass on the areas that carry personal data (storage and keys, tokens, RBAC and tenancy, logging, the public routes, the WhatsApp webhook). Every finding is fixed with a regression test or written down as accepted, with a reason
- **Pen-test checklist** on the public token routes (`/api/checkin/*`, `/api/share`, `/api/webhooks/whatsapp`, the invitation and reset routes): enumeration, replay, timing, size and rate limits, method and content-type confusion, cache and referrer behaviour; run by hand against a staging deployment
- **Abuse and load limits:** rate limits per route reviewed against the real edge (client IP), the throttler and lockout on Redis, upload limits, Chromium concurrency for PDFs
- **Backups and recovery:** daily database backups, one restore tested on a scratch instance, storage master keys backed up apart from the data, a rehearsed key rotation, and the incident runbook for a personal-data leak (who decides, who tells the CNDP, what is revoked first)
- **Devices:** the guest form and the viewer on low-end Android and on iPhone Safari (the "real phone" section of the pilot checklist); Arabic and RTL only if the pilot asks for them (solo plan: after the pilot)
- **Legal sign-off recorded**: counsel on retention, consent wording, Secure Share, the marital flow (still off), the WhatsApp channel and the checklist wording; the fiduciaire on the tax rules (or the decision to keep the BETA watermark)
- **Pilot:** 5 to 10 customers onboarded by hand, manual invoicing, a weekly call, and a log of every correction guests make to OCR output, every review-list item, every difference between the estimate and the accountant's figures
- **Enablement decisions**, one flag at a time, with `npm run check:enablement` green and the manual lines ticked: `GUEST_CHECKIN_ENABLED`, `POLICE_REGISTER_ENABLED`, `SECURE_SHARE_ENABLED`, `TAX_REPORTS_ENABLED`, `WHATSAPP_ENABLED`

### Out (Phase 8 and later)
- Billing (CMI / Payzone), the notifications centre, the Upsell store, the vendor ledger, KPIs
- Arabic UI, CIN structured OCR beyond what real cards allow
- Automatic submission to the authorities, two-way WhatsApp, marketing messages
- The marital-certificate flow, until counsel has reviewed it

---

## Decisions to lock before starting

| Topic | Recommendation | Reason |
|---|---|---|
| Order of enablement in production | Counter and alerts first (no ID data), then check-in and Fiche, then register and Secure Share, then WhatsApp, then tax | Each step adds a class of data or a third party; open them one at a time so a problem has one suspect |
| Who has production access | Two people, both named in the runbook; no shared account | An audit trail that says "the operator" is not an audit trail |
| Staging | A copy of production settings with synthetic data, used for the pen-test and for every restore drill | The tests must hit the real edge, not `localhost` |
| Pilot data rule | No real ID data until the CNDP filing is accepted; before that the pilot uses the counter, the calendars and the tax estimate only | README solo plan |
| Definition of a finding's severity | High: cross-tenant access, personal data or a token exposed, an authentication bypass. Medium: needs a precondition or leaks metadata. Low: hardening | Same scale as the Phase 1 to 5 reviews |
| What stops a release | Any open high finding, any red CI, any `FAIL` in the enablement check for a flag being turned on | The gate in the roadmap |

---

## Work breakdown

| Step | Work | Model |
|---|---|---|
| 7.0 ✅ | Gate tracker for this phase, the consolidated list of open decisions, staging environment | fast |
| 7.1 ✅ | `/security-review` on the diff since Phase 3; fix or accept each finding with a test | strong |
| 7.2 ✅ | Independent read-only pass on storage, tokens, RBAC and tenancy, logging, public routes, webhook; fix or accept | strong |
| 7.3 🟡 | Pen-test checklist on the public routes, run against staging; findings fixed with regression tests | strong |
| 7.4 🟡 | Limits and abuse: rate limits against the real edge, upload and PDF concurrency, Redis failure behaviour | fast |
| 7.5 🟡 | Backups, restore drill, key rotation drill, incident runbook | fast |
| 7.6 | Real-device pass (pilot checklist section 2) and the fixes it finds | fast |
| 7.7 | Legal sign-offs recorded in `RuleConfig` (`validatedBy`) and in the trackers | founder + counsel |
| 7.8 | Pilot onboarding, weekly review, decisions on each flag; Phase 8 plan from what the pilot shows | founder |

Steps 7.1 to 7.3 carry the risk.

---

## Tests required

- **Regression tests for every finding**, in the suite of the area concerned (`share-abuse`, `whatsapp-webhook`, `permission-matrix`, `tenant-isolation`, `checkin-logging`).
- **Restore drill:** a database restored on a scratch instance boots, migrates to no-op, and a stored ID image, a Fiche and a licence document still decrypt with the backed-up keys.
- **Key rotation:** `rewrapOutdatedKeys()` after adding a master key leaves every object readable and none wrapped by the old key.
- **Edge:** a forged `X-Forwarded-For` does not change the IP in the audit log; the webhook receives the exact body bytes through the proxy (the signature depends on it).

---

## Security checklist for this phase

- [ ] No open high-severity finding; every medium fixed or accepted in writing
- [ ] Every public route in the pen-test list has a neutral failure and no oracle (timing, status, headers)
- [ ] Production secrets only in the secret store; none in the repository, the CI logs or the images
- [ ] Redis required and healthy in production (rate limits, lockout, view counters)
- [ ] Backups encrypted, restore tested, keys stored apart, two people know where
- [ ] The incident runbook has been read aloud once
- [ ] Every flag has an owner and a written reason for its state

---

## Definition of done

1. No open high-severity finding; the pen-test list and the pilot checklist are ticked on the real deployment.
2. Legal sign-off is recorded for retention, consent wording, Secure Share, the WhatsApp channel and the checklist wording, or the feature stays off with the reason written down.
3. A restore and a key rotation have been rehearsed.
4. 5 to 10 pilot customers are live, on the flags decided above.
5. `docs/phase-8.md` is written from what the pilot showed.

## Risks

| Risk | Mitigation |
|---|---|
| Counsel and Meta take longer than the code did | The product is useful without them: counter, alerts, tax estimate (BETA), the manual WhatsApp button; flags stay off until each gate closes |
| A finding late in the review forces a redesign | Reviews are split by area and start now, not at the end |
| The pilot is run on real data before the CNDP filing is accepted | The pilot data rule above, enforced by leaving the guest flag off |
| One person is the developer, the operator and the incident responder | The runbook, two people with access, restore drills; cut scope before quality |
| Pilot customers use the tax estimate as if it were advice | The BETA watermark, the disclaimer wording from `RuleConfig`, the call to the accountant |

## Open decisions (need your answer)

1. Staging: where, and who pays for it?
2. Who is the second person with production access?
3. Which flags go on for the first pilot customers, and in what order?
4. The Enterprise seat figure, and who changes a customer's seat limit before billing exists?
5. A second Owner/Manager per account: yes, and with what rule for the last one?
6. Are WhatsApp delivery failures worth an e-mail to the manager (which needs the recipient's e-mail kept for the send)?

---

## 7.0 — Gate tracker, open decisions, staging

One list for every gate that is not code, taken from the trackers of Phases 3 to 6 (which stay the detailed record, with their wording). Nothing is **Closed**: none of those trackers records evidence of a closed gate, so this list does not either. A gate is Closed only when its evidence (document, date, who) is written in the last column, in the same commit as any flag or rule it unlocks. A verbal yes is *In progress*. **Dates are proposals carried from Phases 3 to 6 or set 2026-09-30: confirm or change them**; for a third party (CNDP, prefecture, Meta) the date is when *we* act, not when they answer.

### What each group unlocks

| Group | Unlocks | Until then |
|---|---|---|
| **G** (guest data) | `GUEST_CHECKIN_ENABLED=true` in production, then `POLICE_REGISTER_ENABLED` and `SECURE_SHARE_ENABLED` (plus **R**) | Synthetic data only; the pilot uses the counter, the calendars and the tax estimate |
| **R** (register and sharing) | `POLICE_REGISTER_ENABLED`, `SECURE_SHARE_ENABLED` | Flags off |
| **T** (tax) | Removing the BETA watermark and letting a customer rely on a report | Reports are labelled BETA, rules `validatedBy` empty |
| **M** (messaging, checklist) | `WHATSAPP_ENABLED`; presenting the checklist as more than a working list | Manual `wa.me` button; checklist labelled "not validated" |
| **P** (pilot and operations) | The first pilot customer; widening after the pilot | No customer |

### G: before any real guest data

| # | Gate | Owner | Proposed date | Status | Evidence |
|---|---|---|---|---|---|
| G1 | Hosting region and object-storage provider (Morocco or EU), cross-border position | Founder + counsel | 2026-10-10 | Open | |
| G2 | CNDP declaration filed (and the authorization it may require); acceptance date recorded. Describes Secure Share (recipients: authorities) and Meta as a recipient of numbers and links | Founder + counsel | file by 2026-10-15; acceptance date unknown | Open | |
| G3 | Consent wording FR/EN approved and inserted (`ConsentText` with `approvedBy`, `approvedAt`); the guest form refuses to start without it | Counsel | 2026-10-20 | Open | |
| G4 | Retention confirmed and validated in `RuleConfig`: `retention.id_images_days` (30 default), `retention.fiche_days`, `retention.police_register_days`, and of the structured guest record (kept today after the image is purged). Until `retention.fiche_days` is validated every Fiche PDF is kept and the enablement check fails on it | Counsel | 2026-10-20 | Open | |
| G5 | Official police form (fields, layout; PDF or paper) from the prefecture / DGSN; whether a Moroccan national needs an entry stamp | Founder + prefecture | 2026-10-13 | Open | |
| G6 | Real CIN / CNIE cards tested for an MRZ, with their owners' permission (never committed); decides the OCR approach | Founder | 2026-10-20 | Open | |
| G7 | Mail: Resend chosen; sender domain verified (SPF, DKIM); a US processor covered by G1 | Founder + counsel | 2026-10-10 | In progress (provider chosen, domain open) | |
| G8 | Incident runbook for a personal-data leak written and read by everyone with production access (who decides, who tells the CNDP, what is revoked first) | Founder | 2026-10-31 | Open | |
| G9 | Staff access to the Fiche PDF: status only (today) or download | Founder + counsel | with G3 | Open | |
| G10 | Enablement run: `npm run check:enablement -w apps/api` on the production environment with no `FAIL`, then sections 1 and 2 of [`pilot-checklist.md`](pilot-checklist.md) ticked on the real deployment | Founder | after G1 to G9 and S1 to S4 | Open | |

### R: register and Secure Share (on top of G)

| # | Gate | Owner | Proposed date | Status | Evidence |
|---|---|---|---|---|---|
| R1 | Official register form and whether the prefecture accepts a PDF | Founder | 2026-10-13 (with G5) | Open | |
| R2 | An authority's access: attributable (store the IP) or minimised (time and browser only, today) | Counsel | 2026-10-20 | Open | |
| R3 | Share lifetime bounds (24 h minimum, 72 h maximum today, unvalidated) | Founder + counsel | 2026-10-20 | Open | |
| R4 | Who may create a share link (Owner/Manager only today) | Founder + counsel | with G3 | Open | |
| R5 | Real-phone check of the viewer, pilot checklist section 2 | Founder | before the pilot | Open | |

### T: tax estimate (BETA)

| # | Gate | Owner | Proposed date | Status | Evidence |
|---|---|---|---|---|---|
| T1 | Fiduciaire confirms or replaces each default: income-tax rates and threshold, year-to-date rule, VAT rate and basis, rounding, which stays belong to a month, Taxe de séjour and platform commission | Founder + fiduciaire | 2026-10-20 | Open | |
| T2 | Three worked examples per regime, to become golden-file tests | Fiduciaire | 2026-10-20 | Open | |
| T3 | Income-tax rule for the professional and company regimes; local-tax `TaxRule` rows | Fiduciaire | 2026-10-20 | Open | |
| T4 | Beta and standard disclaimer wording approved (FR, EN) | Counsel or fiduciaire | 2026-10-20 | Open | |
| T5 | Decision on whether reports may back a real customer's declaration once T1 to T4 are closed | Founder | after T1 to T4 | Open | |
| T6 | Night thresholds 90 / 110 / 120 confirmed (placeholders in `RuleConfig`); counter compared with one real Airbnb and one real Booking.com export per property | Counsel + founder | 2026-10-20 | Open | |

### M: messaging and checklist

| # | Gate | Owner | Proposed date | Status | Evidence |
|---|---|---|---|---|---|
| M1 | Meta WhatsApp Business verification started (business account, number, display name) | Founder | 2026-10-07 | Open | |
| M2 | WhatsApp templates written and approved (check-in link, day-counter alert, share link; FR first); names in `whatsapp.templates` | Founder | 2026-10-31 | Open | |
| M3 | Marrakech checklist content (steps per licence type, FR and EN, conditions), loaded with `validatedBy` and `validatedAt`; the founder's references (Décret 2-23-441, Loi 80-14) checked by counsel | Counsel or local advisor | 2026-10-31 | Open | |
| M4 | Retention of licence documents (`retention.license_documents_days`) | Counsel | 2026-10-31 | Open | |
| M5 | Marital flow (Art. 490): lawyer review and CNDP check; stays off until then | Counsel | not scheduled | Open | |

### P: pilot and operations (new in this phase)

| # | Gate | Owner | Proposed date | Status | Evidence |
|---|---|---|---|---|---|
| P1 | Terms of use, privacy policy | Founder + counsel | 2026-11-15 | Open | |
| P2 | Professional liability insurance (RC Pro): check that a SaaS giving compliance and tax estimates is covered, and the exclusions for personal-data incidents | Founder + insurer | 2026-11-15 | Open | |
| P3 | Production domain fixed (needed for `__Host-` cookies, the G7 sender domain, link URLs) | Founder | 2026-10-10 | Open | |
| P4 | A second person with production access, named in the runbook; no shared account | Founder | with G8 | Open | |
| P5 | Flags and their order for the first pilot customers (recommended: counter and alerts, then check-in and Fiche, then register and Secure Share, then WhatsApp, then tax) | Founder | before the first customer | Open | |

### S: staging (step 7.0 deliverable)

Staging is a copy of the production settings with synthetic data. It is where the pen-test (7.3), the restore drill and the key-rotation drill (7.5) run, because they must hit the real edge, not `localhost`. It is **not built**: it needs a host, a domain and a budget, which are decisions, not code.

| # | Item | Owner | Proposed date | Status | Evidence |
|---|---|---|---|---|---|
| S1 | Where it runs and who pays (same region as production, G1) | Founder | 2026-10-10 | Open | |
| S2 | Reachable through the same edge as production (overwrites `X-Forwarded-For`; passes the webhook body through unchanged), Redis required, private bucket, synthetic data, `npm run check:enablement` run against it | Founder, then Claude for the script run | after S1 | Open | |
| S3 | Mail and WhatsApp in test mode only (no real recipient) | Founder | after S1 | Open | |
| S4 | Backups of staging and of its `STORAGE_MASTER_KEYS`, stored apart from the data | Founder | after S1 | Open | |

### Accepted limits to re-read at each gate review

Each stops being acceptable under the condition in the right-hand column.

| Limit | Source | Stops being acceptable when |
|---|---|---|
| The manager's "Send by WhatsApp" button sends the token to `wa.me` | `phase-3.md` | Counsel objects, or once M1 to M2 close and the Business API replaces it |
| Signup and invitations reveal that an email is registered (409) | `phase-1.md` | Public signup opens beyond the pilot |
| Access token valid up to 15 minutes after logout | `phase-1.md` | A customer needs instant revocation |
| CSP allows inline scripts (Next.js) | `phase-1.md` | Nonces are planned, see 7.1 |
| Malformed calendar dates are shifted, not rejected | `phase-2.md` | A wrong count is traced to it |
| Sync every 2 hours (`ICAL_SYNC_INTERVAL_HOURS`) | `phase-2.md` | A customer needs faster alerts |
| OCR accuracy on real photos unmeasured; CIN / CNIE by hand | `phase-3.md` | First 20 real check-ins (log the share of corrected fields) |
| Whether WhatsApp delivery failures justify an e-mail; soft daily WhatsApp cap; owners cannot be re-roled from the team screen | `phase-6.md` | Pilot managers miss messages, or the bill matters |
| Enterprise seat figure undecided; who changes a seat limit before billing | `phase-6.md` | The first Enterprise customer, or billing (Phase 8) |

### Decisions to take, all in one place

These are the open decisions of this plan and of the Phase 3 to 6 plans that are still yours. Each points at the gate that waits on it.

1. Staging: where, who pays (S1).
2. The second person with production access (P4).
3. Which flags go on for the first pilot customers and in what order (P5).
4. The Enterprise seat figure; who changes a customer's seat limit before billing exists.
5. A second Owner/Manager per account, and the rule for the last one.
6. Whether a WhatsApp delivery failure deserves an e-mail (which needs the recipient's address kept for the send).
7. Staff and the Fiche PDF (G9); who may create a share link (R4); attributable or minimised authority access (R2); share bounds (R3).
8. Retention: a number of years for the Fiche, the register, the structured guest record and licence documents (G4, M4).
9. Whether a report may back a real declaration (T5).

### Rules for this tracker

1. The Evidence column is filled in the commit that closes the gate; a row past its proposed date is raised at the start of the next session.
2. Each session of this phase starts by reading this table and ends by updating it.
3. The per-phase trackers keep the detail; when they disagree with this table, the most recently edited one wins and the other is corrected in the same commit.

---

## 7.1 — Security review of everything since Phase 3

**Scope.** The diff from the start of Phase 3 (`d7580bb`) to the head of this branch: Phases 3 to 6, about 22 000 changed lines in `apps` and `services`. **Method, stated plainly:** the built-in `/security-review` command was not run; the review was done by seven read-only reading passes, each given one area and told to verify every candidate end to end and discard what it could not substantiate: (1) storage, retention, audit and the document worker; (2) the public check-in surface; (3) authentication, RBAC, tenancy, configuration, CI; (4) the web app; then, on the final head, (5) Secure Share and the register, (6) messaging, checklist and team, (7) tax, exports, the Accountant role, migrations, CI and dependencies. Passes 1 to 4 read the Phase 3 code only (the branch was behind); their findings were re-verified by passes 5 to 7 and by hand on the final head. Nothing was run against a live deployment: this is a reading review, plus the test suites below. It is not the independent pass of 7.2 (see "What this review did not do").

**Result: no High finding.** No cross-tenant access, no exposed token or personal data, no authentication bypass, no route that Staff or the Accountant can use to reach data they must not see. No Medium on the scale of this plan (precondition needed or metadata leak) survived verification either; one pass had rated two items Medium (the unaudited guest reads, the CI audit gate) and they are listed below as Low with the reason. Every Low and Info item is either fixed (10, first table) or accepted or assigned with a reason (second table).

### Fixed in this step (each with a regression test that fails on the old code)

| # | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | Low | `rewrapOutdatedKeys` wrote by id only, so a `delete()` that shredded a key between its read and its write could be undone: the key reappears in the database and its backups | Write only if the row still holds the key that was read and is not deleted | `storage.int-spec`: never writes a key back onto a shredded object |
| 2 | Low | `delete()` marked the row deleted before writing the audit row: a failing audit write lost the audit of a physical deletion (reads already failed closed) | Audit first, then `deletedAt`; a retry finishes and writes the row | `storage.int-spec`: delete audit |
| 3 | Low | The draft purge shredded the photo, then deleted the row: a guest submitting at that moment ended `SUBMITTED` with a destroyed ID image | The row is deleted first and only while still `PENDING`; a submit that won leaves everything alone; a photo whose removal fails keeps its one-day expiry and is found by the next run | `retention.int-spec`: draft submitted while the purge runs (two tests) |
| 4 | Low | `submit` extended the retention of the photo it read at the start; an upload in between replaced it and the new photo kept the one-day expiry, purged within a day from a submitted guest | Re-read the photo inside the transaction, extend that one, and refuse (rolling back the claimed place) if it is gone | Covered by the existing check-in suites; the race itself is not reproducible in a test |
| 5 | Low | The purge queries took the first 200 rows with no paging: 200 permanently failing objects (a store outage) would starve everything behind them | All four queries now use the same paged `sweep` as registers and licence documents | `retention.int-spec` suite unchanged and green; starvation beyond 200 rows is not tested |
| 6 | Low | Owner/Manager reads of a guest's fields (`GET /guests/:id`) and Fiche regeneration left no audit row; the route had only the global 100 requests a minute | `guest.read` and `guest.fiche.regenerated` (identifiers only); 60 requests a minute on the detail route | `checkin.int-spec`, `fiche.int-spec` (real Chromium) |
| 7 | Low | `OCR_SERVICE_URL` could be plain `http` to a public host in production, sending ID images and the shared secret in clear; the answer was read with no size limit | Production refuses `http` to a public host; the answer is capped at 64 KB | `env.spec`, `ocr.client.spec` |
| 8 | Low | A rotated refresh token replayed inside the 30-second window left no trace | `auth.refresh_token.race` audit row (the window itself is unchanged) | Existing `auth.int-spec` green |
| 9 | Low | The guest form also accepted `?token=` from the query string, which has already reached a server and its logs | Fragment only | Existing e2e uses the fragment |
| 10 | Low | CI ran an unpinned `npx s3rver` and had no `permissions:` block; dev compose published Postgres, Redis and s3rver (default credentials) on every interface | Pinned to 3.7.1, `permissions: contents: read`, compose binds `127.0.0.1` | CI run |

Also corrected: `docs/deployment.md` said the key rotation moves 2000 objects per run; it is 200 per hourly run.

**Verification run for these changes:** lint, typecheck, unit tests (48 suites, 405 tests) and the integration suites for storage, retention, check-in, abuse, logging, auth, the permission matrix and the Fiche (with real Chromium) pass on a local Postgres 16 without Redis. The Redis-backed paths and the full integration suite were **not** validated here: with a local Redis the suite already fails 35 tests on the untouched head (BullMQ "missing key" errors), so that run says nothing about these changes. CI is the reference for them.

### Accepted or assigned, with the reason

| Finding | Severity | Decision |
|---|---|---|
| The login lockout is keyed on the email alone: anyone can lock a known address for 15 minutes | Low | Accepted: documented trade-off of the limiter; keying on email plus IP would let an attacker with many addresses guess freely. Revisit with the first customer complaint |
| Unauthenticated guest uploads are buffered (up to 8 MB) before the token is checked | Low | Accepted: per-address limit of 10 a minute; put a body-size limit at the edge (pen-test item in 7.3) |
| The consent id sent with a submission can be any approved text, not necessarily the current one, so `consentTextId` proves that an approved text was named, not which one the guest saw | Low | **Assigned to G3**: matters once counsel approves a second version; then require the current row in the guest's language (or a short grace window) |
| The per-link upload cap (10 in 15 minutes) is tight for a party of ten; the per-link draft cap is not atomic; a valid-token holder can tell whether a draft id exists | Low | Accepted: functional or negligible; revisit with the pilot if a party is refused |
| CSP allows inline scripts | Low | Accepted since Phase 1; nonces before the launch is widened (no injection sink was found anywhere in `apps/web`) |
| CI gates `npm audit` on critical only; 3 high advisories (`deepmerge-ts` through the Prisma CLI) exist | Low | Accepted: build-time tool, not reachable from the running API; re-run on each Prisma release |
| Fiche PDFs are never purged; the structured guest record is kept; the audit table is not append-only at database level | Info | **Gates G4** (retention) and a restricted database role for audit writes (7.5) |
| `MaritalDocument.fileUrl`, `AddOnService.licenseDocUrl`, `Vendor.docUrl` are URL strings; `MaritalDocument`, `AddOnService`, `AddOnOrder` have no `accountId`; none is used by any route | Info | **Precondition of M5 and Phase 8**: before any route uses them they need a `StoredObject` reference, `accountId` with composite keys and an entry in `TENANT_MODELS` |
| `OCR` worker: `requirements.txt` has unpinned ranges, no lockfile or hashes, ships test dependencies and an undigested base image; it buffers up to 10 MB before taking a concurrency slot | Low | Open for 7.5 (pin and hash, split dev requirements) |
| Arrivals returns guest names to Owner/Manager without an audit row; the Redis lockout key is the base64 of the email; the WhatsApp recipient counter reuses the JWT secret as its HMAC key; `TRUST_PROXY` has no production guard; the invitation quota is soft; licence PDFs are stored as uploaded | Info | Accepted: names only, no document number; the rest are hardening with no path to an exposure. `TRUST_PROXY` and the edge are checked by pilot checklist section 1 |
| A shared register goes stale when a guest is corrected after sharing: the link keeps serving the snapshot until expiry or revocation | Info | Accepted (a share is a snapshot); add to the pilot notes |
| `check:enablement` tests the guest feature only (bucket, Chromium, retention rows), not the register or share flags; if its bucket delete fails one random object stays | Info | Accepted; ticked by hand in the pilot checklist |
| Invitations and signup reveal whether an email is registered (409) | Info | Accepted since Phase 1 (public signup is closed to the pilot) |

### Checked and found sound (no finding)

Envelope encryption (fresh key and nonce per object, account-and-key bound AAD, tag checked, fixed error message), audit-before-read on every stored document, Secure Share token handling (256 bits, hash only, fragment and header, one neutral answer, expiry and revocation re-checked inside the transaction, atomic view count), the WhatsApp webhook (signature over the exact bytes, constant-time, neutral answers, payload never logged, forward-only status updates), tenancy (every tenant model in `TENANT_MODELS`, composite keys on every new table, nothing cascades to audit or storage), RBAC (every route declared, a matrix row for each, Staff and Accountant limits), team seat limits and the last-owner rule under a row lock, the Accountant portal (no guest data, no property route), exports (no formulas, text sanitised, rates from `RuleConfig`/`TaxRule`, disclaimer fails closed), the Fiche, register and tax PDFs (every value escaped, Chromium with JavaScript off and no network), web headers and token handling, and no committed secret.

### What this review did not do

- No dynamic testing: nothing ran against a deployed instance, so the real edge (client IP, body limits, webhook body bytes) is untested. That is 7.3, on staging.
- `services/ocr` was read for the trust boundary only; its dependencies were not scanned.
- Seven passes by the same kind of reader are not the independent pass planned as 7.2: that step stays, with the areas this review found least exercised (webhook through the real proxy, key backup and restore, logging under real traffic).
- The built-in `/security-review` command was not used; run it once on the final diff before the pilot if you want its output on record.
- Regression tests for findings 4 and 5 are partial (see the table).

---

## 7.2 — Independent read-only pass (storage, tokens, RBAC and tenancy, logging)

**Method.** Three read-only passes, each given one area, told to skip what 7.1 already fixed, and to report only what they verified in the code: (1) storage, keys and retention; (2) tokens, public routes, the webhook, sessions; (3) RBAC, tenancy and logging. Nothing was run against a deployment. **Result: no High. One Medium (needs your decision); the rest are Low or Info.** (🟡 in the work table = the code and documents are done, the part that needs staging or people is not.) Each item below is fixed with a test, accepted with a reason, or assigned.

### Fixed in this step

| # | Sev. | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | Low | `rewrapOutdatedKeys` had no ordering and no per-row handling: one corrupt row, or one wrapped by a retired key, was fetched first on every run, failed the hourly job for ever and starved every row behind it, so the old master key could never be retired | Ordered, per-row skip, returns `{ rewrapped, failed }`; the job fails (visible, retried) while any row fails; the runbook says not to drop the old key meanwhile | `storage.int-spec`: a row that cannot be rewrapped never blocks the others; `retention.processor.spec` |
| 2 | Low | The production storage checks applied only when a guest flag was on, but licence documents are uploaded whatever the flags say: with the defaults (`memory` driver) every uploaded licence document became unreadable at the next restart | In production the private, encrypted store (s3, master keys, SSE, https) is always required | `env.spec` |
| 3 | Low | `StorageService.read` ignored `expiresAt`: an image past its purge date stayed readable to Owner/Manager until the hourly job reached it, and for ever if the job was down | Expired objects answer 404 and write no audit row | `storage.int-spec`: refuses to serve an object past its purge date |
| 4 | Low | Staff received `feedId` and `importBatchId` on stays (whether a stay came from a calendar or a CSV), against the rule that Staff get no feed status | Those fields go with `revenue:read` | `day-counter.int-spec` |
| 5 | Low | Six log sites and the Redis error handler logged `e.message` (a failed insert can quote a stay summary, a lookup an e-mail address, a connection error a host) | `describeUnexpected(e, false)` (type, code, frames) everywhere; Redis logs the error name | Existing logging suites green; no dedicated test for the six sites |
| 6 | Info | CLAUDE.md said every non-GET method on `/api/share` answers `LINK_UNAVAILABLE`; only HEAD does, the others match no route | Documentation corrected | – |

### Needs your decision (Medium)

| Finding | Why | Options |
|---|---|---|
| **`POST /api/auth/signup` is open in code.** This plan says signup is closed to the pilot, but nothing enforces it: only the edge can. An attacker can create an account with any company name, then invite arbitrary addresses (20 an hour per account, unlimited accounts, per-address limits weakened by IPv6): Dari's sender domain then mails "*<attacker text>* vous invite…" with a real link | Reputation and deliverability of the sender domain; no data exposure | (a) `SIGNUP_ENABLED`, off in production, and you create pilot accounts by hand; (b) keep signup open but require a verified e-mail before any invitation can be sent, a global daily cap on invitation mail and a fixed prefix in the subject; (c) block the route at the edge and record that this is the control. Recommended: (a) for the pilot |

### Accepted or assigned

| Finding | Sev. | Decision |
|---|---|---|
| The access JWT lives 15 minutes after logout, password reset or reuse detection (only refresh tokens are revoked) | Low | Accepted for the pilot; a `sessionsRevokedAt` compared to the token's `iat` in `AuthGuard` (which already reads the user on each request) removes it: assigned to before the launch is widened |
| Refresh tokens have no absolute lifetime (each rotation issues 30 days) | Low | Assigned with the item above: cap the token family at about 90 days |
| `forgot-password` is limited per address only; an attacker rotating addresses in an IPv6 /64 can flood a victim and keep invalidating their reset token | Low | Assigned: per-e-mail counter (about 3 an hour, still 204) and do not invalidate a token issued minutes ago; key the limiter on the /64 for IPv6 |
| `EMAIL_IN_USE` on invitations is a cross-tenant existence check for any Owner/Manager and does not count against the hourly invitation quota | Low | Assigned with the item above: count the 409 against the quota. The 409 itself is accepted since Phase 1 |
| `StorageAudit.action` accepts any audit action, so a future caller could record a mismatched action and the audit gate would still pass | Low | Accepted: all seven read sites are correct; derive the action from the object kind if a new read site appears |
| Production defaults fail open: `NODE_ENV` defaults to `development` and `MAIL_DRIVER` to `console`; a deploy that forgets `NODE_ENV=production` prints reset and invitation links to stdout and skips every production guard | Low | Accepted: `npm run check:enablement` fails on `NODE_ENV` and the pilot checklist tests reset e-mail delivery on staging; revisit by requiring `NODE_ENV` explicitly |
| `Booking.feedId`, `Booking.importBatchId` and `Notification.propertyId`/`bookingId` have no composite `(id, accountId)` keys; `createdBy` and `invitedBy` are plain strings | Low | Assigned (migration): defence in depth only; every writer takes the id from a row it just loaded through the scoped client |
| A Staff `GET` on the checklist runs `createMany` and `deleteMany` (item sync), unaudited | Low | Accepted: scoped, idempotent, no exposure; move the sync to property changes when the checklist is next touched |
| `check-enablement.ts` reads `process.env` directly; `main.ts` prints boot errors with `console.error`; `ImportBatch.fileName` keeps the uploader's file name (not returned by any route) | Low | Accepted (ops script and boot path; config errors list variable names only). Store a generic file name with the next import change |
| The audit `ip` column keeps team users' addresses with no retention window | Low | **Assigned to G4**: decide a window or truncate the address (guest rows already carry none) |
| A crash between `store.put` and the row insert leaves ciphertext with no row (unreadable, never removed); a crash between deleting a Fiche and revoking its links leaves an ACTIVE link that answers 404; a manager can regenerate a Fiche after the purge removed it and the next run removes it again; tax exports have no retention rule | Info | Accepted; add a periodic bucket-versus-rows sweep if storage cost matters; the tax retention belongs to G4 with the Fiche |

### Checked and found sound

Every stored-object read reaches `StorageService.read` and is audited before any byte is returned; no URL or presigned link exists; object keys are random; delete order (shred, remove, audit, mark); tenant isolation of stored objects; Secure Share (token format, hash lookup, one neutral answer, revocation checked in the transaction, view cap keyed on the link, headers); the check-in public surface; the WhatsApp webhook (raw bytes, constant-time HMAC, neutral answers, replay idempotent, challenge limited to a safe alphabet); reset and invitation tokens (256 bits, hash, atomic single use, fragment); login timing and lockout; refresh rotation and reuse detection; CSRF and cookies; all 19 controllers declare their access, Staff and Accountant limits hold, every foreign key from a request body goes through the scoped client, the only raw SQL is parameterised, no token or address in logs.

### What this pass did not do

Nothing was run against staging: the real edge (client address, body limits, the webhook body through the proxy) is 7.3. Passes by readers of the same kind share blind spots: the pen-test on staging and the real-device pass are the other half.

---

## 7.3 to 7.5 — Status

| Step | Done here | Still yours |
|---|---|---|
| 7.3 Pen-test | [`pen-test.md`](pen-test.md) and `scripts/pentest-public.sh` (black-box checks of every public route, exit 1 on a failure) | Run the script and the manual list on staging through the real edge; record the results in `pen-test.md`; fix findings with regression tests |
| 7.4 Limits and abuse | `common/edge.int-spec.ts`: a forged `X-Forwarded-For` does not change the audited address (one trusted hop takes the right-most entry) and rotating a forged left entry does not escape the per-address limit; the share, check-in and webhook abuse suites already cover caps, bodies and parallel openings | Confirm the edge overwrites `X-Forwarded-For` and passes the webhook body unchanged (pilot checklist section 1); Redis failure behaviour and Chromium concurrency under load are not measured here (they need a staging with Redis and real traffic) |
| 7.5 Recovery | `storage/restore-drill.int-spec.ts` (dump, restore on a scratch database, every kind of object decrypts with the backed-up keys and not with others), key rotation (`storage.int-spec`), [`runbook.md`](runbook.md) (backups, restore and rotation drills, incident procedure) | Fill in the people table, restore your real backup on a scratch instance once, read the runbook aloud with the second person |
| 7.6 Real devices | [`production-enablement.md`](production-enablement.md) / [`pilot-checklist.md`](pilot-checklist.md) section 2 | Needs real phones (iPhone Safari, low-end Android) |
| 7.7 Legal sign-offs | Trackers in this file and in phases 3 to 6 | Counsel and the fiduciaire; record `validatedBy` in `RuleConfig` |
| 7.8 Pilot | – | You: onboarding, weekly review, the decision on each flag; `docs/phase-8.md` from what the pilot shows |
