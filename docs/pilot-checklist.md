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
| WhatsApp sees the token when the manager taps "Send by WhatsApp" (`wa.me`) | `phase-3.md` | Counsel knows the channel; keep expiries short; the Business API removes it in Phase 6 |
| Structured guest fields (name, document number) are kept after the ID image is purged | `retention.int-spec.ts` | Ask counsel whether they follow the Fiche retention too |
