# Phase 1 — Identity, accounts and properties

Part of the [roadmap](../README.md). Built solo with Claude: each numbered step below is one short, single-feature session.

**Goal:** a property manager signs up, logs in, adds an owner and a property through the onboarding wizard, and can invite a Staff or Accountant user. Every route is protected by role and isolated by account.

**Why it matters:** RBAC and tenant isolation protect guest ID data in Phase 3. If a Staff user or another account can read something they should not, that is a CNDP incident. This phase is small in features and large in consequences, so the tests matter more than the screens.

---

## Scope

### In
- Signup (creates Account + first Owner/Manager), login, logout, token refresh, password reset, "me"
- Invitations: create, accept (Staff and Accountant), revoke
- Role-based access control for the 3 roles, enforced on the API
- Account isolation on every query
- PropertyOwner and Property CRUD
- Web: app shell, login / signup / reset screens, add-property wizard (steps 1–3), property list
- FR and EN interface (Arabic/RTL comes after the pilot)
- Audit log service, used from now on by every phase
- Auth rate limiting, secure cookies, mail module (console driver in dev)
- CI and the first Prisma migration (carried over from Phase 0)

### Out (later phases)
- Team management UI, role changes, seat-limit enforcement → Phase 6
- iCal link and historical import (wizard step is skipped) → Phase 2
- Dashboard, day counter, alerts → Phase 2
- Billing and plan upgrades → Phase 8 (manual invoicing first)
- Phone login, social login, 2FA, email verification → after pilot (see open decisions)

---

## Decisions to lock before coding

| Topic | Recommendation | Reason |
|---|---|---|
| Session model | Short-lived access JWT (15 min) + rotating refresh token, both in `httpOnly`, `Secure`, `SameSite=Lax` cookies. Refresh tokens stored as hashes in the DB | No tokens in JS-readable storage; refresh can be revoked |
| Same-origin API | Next.js proxies `/api/*` to the NestJS API | No CORS, simpler cookies; add a custom-header check on state-changing requests as CSRF defence |
| Password hashing | `argon2` (argon2id); minimum 10 characters | Current best practice |
| Login identifier | **Email only** in Phase 1; `phone` stays an optional profile field | The spec says email/phone; phone login needs SMS/WhatsApp OTP, which is not worth the cost yet |
| Multi-tenancy | Single database, `accountId` on every tenant table; all queries go through an account-scoped helper | Simplest; cross-tenant access is covered by tests |
| Roles | `OWNER_MANAGER`, `STAFF`, `ACCOUNTANT` as in the schema. A user has exactly one role in one account | Matches the spec |
| Permissions | A code-level capability map, checked by a guard and by a decorator such as `@Requires('property:write')` | The permission matrix in Tech Spec §7 becomes a test table |
| Mail | Provider-agnostic `MailService`; console driver in dev; Resend or Brevo in prod (choose one) | Needed for reset and invitations |
| Hosting region | Decide now with counsel (Morocco vs EU) | Every table created here will contain personal data |
| Object storage | Not needed until Phase 3 | Keep Phase 1 lean |

---

## Data model changes

The schema already has Account, User, PropertyOwner, Property and AuditLog. Add:

| Model | Fields | Purpose |
|---|---|---|
| `RefreshToken` | `id`, `userId`, `tokenHash` (unique), `expiresAt`, `revokedAt`, `replacedById`, `userAgent`, `ip`, `createdAt` | Rotating sessions; reuse of a revoked token revokes the whole chain |
| `PasswordResetToken` | `id`, `userId`, `tokenHash` (unique), `expiresAt`, `usedAt` | Single-use reset links, 1 hour |
| `Invitation` | `id`, `accountId`, `email`, `role`, `tokenHash` (unique), `invitedBy`, `expiresAt`, `acceptedAt`, `revokedAt` | Staff and Accountant onboarding; 7-day expiry |

Also:
- `User`: add `lastLoginAt`, `disabledAt`; keep `email` unique (lower-cased on write).
- `Property`: give `licenseType` a default only in the API layer, not the DB, so an omitted value is a validation error rather than a silent guess.
- Add `@@index` on foreign keys used by list endpoints.
- Create the first migration and a seed (one demo account, one user per role, one owner, two properties).

---

## API surface

All routes under `/api`. "Any" means any authenticated role of the same account.

| Route | Method | Roles | Notes |
|---|---|---|---|
| `/auth/signup` | POST | public | Creates Account + Owner/Manager; rate limited |
| `/auth/login` | POST | public | Rate limited by IP and by email; generic error message |
| `/auth/refresh` | POST | cookie | Rotates the refresh token |
| `/auth/logout` | POST | any | Revokes the refresh token |
| `/auth/forgot-password` | POST | public | Always returns 204 (no account enumeration) |
| `/auth/reset-password` | POST | public | Single use; revokes all refresh tokens of the user |
| `/me` | GET | any | User, role, account, capabilities |
| `/invitations` | POST / GET | Owner/Manager | Create and list |
| `/invitations/:id` | DELETE | Owner/Manager | Revoke |
| `/invitations/accept` | POST | public (token) | Sets name and password, creates the User |
| `/property-owners` | GET / POST | Owner/Manager | |
| `/property-owners/:id` | GET / PATCH | Owner/Manager | Accountant reads later, via reports only |
| `/properties` | GET | Owner/Manager, Staff | Staff get a reduced projection (no owner or tax data) |
| `/properties` | POST | Owner/Manager | |
| `/properties/:id` | GET / PATCH | Owner/Manager (full), Staff (reduced, read-only) | |

Rules for every route:
- Validate input with DTOs (`class-validator`), reject unknown fields.
- Resolve the account from the authenticated user, never from the request body or URL.
- Return 404, not 403, for resources in another account.
- Write an `AuditLog` row for: signup, login success and failure, logout, password reset, invitation created / accepted / revoked, owner and property created / updated.

---

## Screens

| # | Screen | Notes |
|---|---|---|
| 1 | Login | Email + password, reset link, one action per screen |
| 2 | Sign up | Company name, name, email, password. Creates the first Owner/Manager |
| – | Forgot / reset password | Two short forms |
| – | Accept invitation | Name + password, role shown read-only |
| 3 | Add Property wizard (3 steps) | Step 1: name, address, commune. Step 2: license status, license type, tax regime, Taxe de Séjour mode. Step 3: choose or create an owner (residency, bank-account type). Helper text on every toggle. iCal step shown as "Add later" |
| – | Property list | Cards with license badge; Staff see the reduced view |
| – | App shell | Top bar with user menu, sidebar filtered by role, FR / EN switch |

UI stack: Tailwind + shadcn/ui, `next-intl` for FR / EN, `react-hook-form` + `zod` for forms. Mobile-first, since managers use phones.

---

## Permission matrix (becomes the test table)

Phase 1 enforces the subset that exists so far; later phases add rows.

| Capability | Owner/Manager | Staff | Accountant |
|---|---|---|---|
| Manage properties and owners | Yes | No | No |
| View properties | Full | Reduced (no owner / tax data) | No |
| Invite and revoke users | Yes | No | No |
| View audit log | Yes | No | No |
| Revenue, margins, tax reports | Yes | No | Reports only (Phase 5) |
| ID scans and marriage certificates | Yes (Phase 3) | No | No |

---

## Work breakdown

Suggested order. Each step ends with green lint, typecheck and tests, and a commit.

| Step | Work | Model |
|---|---|---|
| 1.0 ✅ | **CI** (GitHub Actions: lint, typecheck, tests, `prisma validate`, Postgres service container). First migration and seed | fast |
| 1.1 ✅ | Foundations in the API: config module with validated env, Prisma module, `MailService`, `AuditService`, global validation pipe, error format, throttler | fast |
| 1.2 ✅ | **Auth backend**: signup, login, refresh rotation with reuse detection, logout, reset, `/me`. Argon2, cookies, rate limits | strong |
| 1.3 ✅ | **RBAC and tenant isolation**: capability map, guard, decorator, account-scoped Prisma helper. Permission-matrix test table and cross-tenant tests | strong |
| 1.4 | Invitations API (create, list, revoke, accept) | fast |
| 1.5 | Property and PropertyOwner API with reduced projection for Staff | fast |
| 1.6 | Web: shell, i18n (FR / EN), `/api` proxy, login, signup, reset, accept-invitation screens | fast |
| 1.7 | Web: add-property wizard, property list, role-aware navigation | fast |
| 1.8 | Hardening pass: `/security-review`, end-to-end happy path, README and `CLAUDE.md` updates | strong |

Rough effort solo: 2–3 weeks full-time. Steps 1.2 and 1.3 carry the risk; do not rush them.

---

## Tests required

- **Permission matrix:** table-driven test that calls every route as each role (and unauthenticated) and asserts the expected status.
- **Tenant isolation:** user of account A gets 404 on every read, update and delete of account B's resources, on every route with an id.
- **Auth:** wrong password and unknown email return the same response; refresh rotation; reuse of a revoked refresh token revokes the chain; reset token is single-use and expires; logout invalidates the session; login is rate limited.
- **Invitations:** expired, revoked and reused tokens are rejected; the role comes from the invitation, never from the request body; an email already in use is refused.
- **Validation:** unknown fields rejected; enum values checked; email lower-cased.
- **Audit:** each listed action writes exactly one audit row, with no password or token values in it.
- End-to-end (Playwright, mobile viewport): signup → add owner → add property → invite staff → staff logs in and sees the reduced view.

API integration tests need Postgres. They run in CI with a service container; in a Claude web session, install Postgres locally or run the same suite through CI.

---

## Security checklist for this phase

- [ ] Cookies `httpOnly`, `Secure`, `SameSite=Lax`; CSRF header required on POST / PATCH / DELETE
- [ ] Tokens (refresh, reset, invitation) are 256-bit random; only hashes stored
- [ ] No account enumeration on login, forgot-password or signup errors
- [ ] Rate limits on login, signup, forgot-password, accept-invitation
- [ ] Secrets only from environment; `.env` never committed
- [ ] Passwords, tokens and cookies never appear in logs or audit rows
- [ ] Security headers on the web app (CSP, `X-Content-Type-Options`, `Referrer-Policy`)
- [ ] Dependency audit in CI (`npm audit --omit=dev`, fail on high) — currently fails on critical only: `deepmerge-ts` (high) comes from the Prisma CLI with no upstream fix; tighten once fixed

---

## Definition of done

1. A new visitor can sign up, log in, add an owner and a property, and see it in the list, on a phone.
2. The manager can invite a Staff user; Staff can log in and sees only the reduced property view.
3. The permission-matrix and tenant-isolation suites pass in CI; nothing skipped.
4. Audit rows exist for all listed actions.
5. `/security-review` has no open high-severity finding.
6. `CLAUDE.md` documents the auth model, the capability map and how to add a permission.

## Risks

| Risk | Mitigation |
|---|---|
| A missing `accountId` filter leaks another customer's data | Account-scoped helper as the only data-access path for tenant tables; cross-tenant tests on every id route |
| Token or cookie mistakes | Keep the design above; strong-model review in step 1.8 |
| Scope creep into team management or plans | Anything in the "Out" list waits for its phase |
| Hosting region decided too late | Decide before step 1.0 finishes; migrating personal data later is expensive |
| No local Postgres in the session | CI service container; document the local setup in `CLAUDE.md` |

## Open decisions (need your answer)

1. Hosting provider and region for Postgres and the app (Morocco vs EU) — confirm with counsel.
2. Mail provider: Resend or Brevo.
3. Is email-only login acceptable for the pilot, or will conciergeries expect phone login?
4. Does Staff need any access to owner names, or is the reduced view (property name, address, license status) enough?
