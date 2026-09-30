# Phase 5 — Tax engine, exports and Accountant portal

Part of the [roadmap](../README.md). Built solo with Claude: each numbered step below is one short, single-feature session. Template and conventions: [`phase-1.md`](phase-1.md), [`phase-4.md`](phase-4.md) (whose patterns this phase reuses: versioned PDF templates, encrypted `StoredObject` files with audited reads, `RuleConfig` read through `RulesService`, feature flags with their own guard).

**Goal:** a monthly tax **estimate** per property that a fiduciaire can check line by line, exported as PDF and Excel, and a read-only portal where the customer's accountant reads the reports without ever seeing a guest.

**Why it matters:** this is the second reason customers pay, and the only feature that states amounts of money owed. A wrong rate or a regime applied to the wrong owner is a financial and reputational risk for the customer and a liability risk for Dari. Every rate, threshold and treatment comes from the fiduciaire as data (rule 1 in `CLAUDE.md`), every output says "estimate only — confirm with your accountant" (rule 2), and money is integer centimes (rule 9).

**Hard gate for this phase:** the fiduciaire's written validation of the formulas, rates, thresholds and Taxe de Séjour treatment, with worked examples.

> **Founder decision, 2026-09-30: build the whole pipeline now and ship it as a BETA.** The plan below was written to wait for the fiduciaire. The founder chose to build steps 5.2 onward with the standard rates they supplied as **unvalidated defaults**, and to compensate with an unmissable watermark and disclaimer. Consequences, all implemented (see the outcome at the end):
> - The defaults are `RuleConfig` rows with `validatedBy` NULL, not constants (rule 1 in `CLAUDE.md` still holds). A fiduciaire replaces them and fills `validatedBy` / `validatedAt`.
> - **A report is a beta estimate while any rule it used is unvalidated or missing, or while its month is incomplete.** Its PDF, Excel export and screens carry the beta watermark, banner and full disclaimer (wording in `RuleConfig`, never in the app). When every rule used is validated and the month is complete, the beta marking disappears by itself and the standard "estimate only" notice remains.
> - **The gate did not disappear, it moved:** the fiduciaire's validation is still required before Dari calls these figures anything more than a mathematical projection, and before the flag is turned on for real customers' declarations. Golden files from the fiduciaire's worked examples are still to be added when they arrive; the tests today use hand-checked examples of the supplied defaults.
> - The rates the founder supplied are *not confirmed by this project*: nothing in the repository, and no reference this plan could cite, establishes that 10 % / 15 % with a 120 000 MAD threshold, applied as coded, matches the DGI rules for a given owner (abatements, the exact base, per-owner versus per-property, the treatment of Taxe de séjour and of the platform commission are all open). They are the fiduciaire's to confirm.

---

## Carried over from Phase 4

| Item | Why it lands here |
|---|---|
| Phase 4 hard gates (official register form, register and Fiche retention, whether an authority's access must be attributable, share lifetime bounds) | Legal track, tracked in [`phase-4.md`](phase-4.md); nothing to build until counsel answers |
| `share.accessed` is written before the final liveness check, so a revocation that lands during a read leaves an audit row without an opening | Accepted (fail-safe direction); revisit if counsel wants the audit trail to match `ShareAccess` exactly |
| The recorded opening does not say which version of the file was served | Regenerating now revokes the links (4.6), so a link id identifies one version; storing the file's `sha256` on `ShareAccess` is a small change if counsel asks |
| Arabic register layout, CIN / CNIE OCR, Arabic guest form | After the pilot (solo plan) |
| Pilot manual checks (Secure Share on a real phone viewer) | [`pilot-checklist.md`](pilot-checklist.md) |

---

## Scope

### In
- **Rule loading:** `TaxRule` (per commune and licence type, effective dates) and `RuleConfig` keys for every rate, threshold and treatment, each with `validatedBy` / `validatedAt`. A rule that is not validated is never used for an amount: the report says which input is missing instead of guessing.
- **Pipeline** (pure functions, integer centimes, one per step, each unit-tested): gross base (exists: `tax/gross-base.ts`) → Taxe de Séjour treatment (`INCLUDED` or `COLLECTED`, per property) → regime (property income / professional / company, per property) → local taxes → output lines. Nights revenue and add-on commissions reported separately; the non-resident / MRE statement where the owner's residency requires it.
- **Monthly report per property** (`TaxReport`): computed from the confirmed `BOOKING` stays of that month and their amounts; stores the inputs' digest (as `PoliceRegister.inputDigest`), the rule versions used and the disclaimer version, so a report is known to be `outdated` when a stay, an amount or a rule changes.
- **Exports:** PDF (versioned template, as for the register) and Excel (`.xlsx`, every cell through the formula-injection guard used for CSV). Both carry the disclaimer on every page / sheet. Both are encrypted `StoredObject`s, read through an audited API route; no URL.
- **Accountant portal:** the Accountant role gets `report:read` only: the list of reports per property and month, the report lines and the exports. No guest, no ID, no booking details beyond what a report line shows, no property owner contact data.
- **Missing-data report:** stays with no amounts (iCal gives dates only), stays with a currency or source the import did not map, properties with no regime or Taxe de Séjour mode. Shown before generating, as the register's validation report is.
- Feature flag `TAX_REPORTS_ENABLED` (off by default in production).

### Out (later phases)
- Filing or payment on the customer's behalf; any wording suggesting a declaration was made → never in the MVP
- Annual summary and tax report history screens → Phase 8 (fast-follow, first item)
- Revenue import from platform payout reports beyond the CSV import of Phase 2 → after the pilot
- Company regime detail beyond what the fiduciaire specifies for the pilot customers
- Billing, invoices for Dari's own subscription → Phase 8

---

## Decisions to lock before coding

| Topic | Recommendation | Reason |
|---|---|---|
| Source of rates and thresholds | `TaxRule` rows and `RuleConfig` keys only, seeded from the fiduciaire's signed document; each has `validatedBy` and `validatedAt`; no default in code | Rule 1 in `CLAUDE.md` |
| An unvalidated rule | The line is shown as "not computed: rule not validated" and the report is marked incomplete; never a placeholder amount | A wrong number is worse than a missing one |
| Rounding | Per the fiduciaire's worked examples (per line or per total, half-up or banker's); encoded as a `RuleConfig` key, tested by the golden files | Centime differences are the first thing a fiduciaire checks |
| Which stays count | Confirmed `BOOKING` stays, by **check-out** month or by **nights in the month**: to be decided by the fiduciaire (the register uses arrival month; tax may not) | The two answers give different monthly figures |
| Amounts on stays | From CSV imports and manual entry only; iCal stays without amounts are listed in the missing-data report | iCal carries no prices |
| Report immutability | A generated report is kept as generated (with its rule versions); regenerating replaces it and its files (hand-over pattern from 4.6); an `outdated` status as for the register | The fiduciaire needs to know which rules produced which figure |
| Disclaimer | Text versioned in `RuleConfig` (`tax.disclaimer`, per language), approved by counsel; the report stores the version shown | Rule 2 in `CLAUDE.md`; the text is legal wording, not code |
| Accountant access | `report:read` only, per account (all properties); a property filter per accountant waits until a customer asks | Least privilege without building per-property grants yet |
| Excel generation | A maintained library that writes `.xlsx` without macros; every string cell through `csvCell()`-style escaping | Formula injection in exports |

---

## Data model changes

| Model | Change |
|---|---|
| `TaxReport` | Add `accountId` and composite keys with `accountId` (`@@unique([id, accountId])`, property FK `(propertyId, accountId)`); replace `pdfUrl`, `excelUrl`, `localTaxStatementUrl` with `pdfObjectId`, `xlsxObjectId` (`StoredObject`); add `inputDigest`, `ruleVersions` (JSON: rule ids and `validatedAt`), `lines` (JSON, centimes as integers), `problems` (JSON, ids only), `generatedBy`, `generatedAt`; money columns stay `Decimal(12,2)` |
| `StoredObject.kind` | Add `TAX_REPORT_PDF`, `TAX_REPORT_XLSX` |
| `TaxRule` | Add a `version` or rely on `effectiveFrom` + `validatedAt`; unique `(commune, licenseType, effectiveFrom)` |
| `RuleConfig` | Keys for thresholds (e.g. the 120 000 MAD and 500 000 MAD thresholds of the specs), rates per regime, rounding, stay-month rule, `tax.disclaimer.<locale>`; values from the fiduciaire, unvalidated until then |
| `Booking` | No change expected; amounts exist (`nightlyRevenue`, `cleaningFee`, `addonRevenue`, `discounts`, `refunds`, `platformCommission`, `taxeSejourAmount`) |
| `AuditAction` | `tax.report.generated`, `tax.report.read`, `tax.export.read` |
| Capabilities | `report:read` (Owner/Manager and Accountant), `report:generate` (Owner/Manager) |
| Account scope | `TaxReport` added to `TENANT_MODELS`; a tenant-FK test row |

---

## API surface

| Route | Method | Access | Notes |
|---|---|---|---|
| `/tax/rules` | GET | `report:read` | Which rules are in force, with their values, whether and by whom they were validated, and the disclaimer wording (beta and standard, FR and EN) the screens show |
| `/tax/reports` | GET | `report:read` | Every report of the account, newest first, with status and totals (`?year=`, `?propertyId=`; `X-Truncated: true` past 300). The Accountant's index: counts of problems, never booking ids |
| `/tax/reports/:id` | GET | `report:read` | The lines, totals, rules used (with validation status), problem counts |
| `/properties/:id/tax-reports` | GET | `report:generate` | The property's months with status (none, generated, outdated) |
| `/properties/:id/tax-reports/:month/missing` | GET | `report:generate` | Stays without amounts, properties without regime; ids only |
| `/properties/:id/tax-reports/:month` | POST | `report:generate` | Generate or regenerate; audited |
| `/tax/reports/:id/pdf` · `/xlsx` | GET | `report:read` | Decrypts, audits, streams; `no-store`. Refused with 409 `REPORT_OUTDATED` when the report no longer matches the data or the rules |
| `/bookings/:id/amounts` | PATCH | `booking:write` | Revenue figures of a stay as decimal text (or null); the input of the estimate |

Every route goes into the permission matrix and the tenant-isolation suite. The Accountant's responses are checked by a test that greps them for guest fields and names.

---

## Screens

| # | Screen | Notes |
|---|---|---|
| 14 | Tax reports (per property) | Month list with status pills, "Generate", "Open the PDF", "Download Excel"; the disclaimer above the list |
| 15 | Report detail | Lines grouped by step of the pipeline, totals, rules used with their validation date, missing inputs named |
| 16 | Missing data | Stays without amounts with a link to enter them; properties without regime |
| 17 | Accountant home | Properties and months with a report; nothing else in the navigation |

Help text stays neutral ("confirm with your accountant"), never states the law (`CLAUDE.md`, Web).

---

## Permission matrix rows added

| Route | Owner/Manager | Staff | Accountant | Anonymous |
|---|---|---|---|---|
| `GET /tax/rules`, `/tax/reports`, `/tax/reports/:id`, `…/pdf`, `…/xlsx` | 200 | 403 | 200 | 401 |
| `GET /properties/:id/tax-reports`, `…/:month/missing` | 200 | 403 | 403 | 401 |
| `POST /properties/:id/tax-reports/:month` | 200 | 403 | 403 | 401 |
| `PATCH /bookings/:id/amounts` | 200 | 403 | 403 | 401 |

---|---|---|---|---|
| `GET /tax/rules/status` | 200 | 403 | 200 | 401 |
| `GET /properties/:id/tax-reports` | 200 | 403 | 200 | 401 |
| `GET …/:month/missing` | 200 | 403 | 403 | 401 |
| `POST …/:month` | 200 | 403 | 403 | 401 |
| `GET …/:month`, `/pdf`, `/xlsx` | 200 | 403 | 200 | 401 |

---

## Work breakdown

| Step | Work | Model |
|---|---|---|
| 5.0 | Data model, migration, capabilities (`report:read`, `report:generate`), Accountant route guard, `TAX_REPORTS_ENABLED`, rule loading with validation status, disclaimer as `RuleConfig` — **done** | fast |
| 5.1 | Missing-data report and amounts entry on a stay (manager), with tests; Accountant home screen (empty state) — **done** | fast |
| 5.2 | **Pipeline** from the fiduciaire's worked examples: pure functions per step, golden-file tests to the centime, rounding rule — **done (BETA defaults, no fiduciaire golden files yet)** | strong |
| 5.3 | **Report generation**: month selection rule, digest and `outdated`, rule versions, storage, audit — **done** | strong |
| 5.4 | Exports: PDF template (versioned, disclaimer on every page, no "certified" wording) and Excel (formula-injection safe) — **done** | fast |
| 5.5 | Web: reports list, detail, missing data, Accountant portal — **done** | fast |
| 5.6 | Hardening: Accountant data-leak suite, logging suite extended, security review, e2e, docs, Phase 6 plan — **done** (see the outcome) | strong |

Steps 5.2 and 5.3 carry the risk. They were built on the founder's beta defaults; the fiduciaire's validation is still owed.

---

## Tests required

- **Pipeline (unit, golden files):** each worked example from the fiduciaire reproduced to the centime; every step in integer centimes; no float anywhere (a test greps the tax module for `parseFloat`, `toFixed`, `Number(` on money); an unvalidated rule produces "not computed", never a number; rule effective dates respected at month boundaries.
- **Report (integration):** only confirmed `BOOKING` stays of the month by the chosen rule; cancelled stays and owner blocks excluded; a changed amount, stay or rule makes the report `outdated`; regenerating replaces and shreds the previous files (no orphan, as tested in 4.6); another account gets 404; every file read audited before any byte.
- **Accountant:** every response the Accountant can reach contains no guest field, name, document number, e-mail or phone (grep test over seeded fake PII); Staff refused on every tax route.
- **Exports:** the disclaimer on every PDF page and every sheet; no "certified", "guaranteed" or "compliant" wording (grep); Excel cells beginning with `=`, `+`, `-`, `@` are neutralised.
- **Logging:** the redaction suite extended to the tax routes (amounts are not personal data, but owner names and guest data must not appear).
- **E2E (phone viewport):** manager enters amounts, generates a report, opens the PDF; the Accountant signs in and sees the report and nothing else.

---

## Security checklist for this phase

- [ ] No rate, threshold or treatment in code; a test fails if a known threshold literal appears in `src/tax`
- [ ] Money: centimes in functions, `Decimal(12,2)` in the database, no floats
- [ ] Disclaimer on every output (screen, PDF, Excel), versioned
- [ ] Accountant: `report:read` only; no guest data in any response or export
- [ ] Exports are encrypted `StoredObject`s, audited reads, no URL, `no-store`
- [ ] Excel and CSV exports formula-injection safe
- [ ] Feature flag off by default in production; routes answer 404 when off

---

## Definition of done

1. With the fiduciaire's rules seeded and validated, a manager generates a monthly report for a property and gets figures that match the fiduciaire's worked examples to the centime.
2. The PDF and Excel exports carry the disclaimer and open on a phone and in Excel / LibreOffice.
3. An Accountant user sees the reports of the account and nothing about guests.
4. A change of rule, stay or amount marks the report out of date; regenerating replaces it and its files.
5. The pipeline, report, Accountant and logging suites pass in CI; security review has no open high-severity finding.
6. `docs/phase-6.md` written; the fiduciaire validation is recorded (who, when, which document).

## Risks

| Risk | Mitigation |
|---|---|
| The fiduciaire's answer is late or partial | Steps 5.0–5.1 do not depend on it; the pipeline shows "not computed" per missing rule; the phase ships per regime as rules arrive |
| A wrong figure reaches a customer's declaration | The beta watermark and disclaimer while rules are unvalidated; rule versions on each report; golden-file tests from the fiduciaire once supplied; wording reviewed by counsel. **The rates in use are the founder's, not confirmed by a fiduciaire** |
| Rounding differences of a few centimes | Rounding is a validated rule and part of the golden files |
| Amounts missing on iCal stays | The missing-data report before generating; a report with missing amounts is marked incomplete |
| The Accountant role leaks guest data | Dedicated grep suite over every Accountant-reachable response; capability map reviewed |
| Excel export used to inject formulas | Every cell escaped; tested |

## Open decisions (need your answer)

1. Which fiduciaire, and by when can they send the validated rules and at least three worked examples per regime (property income, professional, company)?
2. Which stays belong to a month for tax: nights in the month, check-out month, or payout month?
3. Do pilot customers already enter amounts per stay, or only have platform payout reports (which would need a new import)?
4. Should an Accountant see all properties of the account, or only those the manager assigns?
5. Who approves the disclaimer wording in French and English (counsel or the fiduciaire)?
6. Is Excel required, or is CSV enough for the pilot accountants?

---

## Outcome (Phase 5 closed as a BETA: code complete, fiduciaire validation open)

Steps 5.0 to 5.6 are done, on the founder's decision to ship with unvalidated defaults and a watermark (see the box at the top). CI runs the pipeline unit tests, the integration suites (Postgres, Redis, a real Chromium: generation, exports, staleness, Accountant leaks, flag, log redaction, permission matrix, tenant isolation, foreign keys) and the phone-viewport e2e (manager: banner, amounts, generate, lines, PDF and Excel, out-of-date cycle; Accountant: reads the estimate, cannot reach a property, cannot generate; Staff: nothing).

**What was delivered**
- **Rules as data** (migration `20260930120000`): `tax.property_income` (10 % up to 120 000 MAD of annual gross base, 15 % above, applied to the whole year to date), `tax.vat` (10 %, tax-inclusive, professional and company), `tax.rounding` (half-up per line), `tax.stay_month` (check-out month), and the disclaimer wording (beta and standard, FR and EN), all with `validatedBy` NULL. `TaxRule` supplies local taxes per commune and licence type (none seeded). `tax/hygiene.spec.ts` fails the build if a threshold literal or a float on money appears in `src/tax`.
- **The pipeline** (`tax/pipeline.ts`, `money.ts`, `rules.ts`): pure, integer centimes, BigInt ratios rounded half away from zero; gross base, Taxe de séjour (included or collected), property income tax with a catch-up when the owner's year to date crosses the threshold, VAT, local taxes, a non-resident statement line. A missing or malformed rule gives "not computed" and a `RULE_MISSING` problem, never a guess.
- **Reports** (`tax-report.service.ts`): built from confirmed stays, digest-based `outdated` detection (stays, amounts, property settings, rules and disclaimer version), PDF and Excel stored as encrypted files with the provisional-file swap of 4.6, audited reads that fail closed, no export of an out-of-date report.
- **Exports:** the PDF has a diagonal watermark, a red banner and the full disclaimer in a footer on every page; the Excel has a red banner and the full text at the top of every sheet, the print header and footer, and a background image; values only, no formulas, text neutralised. Verified by reading the produced files in the tests (text of the PDF, cells and headers of the workbook).
- **Stay amounts** through `PATCH /bookings/:id/amounts` (decimal text only, audited by id without the amounts) and the web screens: property tax page, missing-data and amounts dialogs, report detail, the Accountant's `/reports` home, nav entry, FR and EN.
- **Ops:** `TAX_REPORTS_ENABLED` (off in production), the enablement check reports missing disclaimer wording (blocking) and unvalidated rules (warning).

**Independent security review** (read-only pass over the API): no high finding. Fixed, each with a regression test:
- **Medium:** listing reports rebuilt every report from scratch (up to 20 000 stays each); a per-request cache now shares the rule reads and the year's stays, and the list routes are throttled.
- **Medium:** the account-wide list silently stopped at 100 reports; it is now 300 with `?year=` / `?propertyId=` filters and an `X-Truncated` header.
- **Low/medium:** the owner's annual total added properties under other regimes; only properties under the same income regime add up.
- **Low/medium:** a month with a stay lacking amounts, party size or an included Taxe de séjour got the standard notice when the rules were validated; any data gap now keeps the beta marking. A stay with only a commission or a Taxe de séjour entered counts as having amounts.
- **Low:** an out-of-date report's files stayed downloadable (and could lack the beta marking if a rule had since become unvalidated); they now answer 409 until regenerated.
- **Low:** a negative income-tax line (a refund lowering the year to date) is clamped to zero; Excel header and footer strings could exceed Excel's limit or read a leading digit as a font size; totals beyond the `Decimal(12,2)` range are refused (422) instead of a 500; `TaxRule` got the unique index the plan promised; a changed disclaimer version now marks reports outdated.

**Accepted and documented**
- **The rates are the founder's, not confirmed.** See the box at the top. The report says so on every page while any rule is unvalidated.
- The catch-up appears in the month the owner crosses the threshold, on the properties that have stays that month; a property with no stay that month shows it in the next report it generates. A yearly summary (Phase 8) is the clean answer.
- The local-tax line reads `TaxRule.tptRate` as MAD per person per night when `basis` is `PER_PERSON_NIGHT`. What `tptRate` means (a per-night amount or a percentage of turnover) is for the fiduciaire to confirm; with no `TaxRule` row it is "not computed".
- The Accountant sees the owner's residency and bank-account type on a non-resident statement line, and property names (which can contain an owner's name). Both are needed to read the estimate; counsel may decide otherwise.
- The standard (non-beta) disclaimer is seeded unvalidated too; its wording should be approved with the beta text (open decision 5).
- The two exports are not shareable through Secure Share and have no retention rule: they hold no guest data, but a retention period for them can be added to the purge job if counsel wants one.

### Hard gates: tracker (Phase 5 additions)

**Dates are proposals (set 2026-09-30): confirm or change them.**

| Gate | Owner | Proposed date | Status |
|---|---|---|---|
| Fiduciaire confirms or replaces each default: income-tax rates and threshold, whether the whole year to date moves to the higher rate, VAT rate and basis, rounding, which stays belong to a month, treatment of Taxe de séjour and of the platform commission | Founder + fiduciaire | 2026-10-20 | Open |
| Three worked examples per regime (property income, professional, company) to become golden-file tests | Fiduciaire | 2026-10-20 | Open |
| Income-tax rule for the professional and company regimes; local-tax `TaxRule` rows (and what `tptRate` means) | Fiduciaire | 2026-10-20 | Open |
| Wording of the beta and standard disclaimers approved (FR and EN) | Counsel or fiduciaire | 2026-10-20 | Open |
| Decide whether reports may be used for real customers' declarations once rules are validated (the watermark then disappears by itself) | Founder | after the above | Open |

