# Booking-email signatures + fra-til quantities — deployment 2026-09-03

**Version**: 1.0.0-moxie-signature (commit ef36a5a3)
**Deployed**: all 4 VPS (build-info verified); migration 0116 (users.skype/whatsapp) verified applied on moxie, riviera, staging; review panel docs in docs/*review-moxie-signature.md

## Moxie production configuration (SQL)
- Tenant bookingEmail settings: signatureLogoUrl=https://moxie.fueld.app/moxie-logo.png (200 OK, image/png), signatureWebsite=www.moxiebrokerage.com
- Stored BUNKER_BOOKING template updated: closing block now `{{#if signatureHtml}}${signatureHtml}{{/if}}`
- Daniel Kvist: phone=+45 30 497 777, skype=dkvist77 (m: +45 30 497 777 ◦ s: dkvist77 — matches his signature)
- Frederik Nissen: phone=+971 (0) 55 246 8292 (m: line), whatsapp=+45 60 48 26 16 — matches his signature

## E2E verification (live API, order 20260902-000107)
- Composed booking-email body contains: "Best regards," + Verdana signature table with bold name, e: link resolved via fallback chain (daniel@ = tenant shared-sender mailbox), w: https://www.moxiebrokerage.com
- fra-til quantities: VLSFO 220/min 180 → "180 - 220 MT"; LSMGO 130/min 100 → "100 - 130"
- Logo URL publicly reachable (200)
