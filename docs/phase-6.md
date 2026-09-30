# Phase 6 — Licensing checklist, team management and messaging

Part of the [roadmap](../README.md). Built solo with Claude: each numbered step below is one short, single-feature session. Template and conventions: [`phase-1.md`](phase-1.md), [`phase-4.md`](phase-4.md), [`phase-5.md`](phase-5.md) (whose patterns this phase reuses: capabilities and the permission matrix, feature flags with their own guard, encrypted `StoredObject` files with audited reads, `RuleConfig` for anything a lawyer or fiduciaire decides).

**Goal:** a manager can run a full property onboarding without help: a licensing checklist for Marrakech filtered by licence type, with the supporting documents attached; a team that can be invited, re-roled and removed within the plan's seat limit; and check-in links and alerts delivered by WhatsApp with e-mail as the fallback.

**Why it matters:** the checklist is what turns Dari from a counter into the customer's compliance file; team management is required before a second user can use the product safely; WhatsApp is where Moroccan conciergeries already talk to guests, and today the token in the manager's `wa.me` link is visible to WhatsApp's redirect page (accepted in Phase 3, removed by the Business API).

**Hard gates for this phase (not code):** Meta WhatsApp Business verification (founder, weeks of waiting: start now); the content of the Marrakech licensing checklist and its wording (counsel or a local advisor: the list of steps per licence type is a legal statement, so it is data with a validator, like a tax rate); retention of the uploaded licence documents (counsel).

---

## Carried over from Phase 5

| Item | Why it lands here |
|---|---|
| Tax rules are unvalidated BETA defaults (`validatedBy` NULL); the fiduciaire has not confirmed rates, thresholds, the stay-month rule, rounding, or the VAT basis | Not code. Tracked in [`phase-5.md`](phase-5.md); the moment the rows are validated the watermark disappears by itself (`PipelineResult.beta`) |
| No income-tax rule exists for the professional and company regimes; local taxes (TPT) have no `TaxRule` rows; Taxe de séjour uses the amount entered on the stay | Fiduciaire input; the report says "not computed" until then |
| Annual summary and report history screens | Phase 8 (first item) |
| Amounts come from CSV imports and manual entry only | Payout-report import after the pilot |
| The Phase 3 and Phase 4 legal gates (CNDP, hosting, consent, retention, official forms, share rules) | Trackers in `phase-3.md` and `phase-4.md`; no code |

---

## Scope

### In
- **Licensing checklist** per property: steps from a versioned, validated template (`RuleConfig` or a `ChecklistTemplate` table: city, licence type, condition such as "meals"), instantiated per property, status `TODO` / `IN_PROGRESS` / `DONE` / `NOT_APPLICABLE`, a due date and a note, a progress bar; supporting documents attached as encrypted `StoredObject`s (kind `LICENSE_DOCUMENT`), read through an audited route, never a URL
- **Team management:** invite (exists), list, change role, disable and remove a user, resend and revoke an invitation; `Account.seatLimit` enforced when inviting and when re-enabling; the last Owner/Manager cannot be removed or demoted; a disabled user's sessions end at once (`AuthGuard` already re-reads the user each request)
- **WhatsApp Cloud API** delivery (feature flag `WHATSAPP_ENABLED`, off by default in production) of check-in links, day-counter alerts and share links, from approved message templates; e-mail as the fallback when the number is missing, the template is not approved or the send fails; the token is sent to the guest or the manager directly, so the `wa.me` redirect is no longer needed
- Delivery log (`MessageDelivery`: channel, template, status, timestamps, provider message id; never the body, the token or the guest's number in the clear)
- Screens: checklist per property, team page, notification preferences per user (channel per alert type), delivery status on the arrivals screen

### Out (later phases)
- Two-way WhatsApp conversations, chatbots, marketing messages → not planned
- Automatic filing of licence applications → never in the MVP
- Billing and plan changes (seat limit is set by the operator for now) → Phase 8
- Upsell store, vendor ledger, KPIs → Phase 8
- Arabic UI → after the pilot (solo plan)

---

## Decisions to lock before coding

| Topic | Recommendation | Reason |
|---|---|---|
| Where the checklist template lives | A table `ChecklistTemplateStep` (city, licence type, condition, step name FR/EN, order, `validatedBy`, `validatedAt`), seeded from the counsel's list; a property gets copies (`ChecklistItem`) when its licence type is set | The steps are a legal statement (rule 1 spirit): data with a validator, not code; copying lets a step be ticked and noted per property while the template evolves |
| An unvalidated template | Shown with a "not validated" label and never described as the legal list | Same principle as the tax beta banner |
| Documents | Encrypted `StoredObject`s, Owner/Manager only, audited reads, retention as a `RuleConfig` row set by counsel | Rule 3 in `CLAUDE.md` extended; a licence may carry personal data of the owner |
| Removing a user | Disable (keeps the audit trail's actor ids valid) and hide; hard delete only by the operator | The audit trail references user ids |
| Seat count | Active (not disabled) users plus pending invitations, against `seatLimit` | Prevents inviting past the plan |
| WhatsApp templates | Approved by Meta, stored by name and language in `RuleConfig`; the app sends only a template name and its variables | Meta rejects free text outside a 24 h window; keeps wording out of code |
| Where the guest's number comes from | Entered by the manager for the booking (`Booking.guestPhone`, encrypted at the field level or kept short-lived), never scraped from a platform, purged with the check-in link | Phone numbers are personal data (rules 3 and 4): no third party except Meta, and only with a documented CNDP position |
| The check-in token in WhatsApp | The message carries the link with the token in the fragment as today; the API sends it straight to Meta, the manager never sees `wa.me` | Removes the redirect page; Meta still sees the message: counsel must know the channel |
| Fallback | E-mail, then leave the link in the screen for the manager to copy | No silent loss |
| Quiet hours and rate | No sends between 22:00 and 07:00 Africa/Casablanca except alerts marked urgent; per-account daily cap | Avoids waking guests and surprise Meta bills |

---

## Data model changes

| Model | Change |
|---|---|
| `ChecklistItem` | Add `accountId` (composite keys with `accountId`), `templateStepId`, `dueDate`, `note`, `documentObjectId` (a `StoredObject`); `status` gains `IN_PROGRESS` and `NOT_APPLICABLE`; replace `documentUrl` |
| `ChecklistTemplateStep` (new) | City, licence type scope, condition, order, names FR/EN, `validatedBy`, `validatedAt` (not tenant data: global, like `TaxRule`) |
| `StoredObject.kind` | Add `LICENSE_DOCUMENT` |
| `User` | Keep `disabledAt`; add `removedAt` if hiding is needed; unique constraint stays on email |
| `Invitation` | Add `resentAt` and a resend counter to cap re-sends |
| `MessageDelivery` (new) | `accountId`, `channel` (WHATSAPP, EMAIL), `template`, `subjectType` + `subjectId` (a check-in link, an alert), `status`, `providerMessageId`, timestamps; composite keys with `accountId` |
| `NotificationPreference` (new) | Per user and alert type: channel and on/off |
| `RuleConfig` | `retention.license_documents_days`, `whatsapp.templates` (names and languages), `messaging.quiet_hours` |
| `AuditAction` | `user.role_changed`, `user.disabled`, `user.enabled`, `checklist.updated`, `license_document.read`, `message.sent` |
| Capabilities | `checklist:read` (Owner/Manager, Staff read-only), `checklist:write`, `license_document:read` (Owner/Manager), `team:manage` extended (role change, disable, enable) |

---

## API surface

| Route | Method | Access | Notes |
|---|---|---|---|
| `/properties/:id/checklist` | GET | `checklist:read` | Items with progress; Staff see status only |
| `/properties/:id/checklist/:itemId` | PATCH | `checklist:write` | Status, due date, note |
| `/properties/:id/checklist/:itemId/document` | POST / GET / DELETE | `checklist:write` / `license_document:read` | Upload (size and type caps, sanitised like images), decrypt-audit-stream, delete (shred) |
| `/users` | GET | `team:manage` | Members with role, status, last login |
| `/users/:id` | PATCH | `team:manage` | Role, disabled; refuses the last Owner/Manager and yourself |
| `/invitations/:id/resend` | POST | `team:manage` | Capped |
| `/me/notification-preferences` | GET / PUT | any signed-in role | Channel per alert type |
| `/webhooks/whatsapp` | GET / POST | public, signed | Meta verification and delivery statuses; signature checked, neutral errors, no personal data logged |

Every route goes into the permission matrix; every `:id` route into the tenant-isolation suite; the webhook gets its own abuse and logging tests, as the public routes of Phases 3 and 4.

---

## Screens

| # | Screen | Notes |
|---|---|---|
| 18 | Checklist (per property) | Steps grouped by stage, progress bar, status control, due date, note, document attach and open; "template not validated" label |
| 19 | Team | Members, role selector, disable, invitations with resend and revoke, seat usage against the limit |
| 20 | Notification preferences | Per alert type: WhatsApp, e-mail, both, none |
| 21 | Delivery status | On the arrivals screen: sent, delivered, read, failed, fell back to e-mail |

---

## Work breakdown

| Step | Work | Model |
|---|---|---|
| 6.0 ✅ | Carry-overs that need code (none blocking) and the gate tracker for this phase; start the Meta verification | fast |
| 6.1 ✅ | Data model, migration, capabilities, RuleConfig rows, feature flag `WHATSAPP_ENABLED` | fast |
| 6.2 ✅ | **Team management API**: list, role change, disable/enable, seat limit, last-manager protection, resend; tests on session termination | strong |
| 6.3 ✅ | Checklist API and template loading; document upload, audited read, shred, retention | fast |
| 6.4 ✅ | **Messaging service**: provider interface, WhatsApp Cloud driver, e-mail fallback, templates from RuleConfig, quiet hours, caps, delivery log, signed webhook | strong |
| 6.5 ✅ | Web: team, checklist, preferences, delivery status | fast |
| 6.6 ✅ | Hardening: webhook abuse and logging suites, security review, e2e, docs, Phase 7 plan | strong |

Steps 6.2 and 6.4 carry the risk.

### Steps 6.0 and 6.1 as built

**6.0 — carry-overs and gates.** No carried-over item needs code before the checklist, team and messaging work: the Phase 5 items are fiduciaire input and Phase 8 screens, and the Phase 3/4 gates are legal. The gates for this phase are in the tracker below. Starting the Meta verification is the founder's action (weeks of waiting); nothing in 6.2 to 6.3 depends on it.

**6.1 — data model and switches** (migration `20260930130000_phase6_checklist_team_messaging_model`):
- `ChecklistTemplateStep` (global, `validatedBy`) and a reworked `ChecklistItem` (tenant table, composite keys to `Property` and to the document `StoredObject`, unique per property and step, `dueDate`, `note`, statuses `IN_PROGRESS` and `NOT_APPLICABLE`). The table had never been written, so it was cleared before the new NOT NULL columns. **No template step is seeded:** the list of steps is a legal statement that only counsel's list may fill (gate below); until it exists a property's checklist is empty and the screen says so.
- `MessageDelivery` (channel, template name, subject, status, provider message id, a fixed `failureCode`; no body, link, token or number; unique per channel and provider message id so a replayed delivery report is idempotent) and `NotificationPreference` (per user and alert type, composite key to `User`, which gained `@@unique([id, accountId])`). `Invitation` gained `resentAt` and `resendCount`.
- `StoredObjectKind.LICENSE_DOCUMENT`. Capabilities `checklist:read` (Owner/Manager and Staff, who will get status only), `checklist:write` and `license_document:read` (Owner/Manager). `team:manage` is unchanged for now. Audit actions `user.role_changed`, `user.disabled`, `user.enabled`, `checklist.updated`, `license_document.read`, `message.sent`.
- `RuleConfig` rows, all unvalidated: `retention.license_documents_days` (no default: nothing is deleted until counsel sets a period), `whatsapp.templates` (names empty until Meta approves them; a kind without a template goes by e-mail), `messaging.quiet_hours` (22:00 to 07:00 Africa/Casablanca) and `messaging.daily_cap` (200 a day per account). The daily cap row is an addition to the plan's list: the plan asks for a cap and rule 1 makes it data. Read through `RulesService.licenseDocumentRetention()`, `whatsappTemplates()`, `quietHours()`, `dailyCap()`.
- Flag `WHATSAPP_ENABLED` (on outside production, off in production) with `WhatsAppEnabledGuard` in `messaging/`. It needs no storage settings; the provider settings arrive with the driver in 6.4.
- Tests: env, capabilities, guard, rules, and the composite tenant keys of the new tables.

### Step 6.2 as built

**Team management API** in `apps/api/src/invitations` (`team.service.ts`, `team.controller.ts`, `seats.ts`, `team.dto.ts`):
- `GET /users` (`team:manage`): members (active and disabled) with role, status, last login, and `seats: { used, limit }`. Used counts active Owner/Manager and Staff plus pending Staff invitations; the Accountant is never counted (`countedRoles` from `plan.seat_limits`). Pending invitations themselves stay on `GET /invitations`.
- `PATCH /users/:id` (`team:manage`): `{ role?, disabled? }`. The role can only be set to Staff or Accountant — promoting to Owner/Manager is out of scope (open decision). The caller can never change their own row (`CANNOT_MODIFY_SELF`), which is what protects the last owner: only owners reach this route and they cannot touch themselves, so a peer owner can be demoted or disabled only while the acting owner remains, and the account always keeps an owner. Re-enabling a member, or moving one into a counted role (Accountant → Staff), needs a free seat. Disabling or changing a role revokes the member's refresh tokens in the same transaction; a disable is refused immediately by the auth guard (it re-reads `disabledAt`), while a role change takes effect on the next request (the guard re-reads the role) and forces re-authentication within the access-token lifetime.
- `POST /invitations/:id/resend` (`team:manage`): re-issues a pending invitation. Only the hash is stored, so a new token is minted (the old link dies) and the expiry is refreshed; capped at `MAX_INVITATION_RESENDS` (3) → 429 `RESEND_CAP_REACHED`. The seat is unchanged.
- **Seat enforcement on invitation** (`invitations.service.ts`): counted-role invitations need a free seat, checked and written in one transaction under a row lock on the account (`lockAccountSeats`), so parallel invitations cannot both take the last seat. Re-inviting the same email revokes the old pending row first, so it never double-counts. Accountant invitations skip the seat check.
- Audit: `user.role_changed`, `user.disabled`, `user.enabled`, `invitation.resent`, all ids only.
- Tests: `team.int-spec.ts` (overview, seat limits incl. Starter and the parallel-race, role/disable/enable, self-refusal, last-owner, resend), extended permission matrix and tenant-isolation rows, and the seat helper reused by `invitations.service`. `Account.seatLimit` in the test seed is 50 so the RBAC suites are not constrained by seats.

**Note on `Account.seatLimit`:** enforcement uses the per-account `Account.seatLimit` column (the authoritative value the operator sets; billing is Phase 8). The `plan.seat_limits` rule supplies the per-plan figures (used by the retro-migration and the future billing/plan-change path) and, more importantly here, `countedRoles`. Signup still uses the column default (1 = Starter); wiring signup to the policy waits for the plan picker, to keep the auth path untouched.

### Step 6.3 as built

**Checklist API** in `apps/api/src/checklist`:
- `GET /properties/:id/checklist` (`checklist:read`): `{ covered, validated, progress: { done, total }, items }`. The copies of the template steps are made on read (idempotent: a unique key plus `skipDuplicates`, so parallel reads create each once). A step applies when its city equals the property's commune (case-insensitive, trimmed) and its licence type is the property's or unrestricted. **A step with a `condition` (such as "meals") is included**: the property has no field saying whether it applies, so the manager marks it "not applicable"; progress leaves those out. Changing a property's licence type drops the copies of steps that no longer apply only if nobody touched them. `covered: false` means no checklist exists for that city: nothing is invented. `validated` is true only when every step of the list has a `validatedBy`.
- **Staff** get `id, code, names, condition, position, status` and nothing else: no due date, note or document flag. The choice is made on the `license_document:read` capability, not on the role name.
- `PATCH /properties/:id/checklist/:itemId` (`checklist:write`): `status`, `dueDate` (`YYYY-MM-DD`, a real date), `note` (500 characters); `null` clears. Audit `checklist.updated`, ids only (never the note).
- Documents: `POST|GET|DELETE /properties/:id/checklist/:itemId/document`. Upload (`checklist:write`, 8 MB, one file, no other fields) accepts a **PDF** (recognised by content, stored as is) or a **photo** (decoded and re-encoded to JPEG with all metadata dropped, as for ID scans); anything else is 422 `DOCUMENT_INVALID`, an oversized body 413. The file is a `LICENSE_DOCUMENT` `StoredObject`, written provisional and adopted by a compare-and-swap that also marks the replaced file due (`handOver`), then the old one is shredded; parallel uploads leave one live file. Read (`license_document:read`, Owner/Manager only) writes the `license_document.read` audit row before decrypting, then sends the file as a download (`Content-Disposition: attachment`, `nosniff`, `no-store`): a PDF is never rendered inside our origin. Delete detaches and shreds.
- **Retention:** `retention.license_documents_days` is applied by the hourly job only once counsel has validated a period, **counted from the upload date** (an assumption for counsel to confirm: a licence document may need another anchor, such as the end of the operation). The item stays and loses its document; the purge is audited `retention.purged`.
- **Template loading** (`npm run checklist:load -w apps/api -- file.json`): `parseTemplateFile()` validates counsel's list (codes, bilingual names, positions, licence types, conditions; a validator and a date go together) and `loadChecklistTemplate()` upserts it by (city, code). A step edited without a validation becomes unvalidated again; steps stored but absent from the file are reported and left alone. **No step is supplied by the code**; the tests use invented ones.
- Tests: `checklist.int-spec.ts` (loading, scoping by city and licence type, races, Staff view, validation, documents, audit-before-bytes, retention), the permission matrix and tenant-isolation rows, `template-file.spec.ts`, `document-type.spec.ts`, and a checklist case in `checkin-logging.int-spec.ts` (notes, file names, file contents and storage failures that quote them).

**Housekeeping:** the 6.2 commit had reformatted whole files with Prettier's defaults, although the repo has no Prettier config and is hand-formatted (single quotes, long lines). The seven files concerned were restored and the 6.2 changes re-applied in place (about 80 changed lines instead of about 2,000). Do not run `prettier --write` on existing files.

### Step 6.4 as built

**Messaging** in `apps/api/src/messaging`:
- `MessagingService.send()` is the one place that decides how a message leaves. WhatsApp is used when `WHATSAPP_ENABLED` is on, the recipient has a number, an approved template exists for the kind (`checkin_link`, `day_counter_alert`, `share_link`), it is not quiet hours (unless the message is urgent) and the account's daily WhatsApp cap is not spent. Otherwise, or if WhatsApp fails, it falls back to e-mail when the caller gave one. **Quiet hours and the cap apply to WhatsApp only**: e-mail is not an interruption and is not billed per message. The cap is soft (two racing requests may each pass by one). Each attempt is one `MessageDelivery` row: template name, status, subject id, a fixed `failureCode`. Never the body, a link, a token or a number.
- Providers: `stub` (dev and tests; records in memory; refused in production once WhatsApp is on) and `cloud` (Meta's WhatsApp Cloud API, fixed host, templates only, variables flattened to single-line text). Provider errors carry a fixed code from the HTTP status (`PROVIDER_UNREACHABLE|AUTH|RATE_LIMITED|REJECTED`); the response text, which can quote the recipient, is never read. Env: `WHATSAPP_DRIVER`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_API_VERSION` (all four secrets required with the cloud driver).
- **Numbers.** The manager's own number is stored on the user (`PUT /me/phone`, E.164 only; a number written with a bracketed trunk "(0)" is refused rather than guessed; shown masked). A guest's or an authority's number is typed at send time (`whatsappTo` on link creation, resend and share creation), used for that one message and stored nowhere. Nothing is sent to a number that has not been typed by the person sending.
- **Wired in:** check-in links (create and resend; the response carries `delivery`, and the link is always returned so the manager can copy it: there is no guest e-mail to fall back to), day-counter alerts (per-user choice: e-mail, WhatsApp with e-mail fallback, both, none; a critical alert is urgent) and Secure Share links (the private recipient label is never put in the message). `GET|PUT /me/notification-preferences`, `GET /checkin-links/:id/deliveries`.
- **Webhook** `GET|POST /webhooks/whatsapp` (public, `WHATSAPP_ENABLED` guard): the handshake echoes the challenge only for the configured verify token; delivery reports are authenticated by `X-Hub-Signature-256` (HMAC-SHA256 over the raw body, constant-time compare) before the payload is parsed. Every failure is the same neutral 404. Reports move a delivery forward only (SENT, DELIVERED, READ), a replay changes nothing, a stale "failed" after delivery is ignored, unknown ids are ignored, and everything else in the payload (inbound messages, numbers, error texts) is dropped unread. The raw body is read for this path only (`configure-app.ts`), and the route is the only one exempt from the CSRF header (`@SkipCsrf()`; a test fails if it appears anywhere else or on a non-public route).
- Enablement check: warnings (never blockers) for the driver, webhook settings, the number of approved templates, the checklist validation and the licence-document retention; two manual steps (Meta verification and templates, the CNDP position on Meta).
- Tests: `messaging.int-spec.ts`, `delivery.int-spec.ts`, `whatsapp-webhook.int-spec.ts`, provider, signature, phone and quiet-hours units, the CSRF guard, the permission matrix and tenant isolation rows, and a WhatsApp case in `checkin-logging.int-spec.ts` (provider errors that quote the number, the link and the message).
- **Not done, on purpose:** a delivery report of failure does not trigger an e-mail (the send path does not keep the recipient's e-mail, and nothing personal is stored to do so); the cost of that is a WhatsApp message that Meta accepts and then fails to deliver stays "failed" on the arrivals screen, where the manager sees it and can copy the link.

### Step 6.5 as built

**Web** (`apps/web`), French and English, phone first:
- **Team** (`/team`, `components/team`): seats bar ("2 places utilisées sur 3"; the accountant is not counted), members with role select (Staff or Accountant), remove and restore access, pending invitations with resend and cancel, and the invite form. An owner's row and your own row have no controls (the API refuses both anyway). A full plan shows the API's message instead of hiding the form.
- **Checklist** (`/properties/[id]/checklist`, `components/checklist`, linked from the property page): progress bar (not-applicable steps leave the count), a warning while the list is not validated by counsel, an "no checklist for this city" state, status per step, deadline, note, and the document: attach or replace, download (fetched as a blob only on request, revoked at once), remove. Staff see the steps and their status only.
- **Notifications** (`/notifications`, owners and managers): the manager's own WhatsApp number (masked, never returned in full, cleared from the field once saved) and the channel per alert type. WhatsApp choices appear only when the API says it is ready and a number exists.
- **Sending from Dari:** the check-in link dialog and the Secure Share dialog offer an optional number when WhatsApp is ready for that kind of message, show how the send went in words (delivered, or why not and what to do), and drop the manual `wa.me` button once Dari sends the link itself; when WhatsApp is not ready the manual way is unchanged. The arrivals list has a "Voir l'envoi" button per link that loads its delivery history on request (no call per stay).
- Client checks mirror the API (`lib/phone.ts`); the API decides. Strings live in `team.*`, `checklist.*`, `notifications.*`, `delivery.*` and the new `errors.*` codes. next-intl reads a dot in a key as nesting, so alert types are looked up as `alert_day_counter_red`.
- **E2E** (`e2e/phase6.spec.ts`, phone viewport): seats and refusal of a Staff invitation on a full plan, the accountant taking no seat, resend and cancel; the checklist with a note, a deadline and a document that downloads back byte for byte, a refused file type, Staff seeing status only, the Accountant redirected; the WhatsApp choices and a link sent from Dari (number masked, manual button gone). `phase1.spec.ts` now follows the Starter plan (one seat: the owner invites the accountant; a Staff invitation is refused). The specs put back what they change (invitations, the WhatsApp rules). The checklist steps in the spec are invented and stay in the e2e database.
- Running the whole suite locally, everything passed except the Phase 3 passport reading, which needs Tesseract (not installed in that container).

### Step 6.6 as built: independent security review

A read-only reviewer read every Phase 6 file (team, checklist, messaging, webhook, migrations) and traced each candidate through the code before reporting it. **No high finding; no cross-tenant access, capability gap, logging leak or webhook-authentication flaw.** One medium and six lows, all fixed with a regression test except one accepted limit:

| # | Severity | Finding | Outcome |
|---|---|---|---|
| 1 | Medium | The WhatsApp sender could be used as a spam or phishing relay: any account could message any number, with its own property or company name as free text inside an approved template | Fixed. Names put in a template lose everything that makes a link, a domain or an address (`nameVariable`, 60 characters); one number can receive at most 3 messages a day from Dari across all accounts (`RECIPIENT_DAILY_LIMIT`, a keyed hash in a window counter that expires with the window: the number is not stored; Redis-backed in production). The per-account cap and the approved-template rule stay. Residual: account creation is open, so a determined abuser can still create accounts; watch Meta's quality rating in the pilot |
| 2 | Low | A `null` role, flag or status passed validation (`@IsOptional` lets `null` through) and ended as a 500 | Fixed: absent is allowed, `null` is a 400 |
| 3 | Low | Invitation e-mails had no route throttle or quota; the resend cap was a read-then-write that parallel requests could overshoot; cancel and re-invite reset it | Fixed: route throttle, 20 invitations an hour per account counting new invitations and re-sends (`INVITATION_QUOTA`), and the cap is part of the write |
| 4 | Low | Inviting reveals whether an e-mail is registered in another account | **Accepted, as in Phase 1** (a taken e-mail returns 409; fixing it needs e-mail verification at signup, planned after the pilot). Now bounded by the throttle and the hourly quota |
| 5 | Low | With two Owner/Manager users (none can be created from the app), each could disable the other at the same moment and leave no active owner | Fixed: the change is refused inside the locked transaction when no other active owner would remain (`LAST_MANAGER`) |
| 6 | Low | The user's own settings routes were not behind the WhatsApp flag, contrary to the guard's comment | Decided and fixed the other way: they stay reachable (they carry the e-mail and dashboard choices too), but while WhatsApp is off they refuse a WhatsApp choice and refuse to store a number. The guard's comment says so |
| 7 | Low | The licence-document and register purges took a fixed batch with no order, so rows that keep failing could hide the rows behind them | Fixed: paged sweep that skips past failures |

Also checked and sound (from the review): tenant scoping and composite keys on every new table, sessions ending on disable and role change, the audit row before every document read, upload limits and download-only serving, the constant-time signature check and its raw-body handling, the CSRF exemption confined to one route by a test, fixed provider error codes, and no phone number, token, note or message body in logs, deliveries or audit rows.

### Decisions taken (2026-09-30)

- **Seat limits** (`RuleConfig` `plan.seat_limits`, migration `20260930140000`): Starter 1 seat (1 Admin), Growth 3 (1 Admin + 2 Staff), Conciergerie 6 (1 Admin + 5 Staff). The same row lists `countedRoles`: Owner/Manager and Staff use a seat; **the Accountant does not** (a read-only external reader), so the seat count in 6.2 is active Owner/Manager + Staff users + pending invitations for those roles. Read through `RulesService.seatPolicy()`. Existing Growth and Conciergerie accounts still on the column default were raised to 3 and 6. **Enterprise has no figure**: its accounts keep the `Account.seatLimit` set by the operator. Not a legal validation: `validatedBy` stays empty. Note that a Starter account has one seat, so it cannot invite Staff; it can still invite the Accountant.
- **Staff and the checklist:** status only, read-only (`checklist:read`, no write, no notes, no documents). Rationale given by the founder: the manager or owner carries the legal responsibility for compliance, and the checklist holds high-stakes items (documentary audit, technical safety). The references to the Moroccan texts (Décret 2-23-441, Loi 80-14) come from the founder and have not been checked by us; counsel should confirm them and the wording of the checklist before it is presented as anything but a working list.

### Hard gates: tracker

**Dates are proposals (set 2026-09-30): confirm or change them.**

| Gate | Owner | Proposed date | Status |
|---|---|---|---|
| Meta WhatsApp Business verification started (business account, phone number, display name) | Founder | 2026-10-07 | Open |
| WhatsApp message templates written and submitted for approval (check-in link, day-counter alert, share link; FR first); approved names entered in `whatsapp.templates` | Founder | 2026-10-31 | Open |
| CNDP position on Meta as a recipient of guest phone numbers and check-in links (mentioned in the Phase 3 tracker) | Founder + counsel | before 6.4 goes live | Open |
| Marrakech licensing checklist: the steps per licence type, in French and English, with the conditions (such as meals) | Counsel or local advisor | 2026-10-31 | Open |
| Retention of uploaded licence documents (`retention.license_documents_days`) | Counsel | 2026-10-31 | Open |
| Seat limits per plan | Founder | 2026-09-30 | **Decided**: Starter 1, Growth 3, Conciergerie 6; Enterprise has no figure yet (see below). Who changes a limit before billing exists is still open |
| Staff access to the checklist and documents | Founder | 2026-09-30 | **Decided**: status only, read-only, in 6.3 |

---

## Tests required

- **Team:** the seat limit holds under parallel invitations; the last Owner/Manager cannot be removed, demoted or disable themselves; a disabled user's next request is refused and their refresh token no longer works; another account gets 404; Staff and Accountant refused; every change audited.
- **Checklist:** template steps filtered by licence type and condition; an unvalidated template is labelled; documents encrypted, reads audited before any byte, purged by retention; another account gets 404; Staff see status only.
- **Messaging:** a send falls back to e-mail on every provider failure; quiet hours and caps hold; the delivery log holds no body, token or number; the webhook rejects a bad signature with a neutral answer and never logs the payload; a replayed delivery status is idempotent.
- **Logging:** the redaction suite extended to the new routes and to provider failures that quote the number or the token.
- **E2E (phone viewport):** invite a member, change their role, disable them (their session ends), tick a checklist step and attach a document, send a check-in link (provider stubbed).

---

## Security checklist for this phase

- [ ] Roles and seats enforced at the API; the last Owner/Manager protected; sessions end on disable
- [ ] Licence documents: encrypted, audited reads, no URL, retention from `RuleConfig`
- [ ] The WhatsApp token or number never in a log, an audit row, a delivery row or an error message
- [ ] Webhook: signature verified in constant time, replay-safe, rate limited, no personal data in responses
- [ ] Guest phone numbers minimised, purged with the check-in link, sent only to Meta and only with a documented CNDP position
- [ ] `WHATSAPP_ENABLED` off by default in production; routes answer 404 when off

---

## Definition of done

1. A manager invites a colleague, changes their role and disables them within the seat limit; the last manager cannot be removed.
2. A property's checklist is generated from the validated template for its licence type, ticked, and documents are attached and read back (audited).
3. A check-in link and a day-counter alert reach a test phone by WhatsApp; with the provider down they arrive by e-mail; the delivery status is visible.
4. No token, number or document appears in a log or a delivery row; the webhook and messaging suites pass in CI.
5. Security review has no open high-severity finding.
6. `docs/phase-7.md` written (hardening and pilot); the hard gates above are tracked with an owner and a date.

## Risks

| Risk | Mitigation |
|---|---|
| Meta verification takes weeks | Start in step 6.0; ship the team and checklist first; the `wa.me` button stays as the interim channel |
| The licensing checklist is wrong or out of date | Data with `validatedBy`, labelled while unvalidated, versioned; never described as the legal list |
| A phone number or token leaks through a provider error or log | Redacting logger, fixed error messages, delivery rows without content, a logging test that quotes them |
| A removed colleague keeps access | Disable ends sessions at once (guard re-reads the user); test |
| Owners of a small conciergerie lock themselves out | The last Owner/Manager cannot be demoted, disabled or removed |
| WhatsApp cost or spam complaints | Quiet hours, daily cap, template-only messages, an opt-out per user |

## Open decisions (need your answer)

1. Who provides and validates the Marrakech checklist (counsel, a local advisor, the prefecture's own list), and by when?
2. Retention of the uploaded licence documents?
3. Guest phone numbers: may the platform store the number entered for a booking (for how long), and is Meta an acceptable recipient in the CNDP file?
4. ~~Seat limits per plan~~ decided (see above); still open: who changes a limit before billing exists, and the Enterprise figure.
5. ~~Staff and the checklist~~ decided: status only.
6. Is e-mail enough as the fallback, or is SMS wanted too?

---

## Outcome (Phase 6 closed: code complete, gates open)

Steps 6.0 to 6.6 are done. CI runs the unit and integration suites (Postgres, Redis, Chromium) and the phone-viewport e2e, including `phase6.spec.ts`.

**What was delivered**
- **Team:** members, seats by plan from `RuleConfig` (Starter 1, Growth 3, Conciergerie 6; the accountant uses no seat), role changes, remove and restore access with sessions ended at once, invitation resend with a cap and an hourly quota; screens for all of it.
- **Licensing checklist:** the loader and validator for counsel's list (nothing is written in code), per-property copies by city and licence type, status, deadline, note, encrypted documents (audited read, download only, provisional-then-adopt), retention once validated, Staff status only.
- **Messaging:** WhatsApp Cloud API delivery with e-mail as the fallback for check-in links, day-counter alerts and Secure Share links; quiet hours, a daily cap and a per-number limit; per-user channel choices; delivery history; a signed, replay-safe webhook. The manual `wa.me` button remains until WhatsApp is ready.
- **Ops:** the enablement check reports the WhatsApp, checklist and licence-retention gaps as warnings; the pilot checklist has a Phase 6 section.

**Accepted and documented**
- Everything in the review table (finding 4), plus: the daily WhatsApp cap is soft; a message Meta accepts and later fails to deliver does not trigger an e-mail; owners cannot be promoted, demoted or removed from the screen; licence-document retention counts from the upload; Enterprise has no seat figure and a new account starts at the column default (1).
- The token in a check-in or share link goes to Meta once WhatsApp is on (in the message text). That is the channel, and the CNDP position on it is an open gate below.

The open gates (Meta, templates, the CNDP position on Meta, the checklist and its validation, licence-document retention, Enterprise seats) are in the tracker above. Phase 7 ([`phase-7.md`](phase-7.md)) puts every phase's gates in one list with owners and dates.
