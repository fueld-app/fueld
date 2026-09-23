# Panel Review — broker commission report reported $0.00 on every real broker deal

Frozen commit: **`ca6929c3`** in `/Users/patrickpereira/fueld`. Range to review: **`ca6929c3~1..ca6929c3`** (`git diff ca6929c3~1 ca6929c3`).

Two files: `apps/api/src/modules/reports/reports.service.ts` (the fix) and `apps/api/tests/broker-deal-commission-report.e2e.test.ts` (test hardening).

## Trigger

Moxie's Frederik Nissen reported by WhatsApp that the Broker Commission Report shows **$0.00** on every broker deal, with example order `20260813-000034` (a broker deal, `commissionPerMt = 3.0000`, 80 MT LSMGO, status CONFIRMED). He is trying to pull their commission list through Fueld because they earn 3 $/MT delivered on broker deals.

Reproduced against Moxie production data (tenant `3de55d7e-b67d-4a8e-936d-c44955df64d1`) by calling `buildBrokerCommissionReport` directly: the example order returned **0.00**. After the fix it returns **240.00**, and the Aug–Sep total went **44,020.51 → 69,085.37 USD** (under-reported by **25,064.86**).

## Root cause — two independent faults in the same loop

**Fault 1 — the report read only the per-line rate.** The query selected `commissionPerMt: orderItems.commissionPerUnit`, and the loop used it exclusively. In practice Moxie's line items are priced with **no** per-line rate; the rate lives on the order (`orders.commission_per_mt`), which is where the UI seeds the tenant default when a trader toggles a deal to broker deal (`order-detail-page.component.ts:601`, `onBrokerDealToggle`). So `rate` was `null → parseFloat(null) → NaN`… actually `r.commissionPerMt != null` was false, so it took the fallback (Fault 2), which was 0.

**Fault 2 — the tenant fallback read a field nothing writes.** `bd.defaultCommissionPerMt` was renamed to `defaultCommissionRate` in `fd69d793` ("simplify broker deal settings from 14 to 5 configurable options"). That commit updated `settings.controller.ts` but **not** `reports.service.ts`. Moxie's settings contain `defaultCommissionRate: 3` and no `defaultCommissionPerMt`, so the fallback resolved to `0`.

## The fix

Rate resolution now mirrors `order-financing.ts:239` (`parseNumber(item.commissionPerUnit) || orderCommissionPerMt || 0`) and the design doc's own reference SQL (`docs/broker-deal-design.md:487`, which reads `o.commission_per_mt` with a `defaultCommissionPerMt` fallback):

```
per-line commissionPerUnit  →  order-level commissionPerMt  →  tenant defaultCommissionRate
```

The tenant fallback reads `defaultCommissionRate` and still accepts the legacy `defaultCommissionPerMt`, so an instance provisioned before the rename still resolves.

## Why it shipped — the test that hid it

The existing fallback test asserted the correct behaviour but set **both** keys:

```ts
// Set default commission rate to 5 (use both field names for compat)
await enableBrokerDeals(seeded.tenant.id, { defaultCommissionRate: 5, defaultCommissionPerMt: 5 });
```

So it passed against the buggy read. It now sets only `defaultCommissionRate`, and two tests were added: order-level fallback (80 MT × $3 = $240) and per-line precedence over order-level (100 × $7 = $700, not $300). Both were **confirmed to fail** against `ca6929c3~1` by reverting the fix and re-running (2 fail / 13 pass).

## Author's verification claims — reproduce or refute

- `bun test tests/broker-deal-commission-report.e2e.test.ts` → **15 pass, 0 fail**.
- Reverting only the rate-resolution expression → **13 pass, 2 fail** (the two new tests). Confirmed.
- `bunx tsc --noEmit` in `apps/api` → clean (baseline has 2 pre-existing errors in `payment-schedule.service.ts` in a stale tree; the current tree is clean).
- Production reproduction used a read-only local SSH tunnel to Moxie's DB and called the service function directly. No data was written to Moxie.
- Impact figures (`44,020.51 → 69,085.37`) measured by running the same function pre- and post-fix against that database.

## Mandatory review focus — attack these

1. **Is the precedence right, and is `!= null` the correct guard?** `order-financing.ts` uses `|| ` (falsy), which treats `0` as absent and falls through to the order rate. My code uses `!= null`, so a per-line rate of **`0`** now wins over a non-zero order rate. Which is correct? Is `commissionPerUnit = 0` a meaningful "this line earns no commission" signal that should override, or a data artefact that should fall through? **This is the change I am least certain about**, and it is the one place my logic deliberately differs from `order-financing.ts`.
2. **`NaN` propagation.** `parseFloat` on a non-numeric string yields `NaN`; `rate * qty` is then `NaN`; `commissionAmount.toFixed(2)` is `"NaN"`; `grandTotalCommission += NaN` poisons the **entire report total**. Pre-fix, a garbage per-line value would produce `NaN` too — so is this pre-existing? Does any writer allow a non-numeric `commissionPerUnit` (`sanitizeNumeric` at `orders.service.ts:2077` — does it guarantee a clean number or null)?
3. **Date-field fallback still uses `deliveredAt → eta` (configured), and the report may therefore include an order whose commission is not yet earned.** Frederik's example has `delivered_at` NULL and `eta` 2026-08-14, so it is included via fallback. Is including un-delivered deals correct for a commission report Moxie will invoice from?
4. **`quantity`, not delivered quantity.** The report multiplies `orderItems.quantity`. Frederik's business rule is "3 $/mt **leveret**" (delivered). An order partially delivered still commissions on the full quantity. Is this intended (raise with the customer) or a defect? `delivered_quantity` exists on `order_items` and is NULL for all of Moxie's broker items today.
5. **Unit conversion.** Design doc audit note M1 says unit conversion (e.g. GAL→MT) is **not implemented**; the report multiplies a raw quantity by a per-MT rate. Moxie has line items in `MT` and in `GAL`/`M3` historically. Does the fix's change of rate source make any unit mismatch worse, or is it orthogonal?
6. **Does the tenant-default branch ever get exercised in production, given the UI seeds the order rate on toggle?** If the UI always seeds, is the third fallback dead code that would silently mask a future rename regression the same way?
7. **Multi-line orders and the group-by.** A broker order with two lines (Moxie has orders with 350 MT + 40 MT, and 100 MT + 1 MT) now resolves a rate per line and sums. Any double-counting risk when an order-level rate applies to several lines (i.e. is summing per-line correct, vs quantity-summed × order rate)?
8. **Do the two new tests actually defend the change?** Would each fail against `ca6929c3~1` for the *right* reason (rate resolution), not incidentally?

## Platform facts

- Tests need `DATABASE_URL='postgres://fueld:fueld@localhost:5432/fueld_test'` and must be run **serially** (concurrent runs on that single DB give false failures — documented, pre-existing).
- `apps/api/tests/helpers/db.ts` runs the drizzle migrator then falls back to a hand-written compat shim.
- Elysia/TypeBox silently 422s bodies with undeclared fields.
- `order-financing.ts` is the sibling implementation of the same concept (broker-deal profit) and is the reference for precedence — but it uses `||`, not `!= null`.
- The report is consumed by the UI and by CSV/XLSX export (`brokerCommissionReportToCsv`) and by a "create commission order" flow (`createCommissionOrders`-style, `reports.service.ts:2571+`), which **creates real orders** from these totals. Money derived from this function becomes a real invoice — weigh severity accordingly.

## Output format

(1) Numbered findings: severity (CRITICAL/HIGH/MEDIUM/LOW/NIT), `file:line` at `ca6929c3`, one-line fix.
(2) Explicit answers to the 8 focus items above.
(3) What is done well (brief).
(4) Verified-by-reading vs unverifiable.
(5) Final line exactly `VERDICT: <ship-it | needs-fixes | blocked>` + 2-3 sentences.
