## P0 (Bugs / Security / Data Loss)

None.

## P1 (Logic Errors)

None.

## P2 (Minor)

1. **Potential CSS injection via fontFamily in signature builder** — The `fontFamily` value is escaped with `escapeHtml()` before being inserted into the `style` attribute, which handles HTML special characters. However, the value is inserted into a `style` attribute without quoting the value (e.g., `font-family: ${value};`). If a tenant sets a value containing `;` or `}` (e.g., `Arial; color: red`), it could inject additional CSS properties into the style attribute. While this is a tenant-only setting (not user-facing), it's worth considering quoting the value or validating it more strictly.

2. **Frontend placeholder mismatch** — The placeholder in the admin UI shows `Aptos, 'Segoe UI', Arial, sans-serif` but the helper text says "Empty = default ('Segoe UI', Arial)". The default constant is `'Segoe UI', Arial, sans-serif` (with `sans-serif`), so the helper text is slightly inaccurate.

3. **No max length validation on fontFamily** — The API accepts any string for `fontFamily` without length constraints. A very long value could bloat the email HTML. Consider adding a reasonable max length (e.g., 200 chars) to the schema validation.

## Verdict

**Approve** — The change is well-structured, maintains backward compatibility (default font preserved for tenants that don't set it), and includes appropriate test coverage. The minor issues noted are non-blocking and can be addressed in follow-up work.

---

## Executor disposition (2026-09-03)

- P2-1 (CSS injection): tenant-admin-only setting; maxLength 200 added; noted.
- P2-2 (helper text): fixed to match the default constant.
- P2-3 (maxLength): added in controller schema.

---

## Follow-up: teamView localStorage persistence (2026-09-03)

DeepSeek review of the teamView persistence diff: Approve, no P0/P1. P2-1 (unguarded
localStorage read in signal initializer) — applied: shared tryLocalStorageGet() helper,
used by BOTH teamView and dateBasis initializers. P2-2 (test cleanup) — beforeEach already
clears keys.
