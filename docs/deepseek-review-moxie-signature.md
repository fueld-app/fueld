## Code Review

### P0 (Bugs/Security/Data Loss)

**None found.**

---

### P1 (Logic Errors)

1. **`formatQty` min-only logic conflicts with existing behavior**  
   In `booking-email.service.ts`, the new branch `if (min) return ...` will now render `100 - 130 MT` for any order with `quantity_min` set, even when the original intent was to show just the single quantity. This changes behavior for all existing orders that have `quantity_min` but no `quantity_max` — not just the Moxie use case. If other tenants rely on the old single-quantity display, this is a regression. Consider making this opt-in via a tenant setting or checking a flag.

2. **`resolveSignatureFromEmail` ignores tenant ID in `getBookingEmailSettings`**  
   `getBookingEmailSettings()` uses `db.query.tenants.findFirst()` (no `where` clause), which returns the first tenant in the database. In a multi-tenant environment, this could return settings from the wrong tenant. The function receives `tenantId` but doesn't use it to filter. This is a pre-existing issue but now becomes more impactful since signature settings are tenant-specific.

3. **Frontend `saveSignatureEdit` updates both `skype` and `whatsapp` from a single response**  
   In `users-page.component.ts`, the PATCH response is typed as `{ id: string; skype: string | null; whatsapp: string | null }`, but the actual API returns only the updated field (e.g., `{ id, skype }` for a skype update). The frontend then does:
   ```ts
   list.map((u) => (u.id === userId ? { ...u, skype: res.data!.skype, whatsapp: res.data!.whatsapp } : u))
   ```
   This will set `whatsapp` to `undefined` (since `res.data.whatsapp` is not present) when updating skype, and vice versa. This could wipe out the other field in the UI state.

4. **`buildBookingSignatureHtml` website URL handling**  
   The code strips `http://` or `https://` from the website, then prepends `https://`. If the admin enters a URL like `ftp://example.com` or `www.example.com/path?query=1`, the stripping only handles `http(s)://`, so `ftp://` would remain and produce `https://ftp://example.com` — a broken link. Also, if the website contains a path (e.g., `www.moxie.com/about`), the `https://` prefix is added correctly, but the `escapeHtml` on the full URL could break the `href` attribute if the URL contains `&` (e.g., `?a=1&b=2` → `&amp;` in HTML, which is correct for display but the `href` would be `https://www.moxie.com/?a=1&amp;b=2` — the browser would interpret `&amp;` as `&`, so this is actually fine, but it's fragile).

5. **Migration 0114 is included in this diff but unrelated to the change**  
   The diff includes `0114_custom_columns.sql` which adds a `custom_fields` column to orders and seeds custom columns. This is unrelated to the signature feature and appears to be a merge artifact. If this migration hasn't been applied yet, it will run and could cause unexpected schema changes.

---

### P2 (Minor)

1. **`signatureFromEmail` fallback chain is not fully implemented**  
   The summary says: "Fallback chain for the e: line: signatureFromEmail → tenant microsoftSharedSenderEmail → user email." The code implements this, but the `resolveSignatureFromEmail` function catches all errors silently and falls back to sender email. If `getBookingEmailSettings()` throws (e.g., DB connection issue), the fallback works, but the error is swallowed — no logging. Consider logging for debugging.

2. **Frontend `saveSignatureSettings` doesn't handle API errors**  
   The `catch` block is empty (`// silent`). If the PUT fails, the user gets no feedback. The existing `saveBrokerDealCc` has the same pattern, so this is consistent, but still a UX gap.

3. **`buildBookingSignatureHtml` uses `width="220"` on the logo image**  
   This is a fixed pixel width. If the logo is a high-DPI image, it will be scaled down. Consider using `max-width: 100%` and `height: auto` for better responsiveness.

4. **`escapeHtml` on `mailto:` href**  
   The email is escaped for both the `href` and the display text. If the email contains special characters (e.g., `+` for subaddressing), the `mailto:` link might not work correctly. Email addresses are generally safe, but this is worth noting.

5. **`formatQty` test for min-only case is missing a test for `quantityMax` being null but `quantityMin` being set**  
   The test covers `quantityMin` + `quantity` but not the case where `quantityMax` is explicitly `null` (which is the actual condition in the code). The test uses `quantityMax: undefined` implicitly, which is fine, but a more explicit test would be clearer.

6. **Migration 0116 lacks a `NOT NULL` constraint or default**  
   The columns are added as nullable text, which is correct for optional fields. However, the migration doesn't include a `DEFAULT NULL` clause — this is fine since nullable columns default to NULL, but it's worth noting for consistency.

7. **Frontend `editingSignatureValue` is a plain property, not a signal**  
   The existing `editingPhoneValue` follows the same pattern, so this is consistent. However, using a signal would be more idiomatic with the rest of the component.

---

### Verdict

**Approve with changes.** The core feature is well-implemented with proper HTML escaping and fallback logic. However, the P1 issues need attention:

- **P1-1** (formatQty regression) is the most critical — it changes behavior for all tenants, not just Moxie.
- **P1-3** (frontend state corruption) is a real bug that could wipe out user data in the UI.
- **P1-2** (tenant isolation) is a pre-existing issue but becomes more impactful with this change.

The migration 0114 inclusion (P1-5) should be removed from this change if it's not intended.

---

## Executor disposition (2026-09-03)

- **P1-1 (formatQty min-only global change)**: Kept global — `quantity_min` has the same semantics platform-wide (stem minimum ≤ target quantity; verified Riviera has 23 and ChannelTX 2 min-only items, all stems). Displaying "min - quantity" is the correct fra-til rendering for all tenants, which is what the customer asked for. Added guard: min == quantity → single value (Riviera has one such item, "400 - 400 MT" would be degenerate). No tenant stores quantity_min with a different meaning.
- **P1-2 (getBookingEmailSettings findFirst without tenant filter)**: Pre-existing pattern across settings.service — each VPS hosts exactly one tenant (per-VPS single-tenant deployment model), so findFirst cannot cross tenants. Not changed in this diff.
- **P1-3 (frontend overwrites other signature field with undefined)**: VALID — fixed. Now updates only the edited field from the PATCH response.
- **P1-4 (website ftp:// edge)**: Noted; website is admin-entered display text, ftp:// is a non-scenario. Skipped.
- **P1-5 (migration 0114 inclusion)**: Intentional — 0114 was applied to all production DBs during the Moxie custom-columns work but never committed to git; committing it now prevents schema/file drift.
- **P2s**: consistent with existing patterns (silent catch in email-settings page matches saveBrokerDealCc; editingPhoneValue pattern followed for consistency).
