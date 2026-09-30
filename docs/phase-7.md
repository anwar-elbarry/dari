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
| 7.0 | Gate tracker for this phase, the consolidated list of open decisions, staging environment | fast |
| 7.1 | `/security-review` on the diff since Phase 3; fix or accept each finding with a test | strong |
| 7.2 | Independent read-only pass on storage, tokens, RBAC and tenancy, logging, public routes, webhook; fix or accept | strong |
| 7.3 | Pen-test checklist on the public routes, run against staging; findings fixed with regression tests | strong |
| 7.4 | Limits and abuse: rate limits against the real edge, upload and PDF concurrency, Redis failure behaviour | fast |
| 7.5 | Backups, restore drill, key rotation drill, incident runbook | fast |
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
