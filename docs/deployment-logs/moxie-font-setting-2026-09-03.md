# Booking-email font tenant setting — deployment 2026-09-03

**Version**: 1.0.0-moxie-font-setting (commit c0014460) — all 4 VPS verified.
**Review panel**: DeepSeek + Kimi — Approve, no P0/P1 (maxLength 200 + helper text applied).

## Summary
- `bookingEmail.fontFamily` tenant setting (nullable; default 'Segoe UI', Arial, sans-serif = legacy behavior).
- Flows via `${fontFamily}` template var (body container) + signature builder option — the stored custom template also uses the var, so changing the setting changes the rendered emails without touching the template.
- Editable in Admin → Email Settings (Font field).
- Moxie configured: `Aptos, 'Segoe UI', Arial, sans-serif`; verified live — composed booking email renders Aptos in body + signature.
