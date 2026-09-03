## Code Review: Booking Email Signature + BCC Feature

### P0 (Bugs/Security/Data Loss)

**None found.**

---

### P1 (Logic Errors)

1. **`resolveSignatureFromEmail` now uses salesRep email but sender context lost**  
   In `composeBookingEmail`, the signature user is resolved via `resolveSignatureUser(order, senderInfo)` which prefers `order.salesRep`. The `fromEmail` is then resolved via `resolveSignatureFromEmail(order.tenantId, signatureUser)` where `signatureUser` is the salesRep. If the salesRep has no email but the original sender does, the fallback logic in `resolveSignatureFromEmail` may now fail or produce wrong results. The original sender's email should be passed as a fallback separately.

2. **`resolveSignatureUser` returns salesRep even when salesRep name is "N/A" or placeholder**  
   The check `order.salesRep?.name?.trim()` will pass for names like "Unassigned" or "TBD". If the order has a placeholder salesRep name, the signature will show that instead of the actual sender. Should check for meaningful names or add a flag.

---

### P2 (Minor)

1. **`buildBookingProductLinesHtml` doesn't handle empty `items` array consistently**  
   The function early-returns `''` for empty items which is fine, but the test `expect(lines).toContain('Product: LSMGO<br/>Qnty: 100 - 130 MT')` shows the `<br/>` is hardcoded as an HTML break. If the template is used in a plain-text email context, this could render literally. Consider using `\n` instead or document that it's HTML-only.

2. **The `bcc` field is only returned from `resolveBookingRecipients` but the auto-send path does not check if the BCC address is valid**  
   The admin form validates email format via `format: 'email'` schema, but there's no runtime check in `resolveBookingRecipients` before including it in the bcc array. If a malformed value slips in (e.g. via direct DB edit), it could cause email send failures.

3. **Frontend modal pre-fills BCC but does not allow user to modify it**  
   The modal pre-fills `bccEmails` but the `defaultBccEmails` mapping uses `label: null` which may display these as non-removable fixed entries. If the user tries to remove the BCC, it might not persist. Consider marking them as "locked" or allow removal with a warning.

4. **`getBookingEmailSettings()` is called twice in `resolveBookingRecipients` previously; now called once but only in that function**  
   In `composeBookingEmail`, `bookingSettings` is fetched separately for signature config. The `resolveBookingRecipients` also fetches it. Minor inefficiency; could pass settings as parameter.

5. **Test for `resolveSignatureUser` uses `as any` cast**  
   The test `const order = { ...baseOrder, salesRep: {...} } as any;` bypasses TypeScript checks. This is acceptable for unit tests but could hide type errors.

6. **No test added for the BCC inclusion in `resolveBookingRecipients`**  
   The new bcc logic has no test coverage. Recommend adding a test verifying `bcc` is populated from tenant settings.

---

### Verdict

**Approve with minor revisions.**

The changes are logically sound and the core functionality (signature user resolution, BCC, product lines) is well-implemented. The P1 issue around `resolveSignatureFromEmail` fallback deserves attention before deployment to avoid regression in email "from" handling. The P2 items are non-blocking cleanups. No P0 concerns found.

---

## Executor disposition (2026-09-03)

- **P1-1 (fromEmail fallback with salesRep)**: covered — resolveSignatureFromEmail's chain (signatureFromEmail → tenant shared-sender → signature-user email) doesn't depend on the sender, and contact fields now merge from sender (see deepseek disposition).
- **P1-2 (placeholder salesRep names)**: noted — salesRep values come from the users table (real accounts), no placeholder values in practice.
- **P2-1 (HTML-only productLines)**: by design; documented in TEMPLATE_VARIABLES.
- **P2-2/P2-3 (BCC validation/modal)**: admin input is email-validated; modal BCC remains user-editable (bccEmails is editable, defaultBccEmails just restores it).
- **P2-6 (BCC test)**: resolveBookingRecipients is DB-bound; covered indirectly by production E2E verification.
