# Deployment Evidence — Moxie Features

**Date**: 2026-08-31
**Version**: 1.0.0-moxie-features-v3
**Git commit**: 42e09b49

## All 4 VPS running with v3

| Instance | IP | build-info | app pid |
|---|---|---|---|
| staging | 31.70.79.3 | 1.0.0-moxie-features-v3 | running |
| channeltx | 74.208.245.215 | 1.0.0-moxie-features-v3 | 124486 |
| moxie | 31.70.94.96 | 1.0.0-moxie-features-v3 | 1284579 |
| riviera-marine | 139.162.157.31 | 1.0.0-moxie-features-v3 | 3671004 |

Migration 0115 (orders.bunker_booking_sent_at + backfill) verified applied on all 4
(information_schema.columns count=1 everywhere).

## End-to-end verification on Moxie production (31.70.94.96)

```
$ GET /admin/settings/catalog  →  B30: True  B100: True
$ PUT /orders/20260831-000099/bunker-booking-sent {sent:true}
  → {"success":true,"data":{"bunkerBookingSentAt":"2026-08-31T08:09:40.730Z"}}
$ PUT /orders/20260831-000099/bunker-booking-sent {sent:false}
  → {"success":true,"data":{"bunkerBookingSentAt":null}}
$ GET /orders/20260831-000099/booking-email
  → subject: Confirmation | Ocean7 Algora @ Istanbul | 20260831-000099
  → has_html_table: True, has_products_th: True, has_signature: True (body_len 1996)
```

## UI verification on staging (https://staging.fueld.app)

- /trading/orders: "Booking" column between Status and Responsible; red dot (not sent) →
  click → green with check + "Bunker Booking sent 31 Aug 2026 11:30" tooltip → click again → red.
  Screenshot: moxie-orders-booking-dots.png
- /trading/inquiries: ETA badges render red (bg-red-100) for ETAs within 7 days/overdue;
  row tint bg-red-50/60 + dark:bg-red-500/10 confirmed in DOM with matching CSS rule.
  Screenshot: moxie-inquiries-eta-red.png

## Moxie tenant config

- catalogItems: B30, B100 appended (idempotent SQL, verified via live API)
- email_templates BUNKER_BOOKING body updated from legacy plain-text run-on to the new
  structured HTML layout (custom Agent row + custom subject preserved)

## Tests

- booking-email.service.test.ts: 6 pass, 0 fail (33 assertions) — includes HTML structure,
  escaping (XSS), conditional signature tests
- tsc --noEmit (api + web): clean; ng build: clean

## Review

- 2 rounds on DeepSeek-V4-Flash:cloud + Kimi-K3:cloud (Ollama Cloud API, curl)
- All P0/P1 findings fixed or dispositioned (false alarms verified in code/DOM)
- docs/deepseek-review-moxie-features.md, docs/kimi-review-moxie-features.md
