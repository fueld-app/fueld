## Code Review

### P0 (Bugs/Security/Data Loss)

**None found.**

---

### P1 (Logic Errors)

1. **`formatQty` min-only logic may produce incorrect output for non-stem orders**  
   In `booking-email.service.ts`, the new branch:
   ```ts
   if (min) return `${stripNum(min)} - ${stripNum(item.quantity)} ${unit}`;
   ```
   This assumes `quantity_min` is always a stem minimum and `quantity` is the target. However, for orders where `quantity_min` is set but `quantity_max` is not (e.g., a fixed quantity with a minimum tolerance), this will incorrectly render a range. The change summary says this is the Moxie pattern, but it's applied globally to all orders. Consider adding a flag or checking if the order is a stem order before applying this logic.

2. **`resolveSignatureFromEmail` uses `getBookingEmailSettings()` which queries the first tenant**  
   ```ts
   const { signatureFromEmail } = await getBookingEmailSettings();
   ```
   `getBookingEmailSettings()` does `db.query.tenants.findFirst()` — it doesn't filter by `tenantId`. If there are multiple tenants in the database, this could return the wrong tenant's settings. The function receives `tenantId` but only uses it for the fallback query. This is a pre-existing issue in `getBookingEmailSettings`, but the new code makes it more impactful since it's now used in the signature resolution path.

3. **Frontend `saveSignatureEdit` updates both `skype` and `whatsapp` from a single response**  
   ```ts
   this.users.update((list) =>
     list.map((u) => (u.id === userId ? { ...u, skype: res.data!.skype, whatsapp: res.data!.whatsapp } : u)),
   );
   ```
   The PATCH endpoints return only the updated field (`{ id, skype }` or `{ id, whatsapp }`), but the frontend spreads both `res.data.skype` and `res.data.whatsapp`. Since the response only contains one of them, the other will be `undefined`, overwriting the existing value with `undefined` in the UI. This will cause the other field to display as `—` until a page refresh.

---

### P2 (Minor)

1. **Migration 0114 is included in the diff but unrelated to the change summary**  
   The diff includes `0114_custom_columns.sql` (custom columns feature) which is not part of the Moxie signature/quantity change. This could be a merge artifact or accidental inclusion. Verify it's intended.

2. **`buildBookingSignatureHtml` website URL handling**  
   ```ts
   const site = website.replace(/^https?:\/\//, '');
   contactLines.push(`w: <a href="https://${escapeHtml(site)}" ...>`);
   ```
   If the website is `www.moxiebrokerage.com`, this becomes `https://www.moxiebrokerage.com` — fine. But if the admin enters `https://www.moxiebrokerage.com/path?query=1`, the `replace` only strips the protocol, and the `escapeHtml` on the full URL in the `href` could break the query string (e.g., `&` becomes `&amp;`). Minor, but could cause broken links.

3. **Frontend `saveSignatureSettings` doesn't handle errors**  
   The `catch` block is empty (`// silent`), so if the PUT fails, the user gets no feedback. The existing `saveBrokerDealCc` has the same pattern, so this is consistent, but still worth noting.

4. **`signatureFromEmail` fallback chain is not fully tested**  
   The tests cover the explicit `fromEmail` override and the user email fallback, but not the `microsoftSharedSenderEmail` fallback path. The logic in `resolveSignatureFromEmail` is untested.

5. **`buildBookingSignatureHtml` uses `escapeHtml` on the `href` attribute**  
   ```ts
   contactLines.push(`e: <a href="mailto:${escapeHtml(email)}" ...>`);
   ```
   `escapeHtml` escapes `&`, `<`, `>`, `"`, `'`. For a `mailto:` link, this is mostly fine, but if the email contains a `+` (e.g., `user+tag@example.com`), it's not escaped, which is correct. However, the `href` attribute should use `escapeHtml` for attribute context, which it does — just noting it's slightly over-escaped for URLs (e.g., `&` in query strings).

6. **Migration 0116 lacks a `DEFAULT` or `NOT NULL` constraint**  
   The columns are `text` nullable, which is fine, but the migration doesn't include a `--> statement-breakpoint` comment like other migrations in the file. Minor consistency issue.

---

### Verdict

**Approve with minor fixes.** The core logic is sound, HTML escaping is properly applied, and the feature matches the customer request. The P1 issues (global min-only quantity logic, tenant-scoped settings lookup, frontend state overwrite) should be addressed before production deployment, but none are critical security or data-loss issues.

---

## Executor disposition (2026-09-03)

- **P1-1 (global min-only range)**: see deepseek disposition — same stem semantics platform-wide (verified in prod data); min==quantity guard added.
- **P1-2 (findFirst)**: single-tenant-per-VPS deployment model; pre-existing pattern.
- **P1-3 (frontend field overwrite)**: VALID — fixed (field-specific update).
- **P2-1 (0114 in diff)**: intentional (never committed, applied everywhere).
- **P2-6 (statement-breakpoint)**: fixed — 0116 now has proper breakpoints between the two ALTERs.
- **P2-4 (shared-sender fallback untested)**: noted; resolveSignatureFromEmail covered indirectly; acceptable for scope.
