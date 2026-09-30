# Deployment requirements

Hosting provider and region are still open (see the legal track in the README): guest and owner personal data must be hosted where counsel approves. Whatever the provider, the points below are **requirements**, not suggestions.

## Topology

```
Internet ──HTTPS──> Edge proxy / load balancer ──> Next.js web (port 3000) ──/api──> NestJS API (port 3001) ──> PostgreSQL
```

- Only the edge is public. The API, database and object storage are on a private network.
- TLS terminates at the edge; HTTP → HTTPS redirect; HSTS enabled.

## Client IP (required for rate limits and the audit log)

The Next.js `/api` rewrite forwards the incoming `X-Forwarded-For` header **unchanged** (verified in Phase 1). If the edge does not overwrite it, any client can choose the IP the API sees and bypass per-IP rate limits, and the audit log records a fake IP.

- The edge proxy **must overwrite** `X-Forwarded-For` with the real client address (not append to it). nginx: `proxy_set_header X-Forwarded-For $remote_addr;`
- With edge → Next.js → API, keep `TRUST_PROXY=1` (the API trusts one hop: Next.js).
- If the edge routes `/api` straight to the API instead, `TRUST_PROXY=1` still applies (the edge is then the one hop).
- Check after each infrastructure change: send a request with a forged `X-Forwarded-For` and confirm the audit log shows your real IP.

The per-email login lockout does not depend on IP and stays effective either way.

## Domain and cookies

- Serve the app from a **dedicated host** (e.g. `app.<domain>`). With `COOKIE_SECURE` on (the production default) the session cookies are `__Host-dari_at` and `__Host-dari_rt`: Secure, host-only, `Path=/`, so a sibling subdomain cannot plant or overwrite them. The browser refuses them over plain HTTP, so production must be served over HTTPS end to end at the edge.
- Trade-off: `Path=/` means the refresh cookie is sent to every API route, not only `/api/auth`. Only the auth routes read it, and refresh tokens rotate with reuse detection. Development (plain HTTP) keeps `dari_at` / `dari_rt` with the narrow paths.
- Switching an existing deployment to `__Host-` logs everyone out once (the old cookies are ignored).
- Password-reset and invitation links carry the token in the URL fragment (`#token=`), which browsers never send to servers, so it stays out of proxy and access logs.

## API environment (production)

Validated at boot by `apps/api/src/config/env.ts`; the API refuses to start on an invalid value.

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` (forces secure cookies, refuses dev mail drivers and disabled rate limits) |
| `DATABASE_URL` | Managed Postgres, TLS, private network |
| `JWT_ACCESS_SECRET` | `openssl rand -base64 48`, from the secret store. Placeholders and values under 43 characters are refused in production |
| `APP_URL` | Public HTTPS URL of the web app (used in emailed links) |
| `TRUST_PROXY` | `1` (see above) |
| `REDIS_URL` | Managed Redis, private network, `rediss://` or password |
| `MAIL_DRIVER` | `resend`. `console` and `file` are refused in production. Resend is a US provider: reset, invitation and alert e-mails carry user addresses, so it belongs in the cross-border position with counsel |
| `MAIL_API_KEY` | Provider API key, from the secret store. Required with `resend`; never logged |
| `GUEST_CHECKIN_ENABLED` | Leave unset (off) until the legal gates in `docs/phase-3.md` are closed; `true` turns the guest check-in routes on and makes the storage settings below mandatory |
| `POLICE_REGISTER_ENABLED`, `SECURE_SHARE_ENABLED` | Leave unset (off) until the Phase 4 gates are closed. Each one, when `true`, makes the storage settings below mandatory, exactly as `GUEST_CHECKIN_ENABLED` does |
| `TAX_REPORTS_ENABLED` | Leave unset (off) until you accept shipping the tax estimate as a **BETA** (default rates not validated by a fiduciaire: every report and export is watermarked) or the fiduciaire has validated the rules. `true` makes the storage settings mandatory and needs the tax `RuleConfig` rows (migration `20260930120000`) including the disclaimer wording; `npm run check:enablement` reports both |
| `WHATSAPP_ENABLED`, `WHATSAPP_DRIVER`, `WHATSAPP_*` | Leave `WHATSAPP_ENABLED` unset (off) until Meta's verification is done, the message templates are approved and entered in `whatsapp.templates`, and counsel has a position on Meta receiving check-in links and guest phone numbers. Once on in production it requires `WHATSAPP_DRIVER=cloud` with `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN` (secret store). Register `https://<api host>/api/webhooks/whatsapp` in Meta's console with the verify token; the edge must pass the body through unchanged (the signature covers the exact bytes). It needs no storage settings; e-mail stays the fallback whatever its value |
| `OCR_SERVICE_URL`, `OCR_SHARED_SECRET` | The document worker (`services/ocr`) on the private network, and its shared secret (32+ characters, from the secret store). Optional: without them guests type their details. The worker must not be reachable from the internet |
| `STORAGE_DRIVER` | `s3` (required once the guest feature is on). `memory` is refused |
| `STORAGE_MASTER_KEYS` | `id:base64,...`, newest first (`echo "k1:$(openssl rand -base64 32)"`), from the secret store, **never** in the repository or the database. Backed up separately from the data: without a key its objects cannot be read |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | The private bucket. `S3_ENDPOINT` must be https (leave it unset for AWS). Credentials limited to that bucket: get, put, delete, no list of other buckets |
| `S3_SSE` | `true`: provider-side encryption on top of the application encryption |
| `MAIL_FROM` | A sender address verified with the provider (SPF and DKIM set up on the domain) |

## Logs

The API logs through `RedactingLogger` (emails, phone numbers, MRZ lines, document numbers and long tokens are replaced; values under keys such as `name`, `email`, `documentNumber` are masked) and never logs request bodies. In production an unexpected error is logged as its type, code and stack frames, without its message. Ship these logs only to a processor covered by the CNDP position; they are not a place for personal data even so.

## Object storage (ID scans, Fiche PDFs)

Required only when `GUEST_CHECKIN_ENABLED=true`; with the feature off in production nothing is stored. The API also needs an approved consent text in the database before the guest form will open (see `docs/phase-3.md`).

Every object is encrypted by the API (AES-256-GCM, one data key per object, wrapped by a master key) before it reaches the bucket, so the provider and any backup only hold ciphertext. Requirements for the bucket:

- **Private**: block all public access, no bucket policy or ACL granting anyone read, no public listing. The API never creates a presigned or public URL (a test scans the code for it); objects leave only through audited API routes.
- Server-side encryption enabled (`S3_SSE=true`) and TLS only.
- Reachable from the API on the private network only.
- Versioning **off**, or a lifecycle rule that expires old versions within the retention window: a deleted image must not survive as a previous version. (The application also blanks the wrapped key on deletion, so a surviving copy is unreadable, but do not rely on that alone.)
- Backups of the bucket are not needed for the images (they are purged after 30 days by default); if the Fiche PDFs are backed up, the backup is ciphertext and expires with them.
- Master key rotation: prepend a new key to `STORAGE_MASTER_KEYS` and deploy. The hourly `rewrap` job (Redis) moves every object's data key to the new master key, 2000 per run. When `SELECT count(*) FROM "StoredObject" WHERE "deletedAt" IS NULL AND "wrappedKey" <> '' AND "wrappedKey" NOT LIKE '<new id>:%'` returns 0, drop the old key. Losing every key that wraps an object makes that object permanently unreadable.
- Deleting an object first blanks its wrapped key in the database, then removes it from the bucket.

## Fiche de Police PDF (Chromium)

The API renders the Fiche with headless Chromium (`playwright-core`); the API host or image needs:

- A Chromium build (`npx playwright-core install --with-deps chromium`, or a distro package with `PDF_CHROMIUM_PATH` pointing at it).
- **An Arabic-capable font** (for example `fonts-noto-core`): without one, Arabic names print as empty boxes. `fiche.int-spec.ts` checks this.
- Preferably a non-root user with Chromium's sandbox. Containers that cannot provide one can set `PDF_NO_SANDBOX=true`; the renderer only loads our own escaped HTML with JavaScript off and every network request aborted (tested), so the exposure is small, but prefer the sandbox.
- Memory for one shared browser (at most two renders run at once). If Chromium is missing, guests can still check in: the Fiche is generated after submission, the manager sees "no Fiche yet" and `Regenerate` answers 503 `PDF_UNAVAILABLE` until it is fixed.

The layout is a working draft (`TEMPLATE_VERSION` in `checkin/fiche-template.ts`); it must be matched to the official form once the prefecture provides it, and the version bumped.

## Redis

`REDIS_URL` is required in production: rate-limit counters, the login lockout and the job queues live there, so several API instances share them. Use a managed Redis in the same region as Postgres, not publicly reachable, with a password or TLS (`rediss://`).

## Demo seed

`npm run db:seed` creates users with a known password. It refuses non-local databases unless `ALLOW_DEMO_SEED=true`; never set that on staging or production.

## Retention rules (`RuleConfig`)

| Key | Seeded value | Effect |
|---|---|---|
| `retention.id_images_days` | `{"days": 30}` | ID images deleted this many days after checkout |
| `retention.fiche_days` | `{"days": null}` | Fiche PDFs deleted this many days after checkout. **No period, or a period not validated, keeps every Fiche** |
| `retention.police_register_days` | `{"days": null}` | Same for the monthly register (applied once registers exist, Phase 4.2) |

Counsel sets the number and fills `validatedBy` and `validatedAt`; a number without `validatedBy` is never applied to Fiches or registers, because deleting is irreversible. Accepted range: 1 to 3650 days. The change applies to files already stored on the next hourly run.

## Before enabling the guest feature

`npm run check:enablement -w apps/api`, with the production environment loaded, checks the environment, consent texts, retention rows, a storage round trip and Chromium, and lists what only a person can confirm. The full list is in [`pilot-checklist.md`](pilot-checklist.md).

## Before real customer data

- Daily database backups with one tested restore.
- CNDP declaration filed (legal track).
- Written runbook for a personal-data incident.
