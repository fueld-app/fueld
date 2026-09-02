# Review — CREDIT_MANAGER reopen-order gate (Riviera Marine request)

**Date**: 2026-09-02
**Models**: DeepSeek-V4-Flash:cloud + Kimi-K3:cloud (Ollama Cloud API, curl)

**Change**: "Reopen Order" action (DELIVERED/INVOICED → CONFIRMED) previously ADMIN-only in
`header-actions.component.ts` (`canReopen`). Now: `canReopen = (isAdmin || isCreditManager) && (Delivered || Invoiced)`.
New `isCreditManager` input wired from `order-detail-page.component.html` via `auth.isCreditManager()`.

## DeepSeek-V4-Flash — APPROVED, no P0

P1 items referenced the pre-existing uncommitted `delete-order` work in the same file (out of scope for
this change). P2 style notes only.

## Kimi-K3 — P0 claimed (disproven)

Claimed: bundled `delete-order` feature has "no backend server-side guard" (CSRF/data-loss risk).
**Disproven**: (a) the delete-order feature is pre-existing uncommitted work from another session,
not part of this change; (b) the backend DELETE /orders/:id endpoint IS admin-gated — explicit
`auth.role !== 'ADMIN'` check plus tenant-ownership check (orders.controller.ts:1181-1193).

P1s:
- "Confirm all consumers pass isCreditManager" — only one consumer (order-detail-page.component.html), wired ✅.
- "No test for ADMIN+INVOICED" — VALID, test added (12/12 pass).
- Modal accessibility notes — pre-existing delete-order work, out of scope.

## Tests

`header-actions.component.spec.ts`: 12 pass / 0 fail, including new gating tests:
ADMIN+DELIVERED, ADMIN+INVOICED, CREDIT_MANAGER+DELIVERED, CREDIT_MANAGER+INVOICED,
trader-negative, CREDIT_MANAGER+CONFIRMED-negative.

## E2E verification (staging)

Created CREDITMANAGER test user (cmtest@fueld.app), logged in, opened DELIVERED order
20260510-000002: "Reopen Order" visible in Actions menu; clicking it flipped the order to
CONFIRMED with editable fields. Status restored to DELIVERED afterwards.
Screenshot: docs/deployment-logs/creditmanager-reopen-2026-09-02/creditmanager-reopen.png
