# Operations runbook

Phase 7.5. Two parts: recovery (backups, restore, key rotation) and the incident procedure for a personal-data leak. It states what the code does today; anything about legal deadlines or duties is for counsel and is marked as such. **Fill in the names in section 0 before the pilot, then read the whole file aloud once with the second person** (security checklist, Phase 7).

## 0. People (to fill in)

| Role | Name | Phone | Backup |
|---|---|---|---|
| Incident lead (decides, keeps the log) | | | |
| Second person with production access | | | |
| Counsel (CNDP, customers' notices) | | | |
| Where the master keys backup is kept, and who can open it | | | |

No shared accounts: every production action is by a named person.

## 1. Backups and restore

### What is backed up
| Item | How | Kept where |
|---|---|---|
| PostgreSQL | Daily encrypted backup from the managed provider, plus a manual `pg_dump --format=custom` before every migration | Provider, region approved by counsel (gate G1) |
| Object storage (ID images, Fiches, registers, licence documents) | Ciphertext only: each object is encrypted by the API before upload, so the provider and any bucket backup hold nothing readable. ID images are purged after the retention window and need no long backup | Bucket |
| `STORAGE_MASTER_KEYS` | From the secret store, copied to a **separate** encrypted backup that two people can open. **Without a key, the objects it wraps are unreadable for ever.** Never in the repository, the database or the bucket | Section 0 |
| Other secrets (`JWT_ACCESS_SECRET`, `MAIL_API_KEY`, `OCR_SHARED_SECRET`, WhatsApp secrets) | Secret store; regenerable, so no backup copy is needed | Secret store |

### Restore drill (do it once before the pilot, then after every schema change that touches storage)
The automated version is `apps/api/src/storage/restore-drill.int-spec.ts` (dump, restore on a scratch database, decrypt every kind of object with the backed-up keys, fail with other keys). It proves the mechanism; the drill below proves your actual backup and keys.

1. On a scratch instance (never production), restore the latest backup: `pg_restore --no-owner --dbname <scratch url> <backup>`.
2. Point a staging API at the scratch database and at the same bucket, with the **backed-up** `STORAGE_MASTER_KEYS` (fetched from the separate backup, not from production).
3. `npx prisma migrate status` must report the database up to date (nothing to apply).
4. Boot the API; `npm run check:enablement` must show no `FAIL` about storage.
5. As a test manager on the restored data, open one ID image (if any remain within retention), one Fiche, one register and one licence document. Each must open.
6. Write down the date, who did it, the backup used, and the time it took. That time is your real recovery time.

### Key rotation drill
1. Prepend a new key: `STORAGE_MASTER_KEYS="k2:<new>,k1:<old>"` (newest first), deploy.
2. The hourly `rewrap` job moves 2000 objects per run. Progress: `SELECT count(*) FROM "StoredObject" WHERE "deletedAt" IS NULL AND "wrappedKey" <> '' AND "wrappedKey" NOT LIKE 'k2:%';`
3. At 0, open one object of each kind, then drop `k1` from the secret store **and** keep it in the separate backup for as long as any database backup that predates the rotation is kept (an old backup still needs it).
4. Covered by tests: `storage.int-spec.ts` "master key rotation".

### Losing a key
If a master key is lost and objects still depend on it, those objects cannot be recovered. Restore the key from the separate backup first. If it is truly gone: the structured guest records stay in the database (only images and PDFs are lost); Fiches and registers can be regenerated from them; ID images are gone and guests must re-send them if still needed. Tell counsel.

## 2. Personal-data incident

A leak is any of: a token, ID image, Fiche, register or guest field seen by someone who should not have it; a lost or stolen device with a session; a key, secret or backup exposed; a bucket or database opened to the public; a suspicious audit trail.

### First hour: contain (do these before investigating)
Order = fastest to slowest, and least to most disruptive. Note the time of each action in the incident log.

1. **Freeze the evidence you will need.** Copy the relevant `AuditLog` rows and the API logs of the window. Do not delete or edit anything.
2. **Revoke exposed links.**
   - Secure Share: `DELETE /api/shares/:id` (manager screen: "Revoke"), effective on the next request. To revoke everything at once: `UPDATE "ShareLink" SET "revokedAt" = now() WHERE "revokedAt" IS NULL;` (run by two people).
   - Check-in links: `DELETE /api/checkin-links/:id`, or the same `UPDATE` on `"CheckInLink"`.
3. **Switch the feature off.** Unset or set to `false` the flag (`SECURE_SHARE_ENABLED`, `POLICE_REGISTER_ENABLED`, `GUEST_CHECKIN_ENABLED`, `WHATSAPP_ENABLED`, `TAX_REPORTS_ENABLED`) and restart. The routes then answer 404. The retention job keeps running whatever the flag says, which is what you want.
4. **End sessions** if an account or device is involved: `UPDATE "RefreshToken" SET "revokedAt" = now() WHERE "userId" = '<id>' AND "revokedAt" IS NULL;` (a password reset, a logout and refresh-token reuse also set `"User"."sessionsRevokedAt"`, which cuts off access tokens issued before it; to do it by hand: `UPDATE "User" SET "sessionsRevokedAt" = now() WHERE id = '<id>';`), then disable the user (team screen) and reset their password.
5. **Rotate the secret that leaked.** `JWT_ACCESS_SECRET` (signs out everybody), `MAIL_API_KEY`, `OCR_SHARED_SECRET`, the S3 credentials, the WhatsApp token. A leaked **master key**: add a new one (section 1), let the rewrap finish, retire the old one; this does not help for copies of the ciphertext already taken together with the old key, so treat those objects as exposed.
6. **Bucket or database exposed publicly:** close access first, then check the provider's access logs for reads.

### Then: scope (what was seen, whose, when)
- `AuditLog` answers "who read which record": `guest.document.read`, `guest.fiche.read`, `register.read`, `share.accessed`, `share.created`, `share.revoked`, `retention.purged`. Rows carry identifiers, never names; join to the guest or property to find people.
- Share access rows (`ShareAccess`) give time and a trimmed user agent, no IP (decision of Phase 4).
- Logs carry ids only; if a log line ever contains personal data, that is a second incident: fix the redaction and purge the log store.
- List the affected accounts, the kinds of data (ID images, names, document numbers, phone numbers, tax figures) and the number of people.

### Decide and tell (counsel decides; the code does not)
Whether and when the CNDP and the people concerned must be told, and what the customer (the conciergerie is the data controller for its guests) must be told, is a legal question. **Call counsel in the first hour, with the scope above as it stands.** This document deliberately states no deadline: counsel gives it. Prepare, in this order: what happened, what data, how many people, what was done, what customers should do. Send nothing external before counsel has read it.

### After
- Root cause, fix with a regression test, and the finding written into `docs/phase-7.md` with a severity (scale in that file).
- Restore anything revoked that should be back; tell customers when a feature is switched back on.
- Review this file: what was missing?

## 3. Other bad days

| Situation | First actions |
|---|---|
| Retention alert e-mail ("retention job needs attention") | Check the API logs for "Retention", the object store reachability and Redis. The job retries hourly; overdue data means a personal-data retention breach in progress: fix within the day |
| Redis down | Rate limits, the login lockout and the jobs (retention, sync) fall back to memory or stop. Production requires Redis; restore it, then confirm the retention job ran. See the Redis notes in `docs/deployment.md` |
| Chromium missing or crashing | Guests can still check in; Fiches and registers answer 503 `PDF_UNAVAILABLE` until fixed |
| Bad deploy | Roll back the image; migrations are forward-only, so restore only if a migration corrupted data (section 1) |
| Database lost | Section 1 restore, then run `check:enablement` before turning any flag back on |
