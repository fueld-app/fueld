# Feature 7: Daily Pricing Email for Fuel Dock

**Priority:** P2 · **Complexity:** Low-Med · **Effort:** M (3–7 days) · **Dependencies:** None

## Request

Daily pricing email sent out every morning from the system. Once an order is delivered, pricing from the date of delivery is applied. Strictly for CMF FUEL DOCK (posted price). Currently sent manually via email.

## Existing Infrastructure

| Component | Location | Notes |
|-----------|----------|-------|
| Scheduled Reports | `runDueReportSchedules` / `startReportsScheduleJob` | Hourly cron — proven pattern for time-based email delivery |
| Mail Service | `modules/documents/mail.service.ts` (773L) | Sends emails via Microsoft Graph or SMTP |
| Price Service | `modules/prices/price.service.ts` (849L) | Commodity prices, FX rates, Platts reports |
| Order Data | `orders` table | `deliveredAt`, `placeId` (dock/location), `status` |
| Order Items | `orderItems` table | `productType`, `salesPrice`, `unit` — the actual delivered prices |
| Places | `places` table | Location/dock data — can identify CMF FUEL DOCK |

## Gap

No "daily pricing email" feature. The current price service tracks commodity **market prices** (Platts, Brent), not customer-facing **posted prices** for a fuel dock. The posted prices come from delivered order items' `salesPrice`.

## Implementation

### Backend
1. Add `buildDailyPricingEmail()` function:
   - Query delivered orders (`status = 'DELIVERED'` or `deliveredAt` within lookback window) for a specific `placeId` (CMF FUEL DOCK)
   - Extract `orderItems.productType`, `orderItems.salesPrice`, `orderItems.unit` from delivered orders
   - Group by product type, showing the latest delivered price per product
   - Format as HTML email with posted price table
2. Add to the existing scheduled delivery system:
   - New schedule type in `runDueReportSchedules` (or a parallel cron)
   - Check `hourUtc` against current UTC hour
   - Send via `mail.service.ts` (Graph or SMTP)
3. Add API endpoints:
   - `GET /reports/daily-pricing/preview` — preview the email content for a given place + date
   - `POST /reports/daily-pricing/send` — manually trigger the email (for testing)
4. Configuration in admin settings

### Frontend
1. Add "Daily Pricing Email" settings panel in admin (under notifications or "Daily Emails"):
   - Select dock/location (dropdown of places)
   - Set send time (hour UTC)
   - Configure recipient emails
   - Set lookback window (default 24h)
   - Filter products (optional)
   - Custom email subject
2. Add preview button — shows what the email will look like with current data
3. Show last sent timestamp + status

### Email Format

```
Subject: CMF Fuel Dock — Posted Prices for [Date]

Posted Prices — [Date]
━━━━━━━━━━━━━━━━━━━━━━━━━
Product          | Price     | Unit
─────────────────────────────
LSMGO            | $3.45     | GAL
ULSD             | $3.20     | GAL
VLSFO            | $680.00   | MT
...
━━━━━━━━━━━━━━━━━━━━━━━━━

Prices based on deliveries completed on [Date].
```

### Schema Changes
**None** — all data already exists in `orders`, `orderItems`, and `places`.

### TenantSettings Flag

```typescript
dailyPricingEmail?: {
  enabled: boolean;
  placeId: string;               // which dock/location (CMF FUEL DOCK)
  hourUtc: number;               // when to send (e.g., 13 = 8am CST)
  recipientEmails: string[];
  lookbackHours?: number;        // default 24
  includeProducts?: string[];    // null = all
  emailSubject?: string;         // custom subject line
  emailTemplate?: string;        // custom HTML template (optional)
};
```

## Questions for ChannelTX

- This is for the CMF Fuel Dock posted price — should it show prices for all products or specific ones?
- "Once an order is delivered the pricing from the date of delivery is applied" — does the email show the previous day's delivered prices?
- Who receives this email — customers, internal team, or both?
- Do you have an example of the current email format you can share?
- Is this a single posted price list (same for all customers) or customer-specific pricing?