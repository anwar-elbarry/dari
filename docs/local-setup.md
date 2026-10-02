# Running Dari locally

Step by step, from a fresh clone to a signed-in dashboard. Takes about 15 minutes the first time.

What runs where:

| Piece | Where | Port |
| --- | --- | --- |
| Web (Next.js) | `apps/web`, on your machine | 3000 |
| API (NestJS + Prisma) | `apps/api`, on your machine | 3001 |
| PostgreSQL 16 | Docker (`db`) | **5433** on the host |
| Redis 7 | Docker (`redis`) | 6379 |
| S3-compatible storage (s3rver) | Docker (`s3`) | 9000 |
| Document worker (OCR, optional) | Docker (`ocr`, opt-in) or Python | 8001 |

The browser only talks to the web app; Next.js forwards `/api/*` to the API (`API_URL`, default `http://localhost:3001`).

---

## 1. Install the prerequisites

- **Node.js 22** and npm (CI uses Node 22).
- **Docker** with Docker Compose (Docker Desktop on Windows/macOS).
- **Git**.
- Optional:
  - **Python 3.11** and **Tesseract**, only to run the OCR worker outside Docker.
  - **Chromium for Playwright**, only for Fiche/register/tax PDFs (step 8).

On Windows, run the commands below in **Git Bash** (they use `cp` and `$(...)`).

## 2. Clone and install

```bash
git clone https://github.com/anwar-elbarry/dari.git
cd dari
npm install
```

`npm install` at the root installs both workspaces (`apps/api`, `apps/web`).

## 3. Create your `.env`

```bash
cp .env.example .env
```

Then edit `.env`. Four things need your attention.

**a. Database port.** Docker publishes Postgres on **5433** (so it does not clash with a Postgres already on your machine). Change the line to:

```
DATABASE_URL=postgresql://dari:dari@localhost:5433/dari
```

**b. `JWT_ACCESS_SECRET` (required).** It must be at least 32 characters. Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

**c. `OCR_SHARED_SECRET` (required as long as `OCR_SERVICE_URL` is set).** The API refuses to start if it is empty. Fill it with a 32+ character value even if you do not run the OCR worker:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

(Or comment out `OCR_SERVICE_URL` to run without the worker.)

**d. Storage (optional).** `STORAGE_DRIVER=memory` works out of the box, but uploaded ID photos and PDFs are lost when the API restarts. To keep them, use the Docker S3 server:

```
STORAGE_DRIVER=s3
STORAGE_MASTER_KEYS=k1:<output of: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
```

The `S3_*` values in `.env.example` already match the Docker server.

Everything else can stay as it is. Every variable is validated when the API boots (`apps/api/src/config/env.ts`); a bad value stops it with a message naming the variable.

In development the feature flags (guest check-in, police register, Secure Share, tax reports, WhatsApp stub, signup) are **on** when unset. E-mails are printed to the API console (`MAIL_DRIVER=console`), including password-reset and invitation links.

## 4. Start Postgres, Redis and S3

```bash
docker compose up -d
docker compose ps        # db, redis and s3 should be "running"
```

To include the OCR worker as well, see step 9.

## 5. Prepare the database

```bash
npm run db:generate                      # Prisma client
npm run db:deploy --workspace apps/api   # apply all migrations (also loads the default rule values)
npm run db:seed --workspace apps/api     # demo account, users, properties, dev consent text
```

The seed is idempotent; it only runs against a local database.

## 6. Start the API and the web app

Use two terminals:

```bash
npm run dev:api     # http://localhost:3001  (watch mode)
```

```bash
npm run dev:web     # http://localhost:3000
```

Wait for the API to log that it is listening before you open the browser.

## 7. Sign in

Open <http://localhost:3000> and sign in with a demo user (password `demo-password-123`):

| Role | E-mail |
| --- | --- |
| Owner/Manager | `manager@demo.dari.test` |
| Staff | `staff@demo.dari.test` |
| Accountant | `accountant@demo.dari.test` |

Each role sees a different set of screens. You can also create a new account from the signup page.

## 8. PDFs (Fiche de Police, register, tax reports)

PDFs are rendered by a headless Chromium. Install it once:

```bash
npx playwright-core install chromium
```

If you use your own Chromium build, set `PDF_CHROMIUM_PATH` in `.env` to its executable.

## 9. Document worker (OCR, optional)

The guest check-in form works without it (the guest types every field). To get passport/CIN suggestions:

**With Docker** (uses `OCR_SHARED_SECRET` from `.env`):

```bash
docker compose --profile ocr up -d --build
```

**Without Docker** (needs Python 3.11 and Tesseract installed):

```bash
cd services/ocr
pip install -r requirements.txt
OCR_SHARED_SECRET=<same value as in .env> uvicorn app.asgi:app --port 8001 --no-access-log
```

## 10. Try the guest check-in flow

1. As the manager, open a property → **Arrivals and check-in**, and send a check-in link for a confirmed upcoming stay (add one by importing a CSV or a calendar first if the property has none).
2. Copy the link (shown once) and open it in a private window. That is the guest view.
3. Submit the form; back in the manager view the guest appears with the Fiche PDF (needs step 8).

---

## Running the checks

```bash
npm run lint
npm run typecheck
npm test                                  # unit tests, no database
cd services/ocr && pytest                 # OCR worker
```

**Integration tests** need a *separate, disposable* database whose name contains `test` (all tables are emptied):

```bash
docker compose exec db psql -U dari -c "CREATE DATABASE dari_test"
DATABASE_URL=postgresql://dari:dari@localhost:5433/dari_test npm run db:deploy --workspace apps/api
DATABASE_URL=postgresql://dari:dari@localhost:5433/dari_test TEST_REDIS_URL=redis://localhost:6379/15 npm run test:int
```

`TEST_REDIS_URL` is optional and points at a Redis database that is **flushed** by every test; never point it at data you need.

**End-to-end tests** (Playwright): build both apps, then point `E2E_DATABASE_URL` at a seeded disposable database:

```bash
npm run build --workspace apps/api && npm run build --workspace apps/web
npx --workspace apps/web playwright install chromium
E2E_DATABASE_URL=postgresql://dari:dari@localhost:5433/dari_e2e npm run test:e2e
```

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| API exits at boot with `JWT_ACCESS_SECRET: must be at least 32 characters` (or `OCR_SHARED_SECRET`) | Fill the value as in step 3. |
| `Can't reach database server at localhost:5432` | `DATABASE_URL` must use port **5433** (step 3a), and `docker compose up -d` must be running. |
| Database calls are slow (seconds) on Windows | Use `127.0.0.1` instead of `localhost` in `DATABASE_URL` and `REDIS_URL` (Windows tries IPv6 first). |
| `npm run test:int` says "No tests found" on Windows | The script's quoting does not work in `cmd`. Run it from Git Bash in `apps/api`: `npx jest --runInBand --testTimeout=30000 --testRegex '.*\.int-spec\.ts$'`. |
| Fiche, register or tax PDF is never generated | Chromium is missing: do step 8. |
| Uploaded photos disappear after an API restart | `STORAGE_DRIVER=memory` keeps nothing; switch to `s3` (step 3d). |
| `db:seed` refuses to run | It only seeds a local database. For a disposable remote one, set `ALLOW_DEMO_SEED=true`. |
| Port 3000, 3001, 5433, 6379 or 9000 already in use | Stop the other service, or change the port (`PORT` for the API; update `API_URL` for the web app to match). |

To start from scratch: `docker compose down -v` (deletes the database and S3 volumes), then repeat steps 4 and 5.
