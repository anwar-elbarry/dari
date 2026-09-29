# Dari — Morocco STR Compliance & Tax Platform

SaaS for short-term-rental managers in Morocco (launch: Marrakech). Specs: Business MVP V3 (EN/AR) and Technical Spec V2 — read them before changing behaviour.

## Layout
- `apps/api` — NestJS + Prisma (PostgreSQL). Schema: `apps/api/prisma/schema.prisma`.
- `apps/web` — Next.js (SSR for public token pages `/checkin/*`, `/s/*`; SPA dashboard). FR/EN/AR with RTL.
- `services/ocr` — Python FastAPI worker for passport MRZ (ICAO) and CIN structured OCR. Self-hosted only.
- Infra for dev: `docker-compose.yml` (Postgres, Redis, MinIO). Copy `.env.example` to `.env`.
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
- `MailService.send()`; the console driver is dev-only (refused in production by env validation).
- Rate limiting: global default from env; stricter per-route limits with `@Throttle()`. Counters and the login lockout live in Redis when `REDIS_URL` is set (required in production), in memory otherwise.
- Jobs: BullMQ connection in `jobs/jobs.module.ts`; a feature module registers its queue with `BullModule.registerQueue({ name })` and adds its `@Processor` provider only when `config.REDIS_URL` is set (see `ical/ical.module.ts`). Payloads carry ids only. `SyncProcessor` fans out one job per feed every `ICAL_SYNC_INTERVAL_HOURS`; "sync now" runs inline.
- Sync rules (`ical/sync.service.ts`): upsert by (feed, UID); manual classifications are never overwritten; a future event missing from the feed is cancelled; past stays are frozen; a failing feed keeps its bookings and stores a sanitised error.

## Outbound fetches (apps/api/src/ical)
- Every user-supplied URL is fetched with `safeFetch()` only: https, host resolved and checked against `publicOnly` (no private, loopback, link-local, metadata, mapped or 6to4 addresses), connection pinned to the checked IP, redirects re-checked, 10 s / 2 MB caps. Never use `fetch`/`axios` on a user URL.
- `SafeFetchError` messages never contain the URL or host; they are safe to store and show.
- Calendar events: `parseIcs()` (dates in `Africa/Casablanca`), `classify()` (BOOKING / OWNER_BLOCK / UNCERTAIN per platform; Booking.com "CLOSED - Not available" is UNCERTAIN by design), `storableSummary()` (only Airbnb/Booking summaries are stored).

## Imports (apps/api/src/imports)
- CSV import: `parseImport()` is pure and tested (French/English headers, `;`/`,`/tab, `DD/MM/YYYY`, `1 234,50`). Preview saves nothing; commit is idempotent by confirmation code (or dates + platform) and skips rows with errors. Only mapped columns are read: guest names and emails in a file are never stored.
- Uploads: memory storage, 1 MB cap, one file. Anything written back to CSV goes through `csvCell()` (formula-injection safe).

## Auth, roles and tenancy (apps/api/src)
- Sessions: access JWT in `dari_at` (path `/api`, 15 min) + rotating refresh token in `dari_rt` (path `/api/auth`). Both httpOnly, SameSite=Lax. Only token hashes are stored.
- Every state-changing request needs the header `X-Requested-With: dari` (CSRF). The web client adds it.
- Guards run in order: rate limit → CSRF → session (`AuthGuard`, re-reads the user each request) → capabilities.
- **Every route must be `@Public()` or declare `@Requires('capability')` / `@AnyRole()`.** Undeclared routes are refused, and `rbac/route-declarations.spec.ts` fails.
- Capabilities per role live in `rbac/capabilities.ts`. To add a permission: add the capability, map it to roles, use `@Requires()`, add a row to `rbac/permission-matrix.int-spec.ts` (the test fails if a route has no row).
- **Tenant data goes through `prisma.forAccount(user.accountId)`**. It adds `accountId` to every query and refuses models without a rule (`prisma/account-scope.ts`). Foreign keys to other tenant rows (e.g. `ownerId`) must be loaded through the scoped client before use. Resources of another account return 404.
- Tests: `npm test` (unit, no DB) and `npm run test:int` (needs `DATABASE_URL` to a disposable DB whose name contains `test`; it truncates all tables; set `TEST_REDIS_URL` to a disposable Redis db, flushed on every reset, to run the Redis-backed paths). Helpers in `src/test/test-app.ts` (`createTestApp`, `seedAccount`, `client`).

## Web (apps/web)
- All API calls go through `lib/api.ts` (`api(method, path, body)`): same-origin `/api`, CSRF header, one refresh + retry on expiry.
- Text lives in `messages/fr.json` and `messages/en.json` (same keys in both; French is the default). No hard-coded UI strings.
- Hiding links or pages by capability (`useSession().can`, `<Require>`) is convenience only; the API is the enforcement point.
- Token pages strip `?token=` from the address bar on load; the site sends `Referrer-Policy: no-referrer`.
- Help text about tax or legal choices must stay neutral ("confirm with your accountant"), never state the law.
- In Claude web sessions, run Playwright with `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`.

## Conventions
- TypeScript strict. Pure business logic (day counter, tax pipeline) lives in plain functions with unit tests next to them (`*.spec.ts`).
- Small commits; one feature per branch/session.

## Phase workflow
- Roadmap: `README.md`. Detailed plan per phase: `docs/phase-N.md` (Phase 1 exists).
- **When a phase is finished** (its exit gate/definition of done is met): mark it done in the README roadmap table, then create `docs/phase-<N+1>.md` for the next phase and link it from that phase's section in the README. Use `docs/phase-1.md` as the template: goal, scope in/out, decisions to lock, data model changes, API surface, screens, permission matrix rows added, work breakdown (one short session per step), required tests, security checklist, definition of done, risks, open decisions for the founder.
- Base the new plan on the specs, the current code and the solo-plan adjustments in the README; carry over any leftovers from the finished phase.
