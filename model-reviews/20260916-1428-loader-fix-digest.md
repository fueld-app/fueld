# Panel digest — loader-fix 20260916-1428

## kimi-k3 (stop)

# Code Review: Supplier Credit-Note Loader Fix

## (a) Correctness vs stated intent

The core fix in `order-loader.service.ts` is **correct and on-target**: it restores `orderSuppliers`, `supplierCreditNotes`, `totalSupplierCredits`, `expectedSupplierCredits`, and `netProfitAfterCredits` to the order literal, which is exactly what the modal dropdown, credit-notes card, and P&L figures read. Defensive defaults (`?? []`, `?? '0.00'`) are appropriate and match the codebase's money-as-string convention. The `OrderDto` additions are optional fields, so list payloads that omit them remain valid.

**One type inconsistency:** the loader sets `netProfitAfterCredits: d.netProfitAfterCredits ?? null`, but `OrderDto.netProfitAfterCredits` is declared `?: string` (not `string | null`). Compare with `commissionPerMt`, whose DTO type is explicitly `string | null`. Under `strictNullChecks` this is a compile error if the loader result is typed as `OrderDto`; if it compiled because the literal is loosely typed, you've now got a runtime `null` where consumers expect `string | undefined` — `parseFloat(null)` → `NaN` in the P&L-after-credits figure is a realistic outcome. Fix one side: either `?? undefined` in the loader or `?: string | null` in the DTO.

**Unverifiable from the diff — confirm before sign-off:**
- `OrderSupplierDto` and `SupplierCreditNoteDto` must exist and be exported from `packages/types` (they're referenced but not added here).
- `totalSupplierCredits` and `expectedSupplierCredits` must already exist on `OrderDto` (only `netProfitAfterCredits` is visible in context). If they don't, the loader assigns undeclared fields.

## (b) Risks of what's left unhandled

**The `package.json` changes are unrelated to this fix and should not be in this changeset.** Six version bumps (`pi-subagents` 0.66→0.68, `pi-mcp-adapter` 2.33→2.34, `pi-web-access` 0.28→0.29, etc.) plus a **brand-new dependency** (`pi-browser-cdp-extension ^1.1.0`) have nothing to do with an empty dropdown in a credit-note modal. Shipping tooling churn inside a live production hotfix means: (1) the rollback surface for this fix is now entangled with unrelated upgrades — if you revert the fix you revert the bumps, and vice versa; (2) a new dependency's behavior is unvetted in this deploy. Split these into a separate PR.

## (c) Missed edge cases / failure modes

- **Lockfile:** no `package-lock.json`/`pnpm-lock.yaml` change is shown alongside `package.json`. If the lockfile wasn't regenerated, `npm ci` on the VPS or in CI will hard-fail on the mismatch. Verify.
- **Post-create refresh:** after a trader adds a credit note via the modal, does anything update `order().supplierCreditNotes`/`totalSupplierCredits`, or does the card stay stale until a full order reload? Not visible here — confirm the mutation path writes back through the loader/signal.
- **Backend shape drift:** the fix assumes the API payload `d` actually includes these fields (the bug report says it does). If any tenant backend is on an older build, the `?? []`/`?? '0.00'` defaults degrade gracefully — good — but the P&L figure will silently show `null`/NaN rather than an error. Acceptable, but note it.

## (d) Regression risks in operation

- **Round-trip contamination:** if any order-save/update path spreads `order()` into a PUT/POST body, the newly added `orderSuppliers`/`supplierCreditNotes` arrays will now be sent back to the server. Check the save service for mass-assignment or unexpected-field validation errors.
- The `null`-vs-`undefined` issue in (a) is the most likely runtime regression: any consumer doing string ops on `netProfitAfterCredits` without a null guard breaks on orders with no credits.
- New dependency `pi-browser-cdp-extension` is an unknown in production installs — install-time failure or postinstall scripts would break deploys on all 4 tenant VPS instances.

## (e) Verdict: **APPROVE-WITH-CHANGES**

The loader fix itself is right and solves Allan's reported bug. Required before merge/deploy continues:

1. **Revert the `package.json` changes** (all bumps + `pi-browser-cdp-extension`) into a separate PR; if they must land, include the regenerated lockfile in the same commit.
2. **Resolve the `netProfitAfterCredits` null/type mismatch** — change the loader to `?? undefined` or widen the DTO to `string | null`.
3. **Confirm `OrderSupplierDto`/`SupplierCreditNoteDto` exist and are exported**, and that `totalSupplierCredits`/`expectedSupplierCredits` are already declared on `OrderDto`.
4. **Verify the order-save path** does not spread `order()` into outbound payloads (or explicitly strips the new fields).
5. **Confirm the credit-note creation flow refreshes** `supplierCreditNotes`/`totalSupplierCredits` on `order()` so the card isn't stale after adding a note.

---

## glm-5.3 (stop)

# Review: Supplier credit-note fields pass-through fix (OrderLoaderService)

## (a) Correctness vs stated intent

**The core fix is correct.** `OrderLoaderService` (apps/web/src/app/features/trading/pages/order-detail/services/order-loader.service.ts) was rebuilding the order literal field-by-field and omitting the Phase 2 credit-note fields; adding `orderSuppliers`, `supplierCreditNotes`, `totalSupplierCredits`, `expectedSupplierCredits`, `netProfitAfterCredits` restores what the modal dropdown, credit-notes card, and P&L-after-credits figures read off `order()`. Defaults are sensible: `?? []` for arrays, `?? null` for `netProfitAfterCredits` (consistent with the existing `commissionPerMt ?? null` pattern).

Two correctness items I cannot verify from the diff and must be confirmed:

1. **Loader return type** — the diff doesn't touch the order model/interface the loader returns. Since this is deployed and presumably compiled, the fields were likely already declared but never populated (matching the symptom). Confirm this; if the model uses a loose type, add the declarations explicitly.
2. **DTO imports** — `packages/types/src/dto.ts` now references `OrderSupplierDto` and `SupplierCreditNoteDto`. Confirm both are defined/imported in that file (the diff context doesn't show it).

## (b) Risks / consequences

- **`package.json` changes are unrelated scope creep in a production hotfix.** Version bumps (`pi-extension` 0.27.12→0.27.15, `pi-agent-browser-native` 0.6.9→0.6.13, `pi-mcp-adapter`, `pi-subagents`, `pi-web-access`) plus a **brand-new dependency** (`pi-browser-cdp-extension@^1.1.0`) have nothing to do with the credit-note fix. These look like agent tooling that leaked into a deployable manifest.
- **No lockfile in the diff.** If the repo has `package-lock.json`/`pnpm-lock.yaml`, the bumps without a lockfile update mean either frozen-lockfile installs fail or non-frozen installs resolve differently per VPS — a reproducibility hazard across the 4 tenant instances.
- **Inconsistent money defaults**: `totalSupplierCredits`/`expectedSupplierCredits` default to `'0.00'` while `netProfitAfterCredits` defaults to `null`. If the backend omits these for legacy pre-Phase-2 orders, the card will show "0.00 credits" (implying computed zero) alongside a null net-profit. Confirm the P&L card handles that combination, or default all three consistently.

## (c) Missed edge cases / failure modes

- **Legacy orders**: pre-Phase-2 orders with no `orderSuppliers` payload will still show an empty dropdown — the fix can't conjure data, but the modal should distinguish "no supplier legs exist" from "fields failed to load" so Allan's report doesn't recur as a false bug.
- **Reference sharing**: `d.orderSuppliers`/`d.supplierCreditNotes` are passed by reference into the order object. If the modal or save flow mutates them in place, signal-based change detection may not fire, or stale arrays could persist after a refresh. Verify the save path re-fetches rather than mutates.
- **Dropdown ordering/filtering**: if the supplier-leg dropdown expects sorted legs (or only legs with quantities), pass-through alone may yield arbitrary order.

## (d) Regression potential

- The dependency bumps are the main regression vector in a web-only deploy: a new package plus five upgrades changes the install graph on all 4 VPS instances for zero benefit to this fix. If the web image build runs a plain install, transitives shift; if it runs frozen, it may fail outright.
- The DTO additions are optional fields — non-breaking for other consumers of `OrderDto`.
- The loader change is additive; existing fields untouched. Low regression risk from the actual fix.

## (e) Verdict

**APPROVE-WITH-CHANGES** — the fix itself is right and is working in production; the required changes are hygiene around it:

1. **Revert or split the `package.json` dependency changes out of this hotfix** (or, if intentionally bundled, ship the matching lockfile update and a justification for each bump, especially the new `pi-browser-cdp-extension`).
2. **Confirm `OrderSupplierDto`/`SupplierCreditNoteDto` are defined or imported in `packages/types/src/dto.ts`** and that the loader's return type declares the five new fields.
3. **Align the `null` vs `'0.00'` defaults** for `totalSupplierCredits`/`expectedSupplierCredits`/`netProfitAfterCredits` (or confirm the P&L card renders the mixed null/zero case correctly for legacy orders).
4. **Verify the credit-note save path re-fetches the order** rather than mutating the passed-by-reference arrays.

---

## deepseek-v4.1-flash (stop)

## Review: Supplier credit-note dropdown fix

### (a) Correctness vs stated intent

The core change in `apps/web/src/app/features/trading/pages/order-detail/services/order-loader.service.ts` is directionally correct: it passes `orderSuppliers`, `supplierCreditNotes`, `totalSupplierCredits`, `expectedSupplierCredits`, and `netProfitAfterCredits` from the order-detail payload `d` into the `order()` literal. If the backend order-detail response already contains these fields, this should restore the supplier-leg dropdown and the credit-note/P&L data for the modal.

However, the change is not self-consistent with `packages/types/src/dto.ts`:

- `OrderDto` only gains `orderSuppliers?: OrderSupplierDto[]` and `supplierCreditNotes?: SupplierCreditNoteDto[]`.
- The loader also assigns `totalSupplierCredits` and `expectedSupplierCredits`. If those properties are not already on `OrderDto`, this is a TypeScript excess-property/type error.
- `netProfitAfterCredits` is declared as `netProfitAfterCredits?: string;` in the visible DTO context, but the loader assigns `d.netProfitAfterCredits ?? null`. Under `strictNullChecks`, `null` is not assignable to `string | undefined`. This is a likely compile failure unless the DTO is actually `string | null` elsewhere.
- The new DTO fields reference `OrderSupplierDto` and `SupplierCreditNoteDto`; confirm both are imported/defined in `dto.ts`. The diff does not show import changes.

So the intent is addressed, but the type contract is incomplete/possibly broken.

### (b) Risks / consequences of unfixed or unhandled items

- If the DTO/type mismatch is real, the web build can fail or the service can be forced through `any`, losing type safety.
- If the backend order-detail endpoint does not actually return `orderSuppliers` or `supplierCreditNotes`, the `?? []` defaults will silently produce an empty dropdown again. The fix assumes the API payload is correct; that assumption should be verified against the real order-detail response.
- Passing `supplierCreditNotes` through to the client may expose credit-note data to any user who can load the order. Confirm this is authorized and intended, not just hidden by UI.
- The unrelated `package.json` changes are a significant risk: `@plannotator/pi-extension`, `pi-agent-browser-native`, `pi-mcp-adapter`, `pi-subagents`, `pi-web-access` version bumps, plus the new `pi-browser-cdp-extension`, have nothing to do with the supplier credit-note bug. They can introduce build/runtime regressions, dependency conflicts, or supply-chain exposure. No lockfile change is shown.

### (c) Missed edge cases / failure modes

- `d.orderSuppliers` / `d.supplierCreditNotes` being non-array values would not be corrected by `?? []`; they would pass through and potentially break consumers.
- Numeric `totalSupplierCredits` / `expectedSupplierCredits` from the API would violate the string DTO expectation.
- `netProfitAfterCredits` changing from `undefined` to `null` may alter UI fallback behavior if the P&L card distinguishes those values.
- Orders with no supplier legs now get `[]` rather than `undefined`; if the modal uses `undefined` to mean “not loaded” vs `[]` to mean “loaded but empty,” this could change loading/empty-state behavior.
- No test covers the mapping. A regression in `OrderLoaderService` could silently drop these fields again.

### (d) Regression risk in operation

- The `package.json` dependency changes are the main operational regression risk. They should not ride along with a production hotfix for a web-only deploy.
- If the lockfile is not updated consistently, `npm ci` / deploy installs may resolve different versions than expected.
- The `netProfitAfterCredits: d.netProfitAfterCredits ?? null` change can affect the P&L-after-credits display if the UI expects `undefined` or a string.
- Passing raw `d.orderSuppliers` and `d.supplierCreditNotes` without mapping may expose shape differences between API DTOs and the UI’s expected domain models.

### (e) Verdict

**APPROVE-WITH-CHANGES**

Required fixes before considering this clean:

1. **Remove/revert the unrelated `package.json` changes** from this fix: the `@plannotator/pi-extension`, `pi-agent-browser-native`, `pi-mcp-adapter`, `pi-subagents`, `pi-web-access` bumps and the new `pi-browser-cdp-extension`. If they are intentional, split them into a separate change with lockfile and justification.
2. **Align `OrderDto` and `OrderLoaderService` types**:
   - Add `totalSupplierCredits?: string;` and `expectedSupplierCredits?: string;` if missing.
   - Change `netProfitAfterCredits` to `string | null` or assign `?? undefined` instead of `?? null`.
   - Ensure `OrderSupplierDto` and `SupplierCreditNoteDto` are imported in `packages/types/src/dto.ts`.
3. **Verify the backend order-detail payload** actually includes `orderSuppliers`, `supplierCreditNotes`, `totalSupplierCredits`, `expectedSupplierCredits`, and `netProfitAfterCredits` with the expected shapes.
4. **Add a focused test** for `OrderLoaderService` mapping these fields, plus an e2e/component test that the “Add supplier credit note” modal dropdown populates for an order like `20260911-000522`.
5. **Confirm authorization/privacy** for exposing `supplierCreditNotes` in the client payload.

---

