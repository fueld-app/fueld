# ChannelTX Feature Requests — Priority Index

## Prioritization Rationale

Features are ranked by **business value × implementation feasibility**, with dependencies factored in. Each feature is independently tenant-gated (zero impact on other tenants).

## Priority Order

| Priority | Feature | File | Complexity | Est. Effort | Dependencies |
|----------|---------|------|------------|-------------|--------------|
| **P1** | 6. Upload Photos | [06-upload-photos.md](06-upload-photos.md) | Low | S | None |
| **P1** | 1. Sales Reporting by Product | [01-sales-reporting.md](01-sales-reporting.md) | Low | S | None |
| **P2** | 2. Comments Digest Email | [02-comments-digest.md](02-comments-digest.md) | Low-Med | M | None |
| **P2** | 7. Daily Pricing Email | [07-daily-pricing-email.md](07-daily-pricing-email.md) | Low-Med | M | None |
| **P2** | 4. QuickBooks Integration | [04-quickbooks-integration.md](04-quickbooks-integration.md) | Medium | M | Existing QB OAuth |
| **P3** | 5. Auto Service Report PDF | [05-service-report-pdf.md](05-service-report-pdf.md) | Medium | L | Feature 6 (photos) |
| **P3** | 3. OPS Board / Barge Schedule | [03-barge-schedule-board.md](03-barge-schedule-board.md) | **Highest** | XL | Schema changes + new UI |

## Effort Scale
- **S** = Small (1–3 days)
- **M** = Medium (3–7 days)
- **L** = Large (1–2 weeks)
- **XL** = Extra Large (2–4 weeks)

## Phase Plan

```
Phase 1 — Quick wins (parallel, no dependencies)
  ├── P1: Feature 6 — Upload Photos
  └── P1: Feature 1 — Sales Reporting

Phase 2 — Medium features (can overlap)
  ├── P2: Feature 2 — Comments Digest Email
  ├── P2: Feature 7 — Daily Pricing Email
  └── P2: Feature 4 — QuickBooks Integration

Phase 3 — Complex features (sequential due to dependency)
  ├── P3: Feature 5 — Service Report PDF  (needs Feature 6 first)
  └── P3: Feature 3 — Barge Schedule Board  (largest, independent)
```

## Gating Principle

Every feature is gated behind a new optional flag in `TenantSettings` JSONB (`tenants.settings`), following the existing `brokerDeals.enabled` / `whatsappEnabled` pattern. All flags default to `off` → **zero impact on other tenants**. Each can be independently enabled for ChannelTX.

## Open Questions

See [`../whatsapp-questions.md`](../whatsapp-questions.md) for the formatted WhatsApp message with clarifying questions for ChannelTX. Answers are needed before implementation of each feature.