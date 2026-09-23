# Panel digest — Phase 2 split receipts, per-invoice QuickBooks, schedule UI (20260923)

Brief: `review-panel-brief-phase2.md`
Reviewed at `ff3d2120`; fixes landed in `2bb3ffa3` → `48642baa` → `c7501909` → `f615df50` → `2598964a`.
Final range verified by the panel: **`7d692e1c..2598964a`**.

## Verdicts

| Reviewer | Verdict |
|---|---|
| kimi-k3 | needs-fixes at `ff3d2120` → all findings fixed → re-verified |
| deepseek-v4-pro | needs-fixes at `ff3d2120` → **ship-it** at `2bb3ffa3` |
| glm-5.3 | needs-fixes at `ff3d2120` → **ship-it** at `2598964a` ("nothing left from my audit") |

## What Phase 2 delivered

1. **Split receipt identity** — migration `0128`: `customer_payments.split_parent_id` (self-FK, `ON DELETE CASCADE`). One bank transfer covering several invoices stores one row per invoice, but the row the trader recorded is the parent, so `listOrderPayments` and `getCustomerPaymentLedger` list **one receipt at the full banked amount** while `totalReceived` still sums every row. Ledger `count` is `count(*) FILTER (WHERE split_parent_id IS NULL)` — receipts, not rows.
2. **Per-invoice QuickBooks routes** — `POST /admin/settings/integrations/quickbooks/sync-invoice/:invoiceId` + `/invoice-status/:invoiceId`. The split refusal's instruction is now followable; previously split orders could not reach QB at all.
3. **Schedule UI** — `OrderPaymentScheduleCardComponent` on order detail (add/remove tranches, due basis, live 100% total, draft preview), `invoiceId` threaded through the pdf/action/send-email paths, and the API returns each tranche's issued `invoiceId/invoiceNumber/issuedAmount/issuedDueDate`.

## Findings, and the ones that mattered

Both reviewers independently confirmed the area the author flagged as least confident — **the SQL-level ledger collapse** — as the strongest part: parts counted exactly once, money conserved under date filters (parts copy their parent's `receivedAt` and nothing ever updates it), parent-only `LIMIT/OFFSET` correct, now pinned by a regression test.

Four findings were real bugs in *my* work, not the original design:

| Finding | Who | Severity | What it actually was |
|---|---|---|---|
| Email path dead end-to-end | Kimi, GLM | HIGH | I threaded `invoiceId` through the send-email body and the API accepted it, but **nothing populated it** — the modal never emitted one, so a split order could still only email the deposit. Declared, threaded, dead. |
| `emailInvoiceId` never reset between orders | GLM | MEDIUM | **Introduced by my own fix.** Previewing a tranche on order A then opening order B sent a foreign invoice id (404). |
| Preview total ≠ issuance total | DeepSeek, GLM | MEDIUM | The card previewed `Σ qty × price` over **all** item rows while issuance bills only customer-facing ones (hidden/commission/credit-note lines excluded) — overstating every tranche. |
| Ledger `appliedTo` was dead code | GLM | LOW→real | The subquery was selected but the mapper dropped it, so the field existed on one route only. Also emitted a JSON *number* where the order route emitted a string. |

Plus: `scheduleLocked` constant `false` (inviting an edit that always 400s), card tolerance `0.01` vs the API's `PERCENT_TOLERANCE` `0.001`, ledger amount-sort on the keeper share rather than the displayed total, header action naming the deposit after previewing another tranche, and `ADD COLUMN IF NOT EXISTS` silently skipping the FK when the column pre-exists (so a DB with the column out-of-band had **no cascade**).

## Two silent-false-green defects fixed while working

Both pre-existing, both worth remembering because neither was visible from a green build:

- **`apps/web`'s `typecheck` script and CI's web typecheck pointed at `tsconfig.json`**, which has `files: []` + project references → they **checked nothing and always passed**. The `Web (build)` job caught real errors, which is why it went unnoticed. Both now use `tsconfig.app.json`; verified to fail on a deliberate error, and `--listFiles` confirmed the new components are in the program.
- **The test harness swallowed a failed `migrate()` with a bare `catch`**, so its compat shim silently covered unapplied migrations. Drizzle's migrator aborts at the FIRST failure, so one out-of-band migration blocks every later one — `0125` was blocking `0126`–`0128` on the test DB. It now names what it is shimming for.

## Verification

- `invoice.service.test.ts` **42**, `company.service.local.test.ts` **9** (new ledger conservation test), QB e2e **4**. API sweep of 14 suites: **207 pass, 2 fail** (both pre-existing, baseline-confirmed). Web: **106 pass**.
- Both new test groups verified to FAIL against `7d692e1c` — they defend observable contracts, not plumbing.
- Empirical probes: ledger conservation under date filters; cascade (part-survives-parent = 0); rendered PDFs for both tranches (`pdftotext`: `Deposit — 50% of order … 342,102.00 USD` / `Order total 684,204.00 USD`); named tranche yields a different document than the default; both routes return byte-identical `appliedTo`; migration `0128` idempotent and its guarded FK attaches even when the column pre-exists.

## Deferred, with reasons

- **`viewInvoicePdf`'s `invoiceId` param is now unused** (the page's own download path uses the server filename instead). Pre-existing dead method; delete in a separate cleanup rather than mix it in.
- **Split sibling rows still have no group id beyond the parent link** — safe as long as no per-payment edit/delete route exists; the first one to ship must understand the split.
- No per-tranche PDF line proration; no Kantox multi-valueDate; no per-tranche financing.

## Not done

Phase 2 is **not deployed**. Staging carries Phase 1 (`8cfbb36`); production (moxie, channeltx, riviera-marine) still carries neither Phase 0 nor Phase 1, and `0126`+`0127`+`0128` remain to be applied there. `0128` is additive and safe on live data (every existing payment is a parent with `split_parent_id` NULL).
