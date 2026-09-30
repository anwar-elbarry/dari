# Pen-test checklist for the public routes (Phase 7.3)

Run on **staging, through the real edge** (proxy, TLS, headers), never on production data. Two parts: the script does the black-box checks that need no account; the manual list covers what needs a real link or an account. Record the date, the person, the build and each result at the end of this file.

```
BASE=https://staging.example.com scripts/pentest-public.sh
```

The script sends only invalid tokens and malformed requests and creates nothing. It exits 1 on any `FAIL`. Its checks are also covered by the API's own suites (`share-abuse`, `checkin-abuse`, `whatsapp-webhook`, `edge` integration specs); running it against staging adds the real edge.

## Routes in scope

| Route | Auth | Limit per address | Token |
|---|---|---|---|
| `GET /api/checkin`, `POST /api/checkin/document`, `POST /api/checkin/submit` | none | 60, 10, 10 a minute | `X-Checkin-Token` |
| `GET /api/share` | none | 30 a minute (and a cap per link) | `X-Share-Token` |
| `GET, POST /api/webhooks/whatsapp` | HMAC signature over the raw body / verify token | 30 and 600 a minute | none |
| `POST /api/auth/signup, login, refresh, forgot-password, reset-password` | none | 5, strict, 30, 5, strict | body |
| `POST /api/invitations/preview, accept` | none | strict | body |
| `GET /api/health` | none | global | none |
| `/checkin`, `/s` (web pages) | none | edge | URL fragment |

## Automated by the script

Neutral 404 and identical bodies for unknown, missing, malformed and query-string tokens; `no-store`, `noindex`, `no-referrer`, no cookie, no CORS grant, no version banner; HEAD and POST on the public share route; check-in unknown token on every method; CSRF header required; webhook bad or absent signature, wrong verify token never echoes the challenge, oversized body; login, forgot-password, reset and invitation with unknown values (no enumeration); no stack trace on an unknown path; the 35th request in a minute is 429 with `no-store`.

## Manual, with a real staging link or account

Tick each one; write what you saw next to any failure.

**Secure Share**
- [ ] Create a share (24 h). Open it in a private window: the PDF shows, the address bar keeps `#token=…` out of the server logs (search the edge logs for the token: no match).
- [ ] Revoke it in the manager screen. The same link now shows the neutral page within one request.
- [ ] Set the expiry to the minimum, wait it out (or move the clock on staging): neutral page.
- [ ] Copy the link, change one character of the token: same neutral page, same status and size as an unknown link; response times of a valid-format unknown token and a revoked one are not distinguishable over 50 requests each (compare medians; a difference of more than a few milliseconds is a finding).
- [ ] Open the link 31 times in a minute from one address: 429, and the manager sees the views counted.
- [ ] Manager of another account: `GET/DELETE /api/shares/<id>` and `/access` answer 404.

**Check-in**
- [ ] A link for a two-guest stay: the third guest is refused with the same neutral page as an unknown link.
- [ ] Revoked and expired links answer like unknown ones (same status, body, headers).
- [ ] Upload: a renamed `.exe`, a JPEG with a huge pixel size, a 9 MB file, a polyglot: each refused without a 500; the response carries no path or library name.
- [ ] Through the edge: a body over the edge limit is refused at the edge (the API accepts up to 8 MB for a photo; the edge should stop anything larger before it reaches the API).
- [ ] After submit, `GET /api/checkin` with the same token never returns the stored image or another guest's data.

**WhatsApp webhook** (once the channel is configured on staging)
- [ ] A status report signed by Meta's test tool is applied; the same body with one byte changed is a 404.
- [ ] The body reaches the API byte for byte through the proxy: the signature verifies for a body containing non-ASCII characters and escaped slashes (proxies that re-encode JSON break this).
- [ ] Replay the same signed report twice: nothing changes the second time.

**Accounts**
- [ ] Sign in with a wrong password 10 times: lockout; the message for a locked and for an unknown address is the same.
- [ ] Password reset and invitation links: the token is in the fragment; used once, the second use fails with the same error as an unknown token.
- [ ] Stolen cookie test: copy both cookies, log out (or reset the password) in the browser: wait one second, then `GET /api/me` with the copied cookies is 401.
- [ ] `POST /api/auth/signup` answers 404 on staging and production (`SIGNUP_ENABLED` off).
- [ ] Ask for a password reset three times in a row: one e-mail arrives, the answer is 204 each time.
- [ ] Forged `X-Forwarded-For` sent to the edge: the audit row shows your real address (pilot checklist section 1).

**Web**
- [ ] `/checkin` and `/s` send `Referrer-Policy: no-referrer`, a CSP, `X-Content-Type-Options: nosniff`, and are not indexable (`X-Robots-Tag` or meta).
- [ ] Load `/checkin#token=…` and check the token is removed from the address bar and not stored in `localStorage`.

## Severity and what stops the release

High: cross-tenant access, personal data or a token exposed, an authentication bypass. Medium: needs a precondition or leaks metadata. Low: hardening. Any High blocks; each Medium is fixed or accepted in writing (in `docs/phase-7.md`). A fixed finding gets a regression test in the suite of its area.

## Results

| Date | By | Build | Script | Manual list | Findings |
|---|---|---|---|---|---|
| | | | | | |
