# Dari — Morocco STR Compliance & Tax Platform

SaaS for short-term-rental managers in Morocco (launch: Marrakech). Specs: Business MVP V3 (EN/AR) and Technical Spec V2 — read them before changing behaviour.

## Layout
- `apps/api` — NestJS + Prisma (PostgreSQL). Schema: `apps/api/prisma/schema.prisma`.
- `apps/web` — Next.js (SSR for public token pages `/checkin/*`, `/s/*`; SPA dashboard). FR/EN/AR with RTL.
- `services/ocr` — Python FastAPI worker for passport MRZ (ICAO) and CIN structured OCR. Self-hosted only.
- Infra for dev: `docker-compose.yml` (Postgres, Redis, MinIO). Copy `.env.example` to `.env`.

## Commands
- `npm install` (root, workspaces) · `npm run lint` · `npm run typecheck` · `npm test`
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

## Conventions
- TypeScript strict. Pure business logic (day counter, tax pipeline) lives in plain functions with unit tests next to them (`*.spec.ts`).
- Small commits; one feature per branch/session.
