# Dashboard date-basis deployment — 2026-09-03

**Version**: 1.0.0-dashboard-datebasis (commit 00403719)
**Deployed to**: staging (31.70.79.3), channeltx (74.208.245.215), moxie (31.70.94.96), riviera-marine (139.162.157.31) — build-info.json verified on all 4; `dateBasis` gating string present in deployed web bundles on all 4.

## E2E verification on Riviera Marine production

Method: temporary admin test user (`datebasistest@fueld.app`, deleted after verification incl. activity_logs cleanup), real browser login at riviera-marine.fueld.app/dashboard, Team View mode.

| Basis | Total Orders | Total Revenue | Notes |
|---|---|---|---|
| Delivery (new default) | 6 | $1,351,744.34 | Includes orders created Aug 25–28 with ETAs Sep 1–3 (the orders Hisham reported missing) |
| Created (toggle) | 5 | $471,463.30 | Matches the original dashboard screenshot exactly ($94,292.66 avg) |

- Toggle visible next to timespan picker; aria-checked switches; localStorage key `fueld.dashboard.dateBasis` persisted on toggle.
- Direct DB cross-check: `COALESCE(delivered_at, eta)` in Sep 1–30 = 13 orders (13 CONFIRMED w/ ETA); API `/dashboard/pipeline?dateBasis=delivery` returns 13 CONFIRMED ✓.
- API fallback: `dateBasis=bogus` → legacy created behavior ✓.
- Note: "My Orders" mode (default) filters KPIs to the current user — pre-existing behavior; numbers above use Team View.

## Files
- riviera-dashboard-verification.png — Created basis, Team View (matches original screenshot numbers)
- riviera-dashboard-delivery.png — Delivery basis default state
