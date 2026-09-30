# Pilot checklist

Everything here needs a person, a phone or a decision; none of it is covered by CI. Run it with **synthetic data and the managers' own test guests** before any real guest data. Owners and dates for the legal gates are in the tracker in [`phase-3.md`](phase-3.md); this file adds the checks around them. Tick a line only when it was done on the real deployment.

## 1. Before switching the guest feature on

Run `npm run check:enablement -w apps/api` with the **production** environment loaded (`docs/deployment.md`). It reads the environment and the database, does a write/read/delete of a random test object in the bucket, and starts Chromium. Any `FAIL` blocks `GUEST_CHECKIN_ENABLED=true`. It cannot check the `MANUAL` lines it prints: confirm each one below.

- [ ] Check ran: no `FAIL`, warnings understood (`WARN` = accepted gap, for example no document worker)
- [ ] CNDP declaration filed, and the authorization received if one is required
- [ ] Hosting region and storage provider approved by counsel, including the US mail provider
- [ ] Mail sender domain verified (SPF, DKIM); a real reset e-mail received
- [ ] Bucket private, TLS only, versioning off or expiring inside the retention window
- [ ] `STORAGE_MASTER_KEYS` backed up apart from the data; the backup's location is known to two people
- [ ] Database backup restored once on a scratch instance
- [ ] Edge overwrites `X-Forwarded-For`: a forged header does not change the IP in the audit log
- [ ] Document worker unreachable from the internet
- [ ] Incident runbook written and read by everyone with production access
- [ ] Consent wording (FR, EN) approved by counsel and inserted with `approvedBy` and `approvedAt`
- [ ] Retention set by counsel and validated (`validatedBy` filled) in `RuleConfig`: `retention.id_images_days`, `retention.fiche_days`, `retention.police_register_days`. Until `retention.fiche_days` is validated the retention job keeps every Fiche PDF, and the check fails on it

## 2. On a real phone (headless Chromium cannot do these)

- [ ] iPhone Safari and Android Chrome: open a check-in link from WhatsApp, photograph a real passport, correct a field, submit
- [ ] "Open the Fiche" opens the PDF in the phone's own viewer (it is not downloaded), Arabic names are readable
- [ ] Print the Fiche from the viewer; compare with the official form once the prefecture provides it
- [ ] Owner/Manager sees the ID image and the Fiche; Staff see status only
- [ ] A link past its expiry and a revoked link show the same neutral page
- [ ] (Phase 4) Regenerate a register that was shared: the old link shows the neutral page and the screen says it was revoked
- [ ] (Phase 4) Open a Secure Share link on a phone in a private tab (iPhone Safari and Android Chrome): the notice shows, "Open in a new tab" opens the PDF in the phone's viewer, Arabic names are readable; after revocation the same link shows the neutral page

## 2b. Tax estimate (Phase 5, BETA)

- [ ] `npm run check:enablement` shows `tax.disclaimer` OK; `tax.rules` is a warning until the fiduciaire validates the rules
- [ ] Open a generated tax PDF on a phone and print it: the watermark and footer are on every page and readable
- [ ] Open the Excel export in Excel and in LibreOffice: banner at the top of each sheet, print preview shows the header and footer, amounts are numbers, nothing is calculated by a formula
- [ ] Compare one real month with the manager's own figures: note every difference for the fiduciaire (rates, threshold, what counts as gross)
- [ ] The Accountant account signs in, sees only "Estimations fiscales", opens a report, and cannot reach a property, a guest or the generate button
- [ ] Fiduciaire has confirmed or replaced each default in `RuleConfig` (`validatedBy` filled): the watermark disappears on regeneration

## 2c. Team, checklist and WhatsApp (Phase 6)

- [ ] `npm run check:enablement` shows the `msg.*`, `checklist.validated` and `retention.license-docs` lines as OK, or the warnings are understood (they never block the guest feature)
- [ ] Team: invite a real colleague on a phone; the e-mail arrives; accepting lands on the right screen; the seat bar moves; removing access ends their session at once
- [ ] Starter (1 seat) refuses a Staff invitation with the plain message, and accepts the accountant
- [ ] Checklist: counsel's list loaded with `npm run checklist:load` including `validatedBy` and `validatedAt`; the "not validated" notice is gone; a step ticked, a note and a deadline saved; a PDF and a photo attached and downloaded back; Staff see status only
- [ ] Licence-document retention set by counsel and validated (`retention.license_documents_days`), or the documents are kept and the reason is written down
- [ ] Meta: business verification done; templates approved; names entered in `whatsapp.templates`; `WHATSAPP_DRIVER=cloud` with its four secrets; webhook registered with the verify token; the edge passes the body through unchanged
- [ ] Send a check-in link to your own phone from Dari: it arrives, the status moves to delivered and read on the arrivals screen; then switch the provider token off and check that an alert falls back to e-mail
- [ ] Quiet hours: an early warning triggered at night waits (arrives by e-mail); a critical one reaches WhatsApp
- [ ] CNDP position on Meta as a recipient of check-in links and phone numbers written down

## 3. Accepted limits to re-check with real data

| Limit | Source | What to do in the pilot |
|---|---|---|
| The 90 / 110 / 120 night thresholds are placeholders | `phase-2.md` | Counsel confirms them; the UI and e-mails say "not validated" until then |
| Night counter never compared with real exports | `phase-2.md` | Compare with one real Airbnb and one real Booking.com export per property |
| Booking.com "CLOSED - Not available" is classified as uncertain | `phase-2.md` | Review list is used by the manager; note how often it appears |
| Sync every 2 hours (`ICAL_SYNC_INTERVAL_HOURS`) | `phase-2.md` | Ask whether it is fast enough |
| OCR accuracy on real photos is unmeasured | `phase-3.md` | Log the share of fields guests correct, by hand, over the first 20 check-ins |
| Real Moroccan CIN / CNIE cards may have no readable MRZ | `phase-3.md` | Test real cards with their owners' permission (never stored in the repository) |
| Whether a Moroccan national needs an entry stamp | `phase-3.md` | Ask the prefecture; all four fields are required for everyone today |
| WhatsApp sees the token when the manager taps "Send by WhatsApp" (`wa.me`) | `phase-3.md` | Only while WhatsApp is not ready in Dari; once the Business API is on, the link goes straight to Meta and the manual button is gone. Counsel knows the channel either way; keep expiries short |
| Structured guest fields (name, document number) are kept after the ID image is purged | `retention.int-spec.ts` | Ask counsel whether they follow the Fiche retention too |
