## Code Review Findings

### P0 — Critical Bugs/Security/Data Loss
None found.

---

### P1 — Logic Errors

1. **`resolveSignatureUser` fallback hides sender email/contact when salesRep exists but lacks contact details**  
   `apps/api/src/modules/documents/booking-email.service.ts`  
   When `order.salesRep` has a name but `phone`, `skype`, `whatsapp` are all null, the signature block will render with just the name and no contact lines. The previous behavior would have shown the sender's full contact details. This could result in an incomplete signature for orders where salesRep is set but contact info isn't populated. Consider merging: if salesRep exists, use salesRep name but fall back to sender's contact fields when salesRep's are null.

2. **`resolveBookingRecipients` now fetches settings on every call — potential race/performance**  
   `apps/api/src/modules/documents/booking-email.service.ts` moves the `getBookingEmailSettings()` call to the top of the function, but the compose function also calls it separately. This means two DB/queries per email compose. Not a functional bug but unnecessary double-fetch. Could be optimized by passing settings through.

3. **`productLines` built but not added to `plain` template vars**  
   `apps/api/src/modules/documents/booking-email.service.ts` — `buildBookingVars` adds `productLines` only to the `html` record, not the `plain` record. If a tenant's template uses `productLines` in a plain-text context (e.g. `text/plain` email body or subject), it will resolve to empty. The existing `products` var is also HTML-only, so this is consistent, but worth noting.

---

### P2 — Minor Issues

1. **Test for `resolveSignatureUser` doesn't verify contact fallback behavior**  
   `apps/api/src/modules/documents/booking-email.service.test.ts` — Tests only verify name resolution, not the contact-field fallback scenario described in P1-1.

2. **Frontend BCC pre-fill uses `defaultBccEmails` with label object**  
   `apps/web/src/app/features/trading/pages/order-detail/services/order-communication.service.ts` — The `defaultBccEmails` is set from `d.bcc` but the `showWith` method previously used `bccEmails` as plain strings. The `.map((email) => ({ email, label: null }))` creates label objects — verify the modal expects this shape. If `bccEmails` and `defaultBccEmails` have different types, this could cause the pre-filled BCC to not render correctly.

3. **API contract mismatch on older clients**  
   `apps/api/src/modules/documents/documents.controller.ts` — The compose endpoint now returns `bcc` in the response. If any older frontend deployments (before this change) hit this endpoint, they'll ignore the extra field (harmless), but if the type contract was strict it could break. Not an issue in practice.

4. **`productLines` variable documented in admin but not shown in TEMPLATE_VARIABLES example**  
   `apps/api/src/modules/admin/email-settings.service.ts` — The example for `productLines` (`'Product: VLSFO 0.5% - desc'`) doesn't match the actual output format (which includes both `Product:` and `Qnty:` lines). Minor documentation clarity issue.

5. **Signature font change not applied to `buildBookingSignatureHtml`**  
   The diff mentions "Signature block font no longer hardcodes Verdana (inherits container)" but no changes are shown to the signature builder function. If the hardcoded font is still present in the actual service code (not shown in diff), the change summary may be inaccurate.

---

### Verdict

**Approve with minor fixes.** No P0 issues. The P1-1 (signature contact fallback) should be addressed — it's a real user-facing behavior gap. P1-2 (double settings fetch) is a performance nit. Everything else is cosmetic or documentation. The feature logic is sound and test coverage is reasonable for the new logic.

---

## Executor disposition (2026-09-03)

- **P1-1 (signature contact fallback)**: VALID — fixed. resolveSignatureUser now merges per-field (salesRep name wins; phone/skype/whatsapp/email fall back to sender when the rep hasn't populated them). Test added.
- **P1-2 (double settings fetch)**: noted — two lightweight queries per compose; acceptable.
- **P1-3 (productLines html-only)**: by design — consistent with `products`; emails are HTML.
- **P2-5 (Verdana hardcode)**: VALID — fixed, signature table now inherits container font (Aptos).
- **P2-4 (doc example)**: simplified.
