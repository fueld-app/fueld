# Review — Moxie Features (DeepSeek-V4-Flash:cloud)

**Date**: 2026-08-31
**Model**: deepseek-v4-flash:cloud (via Ollama Cloud API)
**Scope**: Bunker Booking email redesign, ETA red highlight, Sendt Bunker Booking indicator

## Round 1

### P0
- PUT /:id/bunker-booking-sent endpoint lacked tenant isolation — any authenticated user could modify any tenant's order flag. **FIXED**: tenant-scoped WHERE + 404 on not-found.

### P1
- customFields whole-object replace in updateOrder (pre-existing, out of this goal's scope)
- Fire-and-forget flag update after email send (not awaited). **FIXED**: now awaited.

## Round 2

### P0
- `dates` var not escaped in HTML body. **FIXED**: escaped.
- Latent: tenantId optional on setOrderBunkerBookingSent. **FIXED**: now required.

### P1 (dispositioned)
- Auto-send-on-convert flag update "not wrapped in try/catch" — FALSE ALARM: it sits inside the existing try/catch (verified in code).
- Silent flag-update failure in documents.controller after successful email — accepted: logged, low-impact (indicator stays red; user can manually toggle).

## Verdict
"All remaining issues are edge cases and error-handling gaps" — P0s fixed before deploy.
