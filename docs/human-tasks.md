# Human tasks (cannot be done by Claude)

Owner: Mohamed Zhit. Ordered by what blocks the most. Each item says what it unblocks. Dates are for you to fill in.
Nothing here is legal or tax advice: the point is to know who must decide, and to keep the code from guessing.

## A. Legal and regulatory (blocks any real guest data)

| # | Task | Unblocks | Who | Due |
|---|---|---|---|---|
| A1 | File the CNDP declaration for guest data processing; ask counsel whether the marriage-certificate flow needs an authorization instead | Real guest data, pilot | You + counsel | |
| A2 | Decide hosting region (Morocco or EU) for database and object storage, with counsel's view on cross-border transfer | Storage provider, production setup | You + counsel | |
| A3 | Counsel approves the FR/EN consent text and privacy policy; provide the final text and a version id | Consent record (3.4) | Counsel | |
| A4 | Counsel sets retention: raw ID images (30 days default), the Fiche, the monthly register | Retention job values | Counsel | |
| A5 | Counsel reviews Article 490 (marital certificate) before the flow is ever enabled | Marital flow (stays off) | Counsel | |
| A6 | Counsel confirms the 90 / 110 / 120 night thresholds and who they apply to | Pilot (the counter is what customers pay for) | Counsel | |
| A7 | Terms of use, privacy policy, professional liability insurance (RC Pro): check that it covers a tool giving tax and compliance estimates | Pilot | You + counsel + insurer | |

## B. Tax (blocks Phase 5)

| # | Task | Unblocks | Who |
|---|---|---|---|
| B1 | Fiduciaire validates formulas, rates, thresholds, Taxe de Séjour treatment, and whether furnished tourist rental is property or professional income | `TaxRule` seed, tax engine | Fiduciaire |
| B2 | Obtain worked examples (inputs and expected results to the centime) for the golden-file tests | Tax engine tests | Fiduciaire |
| B3 | Agree the wording of the "estimate only" disclaimer | Exports | Fiduciaire + counsel |

## C. Field work and documents Claude cannot obtain

| # | Task | Unblocks |
|---|---|---|
| C1 | Get the **official police form** (fields, layout) from the prefecture/DGSN; ask whether a PDF is accepted or paper is required, one form per adult or per party, and how children are recorded | Fiche de Police PDF (3.5) |
| C2 | **Test real Moroccan CIN/CNIE cards** (with the owners' permission, nothing committed to the repo): is there a machine-readable zone, and where? Tell me the result | CIN approach in the OCR worker. The MRZ parser (TD1/TD2/TD3) is already built and ready |
| C3 | Export real Airbnb and Booking.com calendars (and a CSV) for one property and compare the counter with a manual count | Phase 2 exit gate in real life |
| C4 | Write an incident runbook for a personal-data leak (who is told, in what order, within what time, CNDP notification) | Pilot |

## D. Accounts, secrets and infrastructure

| # | Task | Unblocks |
|---|---|---|
| D1 | Choose a mail provider (Resend or Brevo) and create the account; the production driver is not built because this is undecided | Password resets and alert emails in production (the API refuses to start in production without it) |
| D2 | Choose and create hosting: managed Postgres, Redis, S3-compatible storage in the region from A2 | Production, staging |
| D3 | Generate and store secrets in the provider's secret store, never in the repo: `JWT_ACCESS_SECRET` (`openssl rand -base64 48`), the storage master key (32 random bytes, base64), the OCR shared secret | Deployment |
| D4 | Fix the production domain (dedicated host such as `app.<domain>`) and configure the edge to **overwrite** `X-Forwarded-For` (see `docs/deployment.md`) | `__Host-` cookies, rate limits, audit IPs |
| D5 | Set up daily database backups and run one real restore; make sure ID images are excluded from long-term backups or deleted within the retention window | Pilot |
| D6 | Set `GUEST_CHECKIN_ENABLED` to false in production until A1 to A4 are done | Safety |
| D7 | Add the GitHub Actions secrets CI needs for integration/e2e if you want them in CI | CI |

## E. Business

| # | Task | Unblocks |
|---|---|---|
| E1 | Recruit 3–5 pilot conciergeries (synthetic data only until A1 is accepted) | Pilot |
| E2 | Meta WhatsApp Business verification (long waiting period, start early) | Phase 6 |
| E3 | Decide staff access to the Fiche PDF (status only is the recommended default) | Phase 3 permissions |
| E4 | Decide invoicing for the first customers (manual) and pricing | Pilot |

## F. Reviews only you can sign off

| # | Task |
|---|---|
| F1 | Review and merge the work branch after reading the diff; run `npm run test:int` and `npm run test:e2e` locally against a disposable database (I cannot run those here: no Postgres) |
| F2 | Test the guest form on a real low-end Android phone once it exists |
| F3 | Independent security pass (not only the in-house `/security-review`) before real ID data: storage, tokens, RBAC, logging |

## What Claude can do next, once an item above is answered

| After | Claude builds |
|---|---|
| A2 + D2 | S3 storage service on top of `storage/envelope.ts` (already built and tested), `StoredObject`, audit hooks |
| A3 + A4 | Consent texts, retention job and settings |
| C1 | Fiche de Police PDF template |
| C2 | CIN extraction in the OCR worker |
| D1 | Production mail driver |
| B1 + B2 | Tax engine, exports, accountant portal |

Not blocked and still possible without any answer: the data model and migration for Phase 3 (3.2), check-in link API (3.4), log-redaction layer and test, the guest form UI (3.8), arrivals screens (3.7).
