# Moxie booking-email template v2 — deployment 2026-09-03

**Version**: 1.0.0-moxie-template2 (commit f954f9d6) — all 4 VPS, build-info verified.
**Review panel**: DeepSeek-V4-Flash + Kimi-K3 approved, no P0s (contact-field merge + font inheritance fixes applied) — docs/*review-moxie-template2.md

## Moxie production configuration (SQL)
- bookingEmail.bccEmail = happier@moxiebrokerage.com (always-BCC on booking emails)
- bookingEmail.brokerDealCcEmail = operations@ocean7projects.com (CC on broker deals)
- Stored BUNKER_BOOKING subject: `Bunker | ${vesselName} @ ${place} | ${orderNumber}`
- Stored BUNKER_BOOKING body: line-based Aptos layout per Frederik's spec (Dear Capt. / booked bunkers / Place / Date / Physical blank / Method / Product+Qnty lines / Agents wording / responsible-user signature)

## E2E verification (live compose API, order 20260902-000107)
- Subject: `Bunker | Atlantic Dawn @ Walvis Bay | 20260902-000107` ✓
- Preview bcc: ['happier@moxiebrokerage.com'] ✓
- Body: Aptos font, "Dear Capt.", "booked bunkers for your good lady", Place/Date lines, "Physical:" blank, Method, line-based "Product: VLSFO - 0.5%" / "Qnty: 180 - 220 MT" (fra-til), exact Agents wording ✓
- Signature: **Frederik Nissen** (order's responsible user) with m: +971 (0) 55 246 8292 / whatsapp: +45 60 48 26 16 — despite being composed by admin (responsible-user preference verified) ✓
