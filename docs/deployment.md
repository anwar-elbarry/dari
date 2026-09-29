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

## API environment (production)

Validated at boot by `apps/api/src/config/env.ts`; the API refuses to start on an invalid value.

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` (forces secure cookies, refuses dev mail drivers and disabled rate limits) |
| `DATABASE_URL` | Managed Postgres, TLS, private network |
| `JWT_ACCESS_SECRET` | 48+ random bytes (`openssl rand -base64 48`), from the secret store |
| `APP_URL` | Public HTTPS URL of the web app (used in emailed links) |
| `TRUST_PROXY` | `1` (see above) |
| `MAIL_DRIVER` | Production driver — **not built yet** (Resend or Brevo, open decision). The API will not start in production until it exists. |

## Single instance for now

The login lockout and the rate-limit counters are in memory. Run **one** API instance until they move to Redis (planned with the job runner in Phase 2).

## Before real customer data

- Daily database backups with one tested restore.
- CNDP declaration filed (legal track).
- Written runbook for a personal-data incident.
