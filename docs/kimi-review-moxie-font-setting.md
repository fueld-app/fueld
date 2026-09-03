## P0 (Bugs/Security/Data Loss)

None

## P1 (Logic Errors)

None

## P2 (Minor)

1. **Potential CSS injection via fontFamily in signature builder** — The `fontFamily` value is HTML-escaped but not CSS-escaped. While the value is inserted into a `style` attribute (which is safer than a `<style>` block), a malicious value like `Arial; background: url(...)` could inject additional CSS properties. This is low-risk since only admins can set this, but consider validating against a whitelist of allowed characters (letters, numbers, commas, spaces, quotes, hyphens).

2. **Inconsistent font application in custom templates** — The `fontFamily` variable is added to `buildBookingVars`, but custom body templates that don't use the default `DEFAULT_BODY` may not reference `${fontFamily}`. The font will only apply if the custom template explicitly includes it. This is acceptable behavior but worth documenting.

3. **Frontend placeholder mismatch** — The placeholder shows `Aptos, 'Segoe UI', Arial, sans-serif` but the helper text says "Empty = default ('Segoe UI', Arial)". The placeholder might mislead users into thinking Aptos is the default. Consider using the actual default as placeholder.

4. **No max length validation on fontFamily** — The API accepts any string length. A very long font stack could bloat email size. Consider adding a max length (e.g., 200 chars) to the schema validation.

## Verdict

**Approve** — The change is well-structured, backward-compatible (defaults preserve legacy behavior), and properly tested. The font flows correctly through the settings → compose → render pipeline. No P0 or P1 issues found. The P2 items are minor polish suggestions that don't block merge.

---

## Executor disposition (2026-09-03)

- P2-1 (CSS escaping): maxLength 200 + admin-only; accepted risk noted.
- P2-2 (custom templates must reference ${fontFamily}): documented — Moxie's stored template updated to reference ${fontFamily}.
- P2-3 (placeholder): helper text fixed; placeholder intentionally shows the Aptos example.
- P2-4 (maxLength): added (200).
