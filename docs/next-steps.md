# Next steps (written 2026-09-30)

State: branch `claude/awesome-gates-3j261d`, last commit `a372f52` (signup flag, IPv6 /64 rate limit, composite keys). Not pushed. The auth, edge, tenant-FK, signup-closed and account-scope integration tests pass. The full integration suite was never run to the end.

## 1. Start the local services

Docker Desktop must be running. The containers are `dari-db-1` (Postgres on port 5433), `dari-redis-1` and `dari-s3-1`.

```powershell
cd C:\Users\Lenovo\Desktop\projects\SAAS\dari
docker compose up -d
```

## 2. Commands I gave you

Always use a long timeout: the app boots slowly on this machine and the default 5 s makes hooks fail.

Unit tests (no database):
```powershell
cd C:\Users\Lenovo\Desktop\projects\SAAS\dari\apps\api
npx jest
```

Typecheck:
```powershell
npx tsc --noEmit
```

Only the integration suites touched by the last commit (a few minutes):
```powershell
$env:DATABASE_URL="postgresql://dari:dari@localhost:5433/dari_test"
npx jest --runInBand --testTimeout=90000 --testRegex "(edge|signup-closed|tenant-fk|account-scope|auth)\.int-spec\.ts$"
```

The whole integration suite (over 25 minutes here; prints one PASS/FAIL line per suite as it finishes):
```powershell
$env:DATABASE_URL="postgresql://dari:dari@localhost:5433/dari_test"
npx jest --runInBand --testTimeout=90000 --testRegex ".*\.int-spec\.ts$"
```

`dari_test` already has all migrations. If you recreate it:
```powershell
docker exec dari-db-1 psql -U dari -d postgres -c "CREATE DATABASE dari_test"
$env:DATABASE_URL="postgresql://dari:dari@localhost:5433/dari_test"
npx prisma migrate deploy
```

Do not set `TEST_REDIS_URL` for these runs: with it, BullMQ printed "Missing key for job" noise and some runs failed.

Is a test run still going?
```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'jest' } | Select-Object ProcessId, CreationDate
```

## 3. To do in code (in order)

1. **Run the whole integration suite** once and send me any failure that is not a timeout. `tax.int-spec.ts` failed once under load and passed alone.
2. ~~**`account:create` ops script.**~~ Done (2026-10-01): `npm run account:create -w apps/api -- --company "Riad X" --name "Owner" --email owner@example.ma [--seats 3]`. No password is set or printed; the owner uses "Forgot password". Tests: `ops/account-create.spec.ts`, `ops/account-create.int-spec.ts`.
3. ~~**Forgot-password hardening**~~ Done (2026-10-01): 3 reset e-mails an hour per address (still 204), tokens younger than 10 minutes survive a new request, a completed reset invalidates the other live tokens. Tests in `auth/auth.int-spec.ts`.
4. **Push the branch** when you are happy with it.

## 4. Yours, on staging or with other people

- Pen-test on staging (`docs/pen-test.md`)
- Real phones
- Counsel sign-offs
- Pilot
- Redis-failure behaviour and Chromium (PDF) load run

Before enabling anything in production: `npm run check:enablement -w apps/api`.

## 5. Changed in the last commit, for reference

- `SIGNUP_ENABLED` (off in production): signup answers 403 `SIGNUP_CLOSED`; the web form shows a dedicated message. See `docs/deployment.md`.
- Rate limits key on the IPv6 /64 (`apps/api/src/common/throttle-key.ts`, `client-throttler.guard.ts`).
- Migration `20260930150000_composite_keys_bookings_notifications`. Deleting a calendar feed now detaches its bookings in code first (`apps/api/src/ical/feeds.service.ts`), because a composite key cannot SET NULL.
