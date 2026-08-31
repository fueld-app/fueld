# Review — Moxie Features (Kimi-K3:cloud)

**Date**: 2026-08-31
**Model**: kimi-k3:cloud (via Ollama Cloud API)
**Scope**: Bunker Booking email redesign, ETA red highlight, Sendt Bunker Booking indicator

## Round 1

### P0
1. "Missing migration orders.custom_fields" — FALSE ALARM: custom_fields exists in migration 0114 (already registered). Reviewer saw schema diff hunk from uncommitted earlier work without its migration.
2. HTML injection in booking email vars (only products escaped). **FIXED**: all text vars now HTML-escaped via buildBookingVars (plain vars for subject, escaped for body); unit test covers it.
3. Tenant isolation on toggle endpoint. **FIXED** (see DeepSeek).

### P1
- Fire-and-forget flag update. **FIXED**: awaited.
- ETA red on terminal statuses (whole delivered list would be red). **FIXED**: DELIVERED/INVOICED/PAID/CANCELLED/LOST excluded.
- Tailwind escaped classes `[class.bg-red-50\/60]` "likely don't resolve" — FALSE ALARM: verified in DOM on staging — rows carry `bg-red-50/60 dark:bg-red-500/10` and matching CSS rule exists.
- Saved column prefs hiding new columns. **FIXED** for Booking: one-time injection with `bookingInjected` marker (user can still deliberately hide it afterwards).

## Round 2

### P1 (dispositioned)
- `{{#if senderName}}` support — FALSE ALARM: renderTemplate supports `{{#if var}}...{{/if}}` (email-settings.service.ts:154-158); unit test "signature is omitted when no sender name provided" proves it.
- Custom columns (custom_*) not force-included in saved prefs — pre-existing issue from earlier custom-columns work, out of this goal's scope (noted as residual risk).
- columnOrder-driven hiding — FALSE ALARM: visibleColumns filters by visibleColumnFields (booking renders even if absent from saved order; sorts first via `?? 0`).

### P2 (noted)
- Legacy stored BUNKER_BOOKING templates in email_templates remain plain-text — handled operationally: Moxie's stored template updated to the new HTML layout post-deploy.
- tenantId optional — FIXED (required).
- No role check on toggle endpoint — intended: traders mark manual sends.

## Verdict
"Security fixes sound. No P0s." All P1s fixed or dispositioned as false alarms / out of scope.
