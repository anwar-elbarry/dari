# Dari — Morocco STR Compliance & Tax Platform

SaaS for short-term-rental managers in Morocco (launch: Marrakech). Specs: Business MVP V3 (EN/AR) and Technical Spec V2 — read them before changing behaviour.

## Layout
- `apps/api` — NestJS + Prisma (PostgreSQL). Schema: `apps/api/prisma/schema.prisma`.
- `apps/web` — Next.js (SSR for public token pages `/checkin/*`, `/s/*`; SPA dashboard). FR/EN/AR with RTL.
- `services/ocr` — Python FastAPI worker for passport MRZ (ICAO) and CIN structured OCR. Self-hosted only.
- Infra for dev: `docker-compose.yml` (Postgres, Redis, an s3rver S3 server). Copy `.env.example` to `.env`.
- Deployment requirements (client IP, production env, single instance): `docs/deployment.md`.

## Commands
- `npm install` (root, workspaces) · `npm run lint` · `npm run typecheck` · `npm test` (unit) · `npm run test:int` (API + Postgres) · `npm run test:e2e` (Playwright, needs `npm run build` for api and web and `E2E_DATABASE_URL`)
- `npm run db:generate` / `db:validate` / `db:migrate` (API workspace)
- OCR: `cd services/ocr && pip install -r requirements.txt && pytest`

## Non-negotiable rules
1. **Tax and legal parameters are data, never code.** Rates, thresholds (120 000 MAD, 500 000 MAD…), Taxe de Séjour/TPT, marital-filter conditions live in `TaxRule` / `RuleConfig` and are validated by a fiduciaire/lawyer. Do not hard-code them.
2. Every tax output carries the "estimate only — confirm with your accountant" disclaimer. Never use wording like "certified", "guaranteed", or "DGSN-compliant" in UI/exports.
3. **ID scans and marriage certificates**: encrypted object storage, no public URLs, readable only by Owner/Manager via the API, every read written to `AuditLog`, purged by the retention job (default 30 days post-checkout).
4. **No ID image or extracted PII goes to an external/foreign service** (cloud OCR, LLM APIs, analytics) without a documented CNDP assessment.
5. OCR is assistive: extracted fields are always shown to the guest for review. Entry stamp number, city of origin, next destination and profession are enforced server-side.
6. RBAC is enforced at the API layer on every route: Owner/Manager, Staff (no financials, no ID files), Accountant (reports only, no guest data).
7. Share links: 256-bit random token, store only its hash, expiring, revocable, `no-store` + `noindex`.
8. The marital-certificate flow (Art. 490) stays disabled by default until lawyer + CNDP review.
9. Money: integer centimes in pure functions, `Decimal(12,2)` in the DB. Never floats.

## API foundations (apps/api/src)
- `config/env.ts`: every env variable is declared and validated there (zod). Add new variables there and in `.env.example`; never read `process.env` elsewhere. Inject with `@Inject(APP_CONFIG)`.
- `common/configure-app.ts`: the one HTTP pipeline (prefix `/api`, helmet, request id, validation, error filter). Used by `main.ts` and HTTP tests.
- Errors: always `{ error: { code, message, details? }, requestId }`. Throw Nest `HttpException`s; pass `{ code, message }` for a specific code. Unexpected errors become a generic 500.
- Validation: DTOs with class-validator; unknown fields are rejected. Values are never echoed back in errors.
- `AuditService.record()` for sensitive actions; add new actions to the `AuditAction` union. Identifiers only, never secrets or guest data.
- `MailService.send()`; drivers `console`/`file` are dev-only (refused in production by env validation); `resend` (production) needs `MAIL_API_KEY`. Driver errors carry the HTTP status only, never the recipient or body.
- **Logs carry ids only.** The app logger is `RedactingLogger` (`common/redacting-logger.ts`, patterns and key masks in `common/redact.ts`); it is a backstop, not permission to log data. Never log request bodies, guest objects, document numbers, names or emails. Unexpected errors are logged by type, code and stack frames, not message. `common/logging.spec.ts` submits fake PII and greps the output; extend it for every new route that takes personal data.
- Rate limiting: global default from env; stricter per-route limits with `@Throttle()`. Counters and the login lockout live in Redis when `REDIS_URL` is set (required in production), in memory otherwise.
- Jobs: BullMQ connection in `jobs/jobs.module.ts`; a feature module registers its queue with `BullModule.registerQueue({ name })` and adds its `@Processor` provider only when `config.REDIS_URL` is set (see `ical/ical.module.ts`). Payloads carry ids only. `SyncProcessor` fans out one job per feed every `ICAL_SYNC_INTERVAL_HOURS`; "sync now" runs inline.
- Sync rules (`ical/sync.service.ts`): upsert by (feed, UID); manual classifications are never overwritten; a future event missing from the feed is cancelled; past stays are frozen; a failing feed keeps its bookings and stores a sanitised error.

## Outbound fetches (apps/api/src/ical)
- Every user-supplied URL is fetched with `safeFetch()` only: https, host resolved and checked against `publicOnly` (no private, loopback, link-local, metadata, mapped or 6to4 addresses), connection pinned to the checked IP, redirects re-checked, 10 s / 2 MB caps. Never use `fetch`/`axios` on a user URL.
- `SafeFetchError` messages never contain the URL or host; they are safe to store and show.
- Calendar events: `parseIcs()` (dates in `Africa/Casablanca`), `classify()` (BOOKING / OWNER_BLOCK / UNCERTAIN per platform; Booking.com "CLOSED - Not available" is UNCERTAIN by design), `storableSummary()` (only Airbnb/Booking summaries are stored).

## Storage (apps/api/src/storage)
- ID scans and Fiche PDFs go through `StorageService` only, never an S3 client directly. `put()` encrypts with a per-object data key (AES-256-GCM, `envelope.ts`) before anything reaches the store; the master keys (`STORAGE_MASTER_KEYS`) wrap the data keys and live in the secret store. The `StoredObject` row holds the wrapped key, kind, size, sha256, `expiresAt`, `deletedAt`.
- `read()` and `delete()` **require** a `StorageAudit` (actor, action, business record id); a read returns bytes only after its audit row is written. Serve bytes from an API route with `Cache-Control: no-store` and the right capability; never return a URL (no presigning anywhere; `storage/object-store.spec.ts` scans for it).
- Object keys are random (`<accountId>/<kind>/<uuid>`), never derived from names or document numbers. Errors from the store and from decryption are fixed messages.
- Deleting shreds the wrapped key first, then removes the object: an object without its wrapped key is unreadable even if a copy survives. Rotation: `rewrapOutdatedKeys()`.
- Tests: `envelope.spec.ts`, `storage.int-spec.ts`, and `object-store.spec.ts` (runs the contract on real S3/MinIO when `TEST_S3_ENDPOINT` is set; CI starts an s3rver S3 server).

## Guest check-in (apps/api/src/checkin, Phase 3)
- Data: `CheckInLink` (token hash only, expiry, revocable, `maxGuests`) → one `GuestCheckIn` per adult guest (PENDING draft → SUBMITTED → VERIFIED) → `FicheDePolice`. Images and PDFs are `StoredObject`s referenced by id. All keys between these tables are composite with `accountId`; the guest's property is tied to its booking's property in the database.
- Feature flag `GUEST_CHECKIN_ENABLED` (off by default in production). Every guest controller uses `@UseGuards(CheckInEnabledGuard)`, which answers 404 when off. Never branch on the flag anywhere else.
- Consent: `ConsentService.current(locale)` serves only counsel-approved rows; no approved row means the flow refuses to start. A submission stores `consentTextId` and `consentAt`. Do not write consent text from the app or hard-code it.
- Capabilities: `checkin:manage` (Owner/Manager, Staff), `guest:read_meta` (both; status only for Staff), `id:read` and `police:read` (Owner/Manager only). Staff never receive guest fields or files.
- Link URL: `${APP_URL}/checkin#token=<token>`. The token is in the **fragment** (never sent to a server, out of logs and out of WhatsApp link previews) and travels to the API in the `X-Checkin-Token` header. Never put it in a path or query. Public routes: `@Public()` + `@UseGuards(CheckInEnabledGuard)` + `@NoStore()`; unknown, expired, revoked, full and cancelled links all answer the same 404 `LINK_UNAVAILABLE`.
- Public flow: first photo creates a `PENDING` draft (`draftId`); `submit` moves it to `SUBMITTED` in one transaction that also claims a place on the link (`guestsSubmitted < maxGuests`), so parallel submits cannot exceed the party. Uploads are sanitised by `image-sanitizer.ts` (magic bytes, pixel cap, re-encode to JPEG, all metadata dropped) before storage or OCR. OCR output (`ocr.client.ts`) is untrusted input and only ever a suggestion; the server keeps field-level hashes (never values) to record which fields the guest edited.
- Fiche PDF (`fiche-template.ts`, `pdf-renderer.ts`, `fiche.service.ts`): the template is pure, versioned (`TEMPLATE_VERSION`) and escapes every value; wording must never claim compliance or certification (a test greps for it). Chromium runs with JavaScript off and the network aborted. The PDF is a `FICHE_PDF` StoredObject; reads are audited (`guest.fiche.read`). Generated in the background after submit and on `POST /guests/:id/fiche/regenerate`. Tests that need a browser skip when none is installed, unless `REQUIRE_CHROMIUM=1` (CI).
- Retention (`src/retention`): hourly BullMQ job (`RetentionService.purge(now)`, `now` injectable for time-shifted tests) deletes abandoned drafts (24 h), expired StoredObjects, ID images past the current `retention.id_images_days`, and finishes half-done deletions; every deletion is audited as `retention.purged`; any failure fails the job and alerts (`OPS_ALERT_EMAIL`). It runs whatever `GUEST_CHECKIN_ENABLED` says. Never store guest data anywhere the job cannot reach.
- Guest audit rows carry no IP (a guest is not our customer and the audit trail has no retention). Photos live one day while a form is a draft and follow `retention.id_images_days` once submitted. Storage master-key rotation is finished by the hourly `rewrap` job. `/api` responses are `no-store` (middleware, before the guards). The manager's WhatsApp button sends the link text, token included, to `wa.me`: known and documented in `docs/phase-3.md`.
- Guest routes for the team: `arrivals` (Staff: no names), `GET/PATCH /guests/:id`, `GET /guests/:id/document` (decrypt, audit first, `no-store`). Drafts are invisible to the team.
- Retention length and link grace period are `RuleConfig` rows (`retention.id_images_days`, `checkin.link_grace_hours`), read through `RulesService.idRetention()` / `checkinGrace()`. Do not hard-code 30 or 48.

## Police register and Secure Share (Phase 4, data model in place; see docs/phase-4.md)
- Flags `POLICE_REGISTER_ENABLED` and `SECURE_SHARE_ENABLED` (own guards in `register/` and `share/`, 404 when off, off by default in production). Never branch on them elsewhere.
- Capabilities `register:read`, `share:manage`: Owner/Manager only. Share lifetime bounds are `RuleConfig` rows `share.min_hours` / `share.max_hours`, read through `RulesService.shareLifetime()`; do not hard-code 24 or 72.
- `ShareAccess` stores time and a trimmed user agent only, never an IP or a token. `ShareLink.resourceId` is polymorphic (no foreign key): the service must check it against the account.
- Register (`src/register`): a stay is listed under its month of **arrival**; only confirmed `BOOKING` stays. `buildRegister()` is pure (rows, problems by id, summary counts, digest); the digest in `PoliceRegister.inputDigest` is how a register is known to be `outdated`. Validation output carries ids and field names, never values. The template is versioned (`REGISTER_TEMPLATE_VERSION`), escapes everything and never claims compliance (a test greps for it). PDF reads audit `register.read` first (fail closed). Routes are in the permission matrix and the tenant-isolation suite.
- Secure Share (`src/share`): a link points at the Fiche or register record (not one PDF), is created through the scoped client, refused for an outdated register, returns its token once (`/s#token=`, header `X-Share-Token`). The public `GET /share` answers every failure with the same 404 `LINK_UNAVAILABLE`, audits `share.accessed` before decrypting out, re-checks the link in the transaction that records the `ShareAccess`, and caps views per link (`WindowCounter`). The retention purge revokes links to purged files.
- Fiche and register retention: `retention.fiche_days`, `retention.police_register_days`; a period counts only once counsel has validated it (`RecordRetentionRule.enforceable`). `npm run check:enablement -w apps/api` before enabling anything in production.

## Alerts (apps/api/src/alerts)
- Threshold alerts are `Notification` rows of type `day_counter.amber|red`, unique per (account, type, property, year), so evaluation is idempotent. Thresholds come from `RuleConfig` via `RulesService`; the email says when they are not yet validated.
- Anything that can change the nights of a property calls `PropertyEvents.nightsChanged(accountId, propertyId)` (sync, import, reclassification); `AlertsService` listens. Do the same for new sources of stays. An hourly job re-checks everything (Redis only).
- `GET /dashboard` is the one endpoint the home screen needs; Staff get counters but no tax regime or feed status.

## Imports (apps/api/src/imports)
- CSV import: `parseImport()` is pure and tested (French/English headers, `;`/`,`/tab, `DD/MM/YYYY`, `1 234,50`). Preview saves nothing; commit is idempotent by confirmation code (or dates + platform) and skips rows with errors. Only mapped columns are read: guest names and emails in a file are never stored.
- Uploads: memory storage, 1 MB cap, one file. Anything written back to CSV goes through `csvCell()` (formula-injection safe).

## Auth, roles and tenancy (apps/api/src)
- Sessions: access JWT (15 min) + rotating refresh token, both httpOnly, SameSite=Lax; only token hashes are stored. Names and paths come from `cookieScheme()` in `auth/cookies.ts`: `__Host-dari_at` / `__Host-dari_rt` (Path=/) when `COOKIE_SECURE`, else `dari_at` (`/api`) / `dari_rt` (`/api/auth`) for plain-HTTP development. Never hard-code the names.
- Every state-changing request needs the header `X-Requested-With: dari` (CSRF). The web client adds it.
- Guards run in order: rate limit → CSRF → session (`AuthGuard`, re-reads the user each request) → capabilities.
- **Every route must be `@Public()` or declare `@Requires('capability')` / `@AnyRole()`.** Undeclared routes are refused, and `rbac/route-declarations.spec.ts` fails.
- Capabilities per role live in `rbac/capabilities.ts`. To add a permission: add the capability, map it to roles, use `@Requires()`, add a row to `rbac/permission-matrix.int-spec.ts` (the test fails if a route has no row).
- **Tenant data goes through `prisma.forAccount(user.accountId)`**. It adds `accountId` to every query and refuses models without a rule (`prisma/account-scope.ts`). Foreign keys to other tenant rows (e.g. `ownerId`) must be loaded through the scoped client before use. Resources of another account return 404. Behind that, tenant tables use **composite foreign keys** `(xId, accountId) → (id, accountId)` (`@@unique([id, accountId])` on the target), so the database refuses a cross-account reference even if a service forgets the check. Do the same for every new tenant table (`prisma/tenant-fk.int-spec.ts`).
- Tests: `npm test` (unit, no DB) and `npm run test:int` (needs `DATABASE_URL` to a disposable DB whose name contains `test`; it truncates all tables; set `TEST_REDIS_URL` to a disposable Redis db, flushed on every reset, to run the Redis-backed paths). Helpers in `src/test/test-app.ts` (`createTestApp`, `seedAccount`, `client`).

## Web (apps/web)
- **Design system: RiadTax** (Claude design-system artifact "RiadTax", https://claude.ai/artifact/4W2bALa7jFPCsDx4EhTmyL). Tokens are snapshotted in `apps/web/design/tokens.json` and turned into `styles/tokens.css` by `npm run tokens -w apps/web`; Tailwind utilities (`bg-mist`, `text-ink`, `rounded-pill`, `font-display`…) map to them in `app/globals.css`. Shared components are in `components/ui.tsx` and `components/logo.tsx`. Do not use raw Tailwind palette colours (`stone-*`, `red-*`); do not hard-code hex values. Lime (`primary`) is a fill only, always with `on-primary` text. Statuses use `StatusPill` (dot + word). Pill buttons, 44px controls, sentence case, no emoji. Read the artifact README before adding a new kind of screen.
- All API calls go through `lib/api.ts` (`api(method, path, body)`): same-origin `/api`, CSRF header, one refresh + retry on expiry.
- Text lives in `messages/fr.json` and `messages/en.json` (same keys in both; French is the default). No hard-coded UI strings.
- Check-in screens (`components/checkin`): `/properties/[id]/arrivals` (link dialog shows the token once, held only in component state; guest dialog for Owner/Manager with the ID image and Fiche fetched through `apiBlob` as object URLs that are revoked on close). Staff see status only. Use the shared `Dialog` (native `<dialog>`) for modals. The e2e (`e2e/phase3.spec.ts`) uses the demo account from `npm run db:seed`.
- Guest form (`components/guest/checkin-flow.tsx`, route `/checkin`, layout `app/(guest)`): reads the token from the URL fragment, removes it from the address bar and keeps it only in `sessionStorage`; all calls go through `lib/guest-api.ts` (token in `X-Checkin-Token`, no cookies). The photo is decoded, orientation-fixed and resized to ≤ 2000 px JPEG in the browser (`lib/guest-image.ts`); OCR suggestions prefill fields but everything stays editable and OCR-flagged fields are marked "Check". Client validation (`lib/guest-validation.ts`) mirrors the API DTO; keep them in step. The consent text (fetched in the guest's language) sits directly above the send button. Guest strings live under `guest.*` in both message files.
- Register and Secure Share screens: `/properties/[id]/registers` (`components/register`) and `/shares` (`components/share`). The share dialog reads the allowed durations from `GET /shares/lifetime` and shows the token once, held only in component state. Owner/Manager see counts and buttons, Staff the status only; the API is the enforcement point.
- Screens: `/dashboard` (home; counters, alerts), `/properties/[id]` (counter, review list, calendars, stays), `/properties/[id]/import` (CSV flow). Night counters use `NightGauge`; thresholds and the cap always come from the API, never from a component.
- File uploads go through `api('POST', path, FormData)`; do not set `Content-Type` yourself.
- Hiding links or pages by capability (`useSession().can`, `<Require>`) is convenience only; the API is the enforcement point.
- Token pages strip `?token=` from the address bar on load; the site sends `Referrer-Policy: no-referrer`.
- Help text about tax or legal choices must stay neutral ("confirm with your accountant"), never state the law.
- In Claude web sessions, run Playwright with `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`.

## Conventions
- TypeScript strict. Pure business logic (day counter, tax pipeline) lives in plain functions with unit tests next to them (`*.spec.ts`).
- Small commits; one feature per branch/session.

## Phase workflow
- Roadmap: `README.md`. Detailed plan per phase: `docs/phase-N.md` (1 and 2 done, 3 drafted).
- **When a phase is finished** (its exit gate/definition of done is met): mark it done in the README roadmap table, then create `docs/phase-<N+1>.md` for the next phase and link it from that phase's section in the README. Use `docs/phase-1.md` as the template: goal, scope in/out, decisions to lock, data model changes, API surface, screens, permission matrix rows added, work breakdown (one short session per step), required tests, security checklist, definition of done, risks, open decisions for the founder.
- Base the new plan on the specs, the current code and the solo-plan adjustments in the README; carry over any leftovers from the finished phase.
