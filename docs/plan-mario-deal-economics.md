# Plan: Deal Economics & Historical Performance (Mario's spreadsheets → Fueld)

## Investigation summary

Mario Pellegrini (Riviera Marine) tracks the business in two legacy .xls workbooks (in use since 2018):

### 1. "DEALS DELLA RM" — the deal ledger (one row per deal)
Columns: Trader (initials) | Ref nr (SO number) | Vessel | DPT (SPOT/MILITARY/...) | Port | Customer | Date | Product | Unit | Qty | M.Ton (unit→MT conversion) | Buy price | Selling price | GM before commission | Tpc mt (third-party commission) | Tpc Tot | Brok MT | Brok Tot | Margin MT | Exch. rate | **Total Profit** | **Total Invoice** | Invoice nr | Due date.
- Bottom-of-sheet monthly totals: profit + turnover for the month.
- "Annexe" sheet: per-trader commission % (different for SPOT vs MILITARY deals) + unit→MT conversion coefficients (CBM 0.84, BBL 0.134, USG 0.004, …).

### 2. "RM MEDIA GRAFICO" — historical performance charts
- **RM G.O.M.** (Graphic Of Month): monthly *profit* per year, 2015→2030, feeding a line chart.
- **RM Turnover**: monthly *turnover* (invoiced value) per year, 2016→2030, feeding a line chart.
- Used to see seasonality and year-over-year performance at a glance.

### What Fueld already has (no need to build)
- Order = deal (orderNumber, vessel, port, client, salesRep = trader, product items).
- `orderItems` already stores costPrice, salesPrice, units, **unit conversion factors**, currency.
- `order-financing.ts` computes cost base, revenue base, gross profit, financing cost per order — already used by the dashboard.
- Orders list has gross/financing/net columns (price-privileged users) and invoices with amounts/due dates.
- Dashboard date basis (created/delivery) + full-month presets (incl. Previous/Next Month).

### Gaps to close
| Mario's sheet | Fueld gap |
|---|---|
| Broker commission % per trader (SPOT vs MILITARY) | Not modeled anywhere |
| Third-party commission per deal | Not modeled |
| Monthly **profit** + **turnover** historical series (multi-year chart) | Dashboard shows aggregates, but no year-over-year monthly series chart |

---

## Implementation plan

### Phase 1 — Trader commission config (the "Annexe")
- **Tenant setting** `commissions`: `[{ userId, spotPct, contractPct }]` (per-user, matching salesRep = trader). Admin UI on the users page or a small panel in Settings → Sales.
- Rationale for a setting (not a table): small N (≤ 10 traders), edited rarely, already the pattern for bookingEmail etc.
- DPT (SPOT/MILITARY/…) → new `orders.dealType` enum (`SPOT`, `CONTRACT`, `OTHER`), default OTHER (commission % 0 unless configured).

### Phase 2 — Commissions on deals
- `orderItems.commission` is per-line; Mario's model applies commission on the whole deal. Simplest faithful model:
  - `orders.brokerCommissionPct` (nullable, pre-filled from the salesRep's configured % when dealType is set),
  - `orders.thirdPartyCommissionMt` + `orders.thirdPartyCommissionPct` (nullable) — his sheet supports both per-MT and total.
- Extend `calculateOrderEconomics()` to deduct commissions: net profit = gross − broker − third-party − financing (financing already exists).
- Orders list "Net" column already exists — it will simply include commissions once economics are extended.

### Phase 3 — Historical performance charts (the "MEDIA GRAFICO")
- New API endpoint `GET /dashboard/monthly-history?metric=profit|turnover&from=2016&to=current`:
  - one row per calendar month, value in tenant base currency,
  - profit basis = confirmed-or-later orders, delivery basis = COALESCE(delivered_at, eta) (same semantics as the existing dashboard dateBasis),
  - turnover basis = invoiced amounts (from invoices table).
- Frontend: a "Performance" tab/section on the dashboard with a multi-year line chart (profit & turnover), years as series (mirrors his G.O.M. layout), hover tooltips per month.
- Data volume: ~60–170 deals/yr × 10 years — trivially small; compute on the fly, no caching needed initially.

### Phase 4 — Verification
- Backtest: import/compare against "DEALS DELLA RM 08 AUGUST 2026.xls" — per-deal Total Profit and monthly totals must match the sheet within rounding.
- Panel review per phase; E2E on Riviera staging with Mario's numbers.

### Open questions for Mario / Patrick
1. Should commission % default from the trader's config automatically, or always be manually editable per deal?
2. Does he want the *historical* sheets (2015–2025) migrated into Fueld, or start tracking from go-live? (A one-time import script could parse the .xls files.)
3. Multi-currency: his sheet uses one exchange-rate column per deal — Fueld items already carry per-line currency; confirm which base currency to report in (EUR? USD?).
4. Is "turnover" = invoiced amounts (including VAT?) or the gross order value?
---

## Panel review (DeepSeek-V4-Flash + Kimi-K3, 2026-09-03) — Conditional go

Both reviewers approved the phasing but flagged material corrections, incorporated below:

### Resolved by review (plan updated)
1. **Commission naming was wrong (DeepSeek P0, Kimi P1)** — the Annexe per-trader % is almost certainly the **trader's own commission** (internal comp), not "broker". Mario's sheet has *three* commission concepts: Tpc (third-party, per-MT rate × MT), Brok (per-MT rate × MT), and trader %. Phase 2 is **gated on clarifying with Mario**: which % is which, and the calculation base (margin/revenue/revenue−financing). Renamed accordingly in Phase 1/2.
2. **Historical data must be committed, not optional (DeepSeek P0, Kimi P1)** — but do **not** import 10 years as orders. Add a small `dashboardMonthlyHistory` table (`year, month, profit, turnover, source='IMPORT'|'LIVE'`) populated one-time by parsing the .xls workbooks (~monthly files since 2015); the history endpoint unions IMPORT rows with LIVE aggregates.
3. **Backtest target corrected (Kimi)** — Mario's "Total Profit" = (margin − commissions) × MT × FX, **no financing term**. Backtest compares gross − commissions (pre-financing). Sample 2–3 months covering MILITARY deals, CBM/BBL/USG conversions, and multi-currency deals; reconcile bottom-of-sheet monthly totals too.
4. **FX policy pinned before Phase 3 (Kimi)** — base currency, rate source, rate date, rounding points.
5. **Authorization (Kimi)** — commission % is compensation data: guard the settings panel and per-deal fields behind price-privileged/admin; the monthly-history endpoint reuses the price-privileged guard.
6. **Terminology kept (Kimi)** — dealType uses Mario's vocabulary (SPOT / MILITARY / …) as a tenant-configurable list, not a hardcoded SPOT|CONTRACT|OTHER enum; raw DPT string kept for audit.
7. **Chart UX (Kimi)** — default to last 3–4 years + year selector, not 15 series on one chart.

### Revised phase gates
- **Phase 1 (now)**: dealType (tenant-configurable list) + trader-commission config (tenant settings JSON, admin-guarded). No economics changes — safe to build.
- **Phase 2 (gated on Mario)**: per-deal commission fields with snapshot-at-close + explicit calc base; commission payout report per trader if wanted.
- **Phase 3 (gated on Q2–Q4 + FX)**: monthly-history endpoint + Performance chart + one-time .xls import into `dashboardMonthlyHistory`.
- **Phase 4**: backtest vs sheet (gross − commissions pre-financing), multi-month sample + monthly totals.

### Questions for Mario (blocking Phases 2–3)
1. The Annexe % — is that the trader's own commission (paid to him), and what is it calculated on: margin, revenue, or profit?
2. "Tpc" and "Brok" — who are these two parties, and both are €/MT rates (not %)?
3. Turnover = invoiced amounts incl. VAT, or gross order value?
4. Which base currency for reporting, and which FX rate/date per deal?
5. Should 2015–2025 history appear on the charts (one-time .xls import)?
