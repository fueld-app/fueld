# REVIEW — INSTRUCTIONS

You have NO tools, no filesystem, no repository access. Everything is in this payload. Reason over the text only.

Deliver findings as MUST/SHOULD with file/symbol references, any disagreement, and a verdict (APPROVE / APPROVE-WITH-CONDITIONS / NO-GO). Terse, evidence-first; quote the line you rely on.

# ROUND 2 of a payment-cap fix

Round 1 came back NO-GO from two reviewers. Those findings were accepted and are fixed below — check the fixes rather than re-raising them. **Note on round 1's payload:** its diff was captured BEFORE the final edit, so one reviewer correctly concluded the documented `payable > 0` guard was missing when the code did have it. This payload's diff is regenerated from the current tree.

## The reported bug (customer)

> "We clear the invoice as paid, but it does not credit the value back to the client's credit line. I.e. STS pays 152K, we clear the invoice, it does not free up the same value."
> "Also when you process payment the system requires you to mark paid 2x to be able to move to paid."

## Verified against production (channeltx)

Order `20260706-000129`, line `7500 MT ordered / 7382 MT DELIVERED @ 4.6925`: ordered basis 35,193.75, delivered basis 34,694.66 (what the UI showed). TWO payment rows, same amount, same received_at, 62 seconds apart; order went PAID 4 seconds after the second; the page read "Total paid: 69,389.32" against a 34,694.66 receivable.

## Round 1 findings, all fixed here
1. **`due <= 0 → true` conflated "nothing owed" with "cannot tell"** → `amountDue` is now REQUIRED on `OrderDto`, and the gate treats missing/non-finite as refuse (false) while an explicit 0 allows.
2. **`sumOrderPayments` ignored currency** → it now takes an optional currency; the cap sums payments in the INCOMING payment's currency, so a payment is never judged against a payable in a different denomination and the message states a figure in the right denomination.
3. **Invoice-only precedence blocked prepayment of a partially invoiced order** → `orderPayableBase` now returns `max(invoiced, lineTotal)`: both are real claims, and taking one alone was wrong either way.
4. **`computeInvoiceAmount` throws on mixed-currency lines and propagated** → guarded: it is a data problem that makes the order uninvoiceable, not something a payment should turn into a 500. Falls back to the invoice total, else 0.
5. **Check-then-insert was not a control** → the cap and the insert are now ONE transaction taking `SELECT … FOR UPDATE` on the order row, so two concurrent posts cannot both pass.

## Unchanged design
Only enforced when `payable > 0`: an order with no issued invoice and no priced lines has payable 0, and a deposit against a deal being built is a real workflow (`orders.service.edges` pins it). The modal's `submit()` returns early while saving.

# Scrutinise hardest
1. Does the transaction actually close the race — is `FOR UPDATE` on the order row sufficient, and is the re-read inside the lock the right data?
2. `max(invoiced, lines)`: any workflow where it still picks the wrong basis (credit notes, a split order whose tranches sum below the lines, a discounted deal, a void-heavy history)?
3. Currency: is currency-scoping the payments correct, or does the UI's un-scoped "Total paid" now disagree with the cap in a way that confuses the operator?
4. The web gate's missing-vs-zero treatment: any remaining path to marking an unpaid order paid?
5. `amountDue` costs up to 4 extra queries per `getOrderById`. Acceptable?


# Appendix A — orders.service.ts (diff, CURRENT)

```diff
diff --git a/apps/api/src/modules/orders/orders.service.ts b/apps/api/src/modules/orders/orders.service.ts
index 5efaf03f..c4154763 100644
--- a/apps/api/src/modules/orders/orders.service.ts
+++ b/apps/api/src/modules/orders/orders.service.ts
@@ -4,7 +4,7 @@
 //  An "inquiry" is simply an order with status INQUIRY or OFFER.
 // ═══════════════════════════════════════════════════════════════════════
 
-import { eq, and, desc, asc, sql, ilike, inArray, or, isNull, gte, lte } from 'drizzle-orm';
+import { eq, and, desc, asc, sql, ilike, inArray, notInArray, or, isNull, gte, lte } from 'drizzle-orm';
 import { alias } from 'drizzle-orm/pg-core';
 import { isCommissionableLine } from '@fueld/types';
 import { db } from '../../db';
@@ -22,6 +22,7 @@ import {
   tenants,
   customerPayments,
   supplierPayments,
+  invoices,
   companyContacts,
   priceReferences,
   creditLines,
@@ -30,6 +31,7 @@ import {
 import type { Order, TenantSettings } from '../../db/schema';
 import { logActivity } from '../activity/activity.service';
 import { recomputeInvoiceAmountPaid, resolvePaymentInvoiceTarget } from './invoice.service';
+import { computeInvoiceAmount } from './invoice-amounts';
 import { checkCreditAvailability } from '../credit/credit.service';
 import { sendTemplatedGroupMessage, buildProductTemplateVariables } from '../whatsapp/whatsapp.service';
 import {
@@ -1594,8 +1596,28 @@ export async function getOrderById(idOrNumber: string) {
 
   const deliveredAtIso = deriveOrderDeliveredAtIso(row.deliveredAt ?? null, orderSupplierRows);
 
+  /**
+   * What the customer still owes on this order, computed ONCE on the server.
+   *
+   * The page used to derive its own "total due" from the item rows, which are
+   * empty once the order is completed — so its mark-as-paid guard compared against
+   * 0, silently disabled itself, and the operator was told to pay an order that
+   * was already settled. Serving the figure keeps the button, the payment cap and
+   * the invoice on one arithmetic.
+   */
+  /**
+   * A payment's currency, for the balance shown. Payments in other currencies are
+   * not netted (that needs an FX rate); the page shows the order-currency balance,
+   * which is the figure its payment modal and the cap both use.
+   */
+  const orderAmountDue = (Math.max(
+    (await orderPayableBase(row.id)) - (await sumOrderPayments(row.id, row.currency)),
+    0,
+  )).toFixed(2);
+
   return {
     ...row,
+    amountDue: orderAmountDue,
     orderNumber: row.orderNumber,
     eta: row.eta?.toISOString() ?? null,
     etd: row.etd?.toISOString() ?? null,
@@ -2345,6 +2367,89 @@ export async function listOrderPayments(orderId: string) {
   });
 }
 
+/**
+ * A user-fixable payment problem (over the outstanding balance). The route maps it
+ * to a 400 with the message, the way the supplier-receipt ledger does, so the
+ * operator is told why instead of seeing a generic failure.
+ */
+export class OrderPaymentError extends Error {
+  constructor(message: string) {
+    super(message);
+    this.name = 'OrderPaymentError';
+  }
+}
+
+/**
+ * Payments already received on an order.
+ *
+ * Summed from the rows, not read from a cached column, so the cap cannot be
+ * defeated by a stale total — the same reasoning as the invoice's received
+ * figure.
+ */
+export async function sumOrderPayments(
+  orderId: string,
+  currency?: string,
+  /** Run inside a caller's transaction (the payment cap locks the order first). */
+  executor: { select: typeof db.select } = db,
+): Promise<number> {
+  const [row] = await executor
+    .select({ total: sql<string>`COALESCE(SUM(${customerPayments.amount}::numeric), 0)::text` })
+    .from(customerPayments)
+    .where(and(
+      eq(customerPayments.orderId, orderId),
+      /**
+       * Currency-scoped when a currency is given. A payable is denominated in the
+       * order's currency, so a payment in another currency must not be subtracted
+       * from it — 4,000 EUR against a 10,000 USD payable would otherwise read as
+       * 6,000 outstanding USD. Cross-currency netting needs an FX rate, and
+       * guessing one here would be worse than not netting at all.
+       *
+       * Callers that only want a total (the UI's "Total paid") pass no currency.
+       */
+      ...(currency ? [eq(customerPayments.currency, currency)] : []),
+    ));
+  return parseFloat(row?.total ?? '0') || 0;
+}
+
+/**
+ * What this order can actually be paid for.
+ *
+ * The GREATER of what has been issued and what the lines are worth.
+ *
+ * Both are real claims, and which is larger depends on the workflow. An issued
+ * invoice is the document the customer holds and it can exist where there are no
+ * priced lines at all (so it must not be ignored). The line total is the whole
+ * deal's value, and a deposit against the part that is not yet invoiced is a real
+ * thing to do (so a partial invoice must not cap the order at its own amount).
+ *
+ * Taking only one of them was wrong either way: invoiced-only refused prepayment
+ * of an uninvoiced balance, lines-only ignored a billed amount the lines do not
+ * express. `max` admits both without ever letting a payment exceed the deal.
+ *
+ * `computeInvoiceAmount` throws on genuinely mixed-currency billable lines — a
+ * data problem that makes the order uninvoiceable, not something a payment should
+ * turn into a 500. That is treated as "no line basis" and the invoice total (if
+ * any) stands; callers guard the throw.
+ */
+export async function orderPayableBase(orderId: string): Promise<number> {
+  const [existing] = await db
+    .select({ total: sql<string>`COALESCE(SUM(${invoices.amount}::numeric), 0)::text` })
+    .from(invoices)
+    .where(and(eq(invoices.orderId, orderId), notInArray(invoices.status, ['VOID'])));
+  const invoiced = parseFloat(existing?.total ?? '0') || 0;
+
+  let lines = 0;
+  try {
+    lines = parseFloat(await computeInvoiceAmount(orderId)) || 0;
+  } catch (err) {
+    // Mixed currency: no single line total exists. The invoice total still stands.
+    if (invoiced > 0) return invoiced;
+    console.warn('[Orders] No payable basis for order', orderId, err instanceof Error ? err.message : err);
+    return 0;
+  }
+  return Math.max(invoiced, lines);
+}
+
 export async function createOrderPayment(orderId: string, input: {
   amount: string;
   currency: string;
@@ -2361,26 +2466,76 @@ export async function createOrderPayment(orderId: string, input: {
 
   if (!orderRow) return null;
 
-  // A payment settles ONE invoice. Stamping the newest invoice (the old
-  // behaviour) sent every payment to the balance invoice the moment an order
-  // carried more than one.
+  /**
+   * A payment above the outstanding balance is refused, not absorbed.
+   *
+   * Nothing used to check this, so a customer could pay an order twice and both
+   * rows were accepted: on channeltx one order was paid 34,694.66 twice within 62
+   * seconds and read "Total paid: 69,389.32" against a 34,694.66 receivable. The
+   * page's own "mark as paid" guard is a courtesy, not a control — this is the
+   * control.
+   *
+   * `computeInvoiceAmount` is the same figure the invoice bills and the customer
+   * card shows, so the cap agrees with the document instead of a second
+   * arithmetic. Half a cent of tolerance, matching the existing precedent for
+   * float/rounding noise elsewhere in this file.
+   */
+  // A payment settles ONE invoice. Stamping the newest invoice (the old behaviour)
+  // sent every payment to the balance invoice the moment an order carried more
+  // than one.
   const invoice = await resolvePaymentInvoiceTarget(orderId);
 
-  const [created] = await db
-    .insert(customerPayments)
-    .values({
-      tenantId: orderRow.tenantId,
-      customerId: orderRow.clientId,
-      orderId,
-      invoiceId: invoice?.id ?? null,
-      amount: input.amount,
-      currency: input.currency || 'USD',
-      receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
-      method: input.method ?? null,
-      note: input.note ?? null,
-      createdBy: input.createdBy ?? null,
-    })
-    .returning();
+  const payable = await orderPayableBase(orderId);
+  const incoming = parseFloat(input.amount) || 0;
+
+  /**
+   * The cap and the insert are ONE transaction that locks the order row.
+   *
+   * Check-then-insert without a lock is not a control: two concurrent posts both
+   * read the same `alreadyPaid`, both find room, and both insert — the duplicate
+   * this whole change exists to stop. The UI guard only removes the easy path; two
+   * tabs, a retry or an API client would still get through. `FOR UPDATE` on the
+   * order serialises them, and the second re-reads the first's committed payment.
+   */
+  const [created] = await db.transaction(async (tx) => {
+    await tx.execute(sql`SELECT id FROM ${orders} WHERE id = ${orderId} FOR UPDATE`);
+
+    const alreadyPaid = await sumOrderPayments(orderId, input.currency, tx);
+    const outstanding = payable - alreadyPaid;
+
+    /**
+     * Enforced only when there is a definite payable. An order with no issued
+     * invoice and no priced lines has `payable` 0, and taking a deposit or advance
+     * against a deal still being built is a real workflow (pinned by
+     * `orders.service.edges`: a no-invoice order accepts two payments). Refusing
+     * those would be a regression, and there is no figure to enforce against — the
+     * cap exists to stop overpaying a known debt, not to forbid payment before
+     * anything is billed.
+     */
+    if (payable > 0 && incoming > outstanding + 0.005) {
+      throw new OrderPaymentError(
+        outstanding <= 0.005
+          ? `This order is already settled in full (${payable.toFixed(2)} ${input.currency}).`
+          : `Payment exceeds the ${outstanding.toFixed(2)} ${input.currency} still outstanding on this order.`,
+      );
+    }
+
+    return tx
+      .insert(customerPayments)
+      .values({
+        tenantId: orderRow.tenantId,
+        customerId: orderRow.clientId,
+        orderId,
+        invoiceId: invoice?.id ?? null,
+        amount: input.amount,
+        currency: input.currency || 'USD',
+        receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
+        method: input.method ?? null,
+        note: input.note ?? null,
+        createdBy: input.createdBy ?? null,
+      })
+      .returning();
+  });
 
   if (invoice?.id) {
     await recomputeInvoiceAmountPaid(invoice.id);
```

# Appendix B — orders.controller.ts (diff)

```diff
diff --git a/apps/api/src/modules/orders/orders.controller.ts b/apps/api/src/modules/orders/orders.controller.ts
index 016bf3cd..2c052e28 100644
--- a/apps/api/src/modules/orders/orders.controller.ts
+++ b/apps/api/src/modules/orders/orders.controller.ts
@@ -37,6 +37,7 @@ import {
   deleteOrderAttachment,
   listOrderPayments,
   createOrderPayment,
+  OrderPaymentError,
   listSupplierPayments,
   createSupplierPayment,
   updateSupplierPayment,
@@ -1284,6 +1285,12 @@ export const ordersController = new Elysia({ prefix: '/orders' })
         if (!created) return { success: false, data: null, message: 'Order not found' };
         return { success: true, data: created } satisfies ApiResponse<typeof created>;
       } catch (err) {
+        // An overpayment is user-fixable and says how much is outstanding; a
+        // generic failure message would leave the operator guessing.
+        if (err instanceof OrderPaymentError) {
+          set.status = 400;
+          return { success: false, data: null, message: err.message };
+        }
         console.error('[Orders] Create payment failed:', err);
         return { success: false, data: null, message: 'Failed to add payment' };
       }
```

# Appendix C — dto.ts (diff)

```diff
diff --git a/packages/types/src/dto.ts b/packages/types/src/dto.ts
index e739603c..2867ce85 100644
--- a/packages/types/src/dto.ts
+++ b/packages/types/src/dto.ts
@@ -625,6 +625,17 @@ export interface OrderDto {
   financingRateAnnual?: number;
   financingDayCountConvention?: number;
   financingDays?: number;
+  /**
+   * What the customer still owes on this order (payable − payments received),
+   * computed ONCE on the server.
+   *
+   * The page previously derived its own total from the item rows, which are empty
+   * once an order is completed — so its mark-as-paid guard compared against 0 and
+   * disabled itself, and the operator was pushed to pay an order that was already
+   * settled. Server-computed keeps the button, the payment cap and the invoice on
+   * one arithmetic.
+   */
+  amountDue: string;
   totalFinancingCost?: string;
   financingCostPerMt?: string | null;
   totalNetProfit?: string;
```

# Appendix D — order-detail-page.component.ts (diff)

```diff
diff --git a/apps/web/src/app/features/trading/pages/order-detail/order-detail-page.component.ts b/apps/web/src/app/features/trading/pages/order-detail/order-detail-page.component.ts
index c66a72b0..7f21b77d 100644
--- a/apps/web/src/app/features/trading/pages/order-detail/order-detail-page.component.ts
+++ b/apps/web/src/app/features/trading/pages/order-detail/order-detail-page.component.ts
@@ -858,18 +858,36 @@ export class OrderDetailPageComponent implements OnInit, AfterViewInit, OnDestro
     this.paymentSchedule().reduce((sum, t) => sum + (parseFloat(t.issuedAmount ?? t.amount) || 0), 0),
   );
 
-  readonly totalDueForMarkPaid = computed(() =>
-    this.itemRows().reduce((sum, item) => {
-      const qty = Number(item.deliveredQuantity ?? item.quantity ?? 0);
-      const unitPrice = Number(item.salesPrice ?? 0);
-      return sum + qty * unitPrice;
-    }, 0),
-  );
+  /**
+   * What is still owed, from the SERVER (`amountDue` on the order).
+   *
+   * This used to be derived from `itemRows()`, which is empty once an order is
+   * completed — so `due` was 0, `hasEnoughPaymentsForMarkPaid` returned false, and
+   * `markPaid`'s own guard on it silently stopped guarding. That is one way an
+   * operator ends up unable to move an order to paid, and it also meant the figure
+   * the button compared against could disagree with the payable the payment modal
+   * showed. One source now: the same number the API caps payments against.
+   */
+  readonly totalDueForMarkPaid = computed(() => parseFloat(this.order()?.amountDue ?? '') || 0);
 
+  /**
+   * Whether the recorded payments cover what is owed.
+   *
+   * `undefined` and `0` are DIFFERENT and are treated differently. A missing
+   * `amountDue` (an older cached order, a response that predates the field) means
+   * "cannot tell", and refuses — the previous version collapsed it to 0 and
+   * therefore answered "yes, paid" for any order whose figure was absent, which
+   * would let an operator mark an unpaid order as paid. An explicit 0 means nothing
+   * is owed, which is a legitimate thing to mark paid, and `due <= 0 → false` was
+   * what silently disabled this guard in the first place.
+   */
   readonly hasEnoughPaymentsForMarkPaid = computed(() => {
-    const due = this.totalDueForMarkPaid();
-    if (due <= 0) return false;
-    return this.paymentsTotal() >= due;
+    const raw = this.order()?.amountDue;
+    if (raw === undefined || raw === null || raw === '') return false;
+    const due = Number(raw);
+    if (!Number.isFinite(due)) return false;
+    if (due <= 0) return true;
+    return this.paymentsTotal() >= due - 0.005;
   });
 
   // ─── Supplier-side settlement (two-sided order settlement) ──────────
```

# Appendix E — order-payment-modal + loader (diff)

```diff
diff --git a/apps/web/src/app/features/trading/pages/order-detail/components/order-payment-modal/order-payment-modal.component.ts b/apps/web/src/app/features/trading/pages/order-detail/components/order-payment-modal/order-payment-modal.component.ts
index 3b4fd651..0ca27f6a 100644
--- a/apps/web/src/app/features/trading/pages/order-detail/components/order-payment-modal/order-payment-modal.component.ts
+++ b/apps/web/src/app/features/trading/pages/order-detail/components/order-payment-modal/order-payment-modal.component.ts
@@ -107,6 +107,10 @@ export class OrderPaymentModalComponent {
   }
 
   async submit(): Promise<void> {
+    // The button is already disabled while saving, but a keyboard submit or a
+    // second click in the same tick would otherwise post twice — and two identical
+    // payment rows is exactly how an order came to read a doubled "Total paid".
+    if (this.saving()) return;
     const id = this.orderId();
     const amountStr = String(this.amount() ?? '').trim();
     if (!amountStr) {
diff --git a/apps/web/src/app/features/trading/pages/order-detail/services/order-loader.service.ts b/apps/web/src/app/features/trading/pages/order-detail/services/order-loader.service.ts
index f4a6408f..ecf61620 100644
--- a/apps/web/src/app/features/trading/pages/order-detail/services/order-loader.service.ts
+++ b/apps/web/src/app/features/trading/pages/order-detail/services/order-loader.service.ts
@@ -59,6 +59,9 @@ export class OrderLoaderService {
       clientId: d.clientId, vesselId: d.vesselId, placeId: d.placeId,
       salesRepId: d.salesRepId, invoicingCompanyId: d.invoicingCompanyId,
       bankAccountId: d.bankAccountId ?? null, currency: d.currency ?? 'USD',
+      // Required on the DTO: the mark-as-paid gate distinguishes a missing value
+      // (cannot tell — refuse) from an explicit 0 (nothing owed — allow).
+      amountDue: d.amountDue ?? '',
       status: d.status, eta: d.eta, etd: d.etd,
       customerPaymentTermType: d.customerPaymentTermType ?? null,
       customerCreditDays: d.customerCreditDays ?? null, customerNote: d.customerNote ?? null,
```

# Appendix F — the test file (whole, CURRENT)

```ts
/**
 * A payment cannot exceed what the order is actually owed for.
 *
 * Reported by a customer: "when you process payment the system requires you to
 * mark paid 2x" and "we clear the invoice as paid, but it does not credit the
 * value back". Production showed why — on channeltx an order was paid 34,694.66
 * TWICE within 62 seconds, and the page read "Total paid: 69,389.32" against a
 * 34,694.66 receivable, because nothing refused the second payment.
 *
 * The page's own "mark as paid" guard is a courtesy; the API had no control at
 * all. These tests pin the control.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';
import { counterparties, customerPayments, orderItems, orders } from '../src/db/schema';

/** A CONFIRMED order with one priced line: 100 MT @ 100 = 10,000. */
async function orderWithLine(token: string, seeded: Awaited<ReturnType<typeof seedAuthBasics>>) {
  const created = await requestJson('/orders', {
    method: 'POST',
    token,
    body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id },
  });
  const orderId = created.data?.data?.id as string;

  await requestJson(`/orders/${orderId}/items`, {
    method: 'PUT',
    token,
    body: {
      items: [{
        productType: 'VLSFO', quantity: '100', unit: 'MT',
        costPrice: '90', costCurrency: 'USD', salesPrice: '100', salesCurrency: 'USD',
      }],
    },
  });
  await requestJson(`/orders/${orderId}/status`, { method: 'PUT', token, body: { status: 'CONFIRMED' } });
  return orderId;
}

describe('order payment cap e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('accepts a payment up to the outstanding balance and refuses one beyond it', async () => {
    const seeded = await seedAuthBasics();
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const orderId = await orderWithLine(token, seeded);

    // The payable is the line total: 100 x 100.
    const first = await requestJson(`/orders/${orderId}/payments`, {
      method: 'POST', token, body: { amount: '6000', currency: 'USD' },
    });
    expect(first.status).toBe(200);

    // 6,000 paid, 4,000 outstanding — 4,000 is accepted exactly.
    const exact = await requestJson(`/orders/${orderId}/payments`, {
      method: 'POST', token, body: { amount: '4000', currency: 'USD' },
    });
    expect(exact.status).toBe(200);

    // Now settled: another payment is refused, with the reason.
    const over = await requestJson(`/orders/${orderId}/payments`, {
      method: 'POST', token, body: { amount: '34694.66', currency: 'USD' },
    });
    expect(over.status).toBe(400);
    expect(String(over.data?.message)).toContain('already settled');

    const db = await getDb();
    const rows = await db.select().from(customerPayments).where(eq(customerPayments.orderId, orderId));
    // Two payments, not three — the refused one left no row behind.
    expect(rows.length).toBe(2);
  });

  it('refuses the exact double-submit that produced a doubled total paid', async () => {
    const seeded = await seedAuthBasics();
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const orderId = await orderWithLine(token, seeded);

    // Reproduces the reported sequence: the same amount posted twice.
    const body = { amount: '10000', currency: 'USD', receivedAt: '2026-07-14T17:00:00.000Z' };
    const one = await requestJson(`/orders/${orderId}/payments`, { method: 'POST', token, body });
    expect(one.status).toBe(200);

    const two = await requestJson(`/orders/${orderId}/payments`, { method: 'POST', token, body });
    expect(two.status).toBe(400);

    const db = await getDb();
    const rows = await db.select().from(customerPayments).where(eq(customerPayments.orderId, orderId));
    expect(rows.length).toBe(1);
    // The doubled figure the customer saw must be impossible now.
    const total = rows.reduce((s, r) => s + parseFloat(r.amount ?? '0'), 0);
    expect(total).toBe(10000);
  });

  it('refuses a partial payment that would tip the order over', async () => {
    const seeded = await seedAuthBasics();
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const orderId = await orderWithLine(token, seeded);

    await requestJson(`/orders/${orderId}/payments`, {
      method: 'POST', token, body: { amount: '9500', currency: 'USD' },
    });
    // 500 outstanding; 600 is over.
    const res = await requestJson(`/orders/${orderId}/payments`, {
      method: 'POST', token, body: { amount: '600', currency: 'USD' },
    });
    expect(res.status).toBe(400);
    expect(String(res.data?.message)).toContain('500.00');
  });

  it('measures the cap on DELIVERED quantity, the same basis the invoice bills', async () => {
    const seeded = await seedAuthBasics();
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const orderId = await orderWithLine(token, seeded);

    /**
     * The reported deal was 7,500 MT ordered but 7,382 MT delivered, so the card's
     * "pending amount" (34,694.66) was BELOW the page's own gate (35,193.75). The
     * cap must not repeat that disagreement: it uses the effective (delivered)
     * quantity, so paying the displayed figure is enough and paying the ordered
     * figure is refused as over.
     */
    const db = await getDb();
    await db.update(orderItems).set({ deliveredQuantity: '80' }).where(eq(orderItems.orderId, orderId));

    // 80 delivered x 100 = 8,000 payable.
    const atDelivered = await requestJson(`/orders/${orderId}/payments`, {
      method: 'POST', token, body: { amount: '8000', currency: 'USD' },
    });
    expect(atDelivered.status).toBe(200);

    // The ORDERED figure (10,000) is now over the payable, so it is refused — the
    // old behaviour accepted it and left the order reading over-paid.
    const atOrdered = await requestJson(`/orders/${orderId}/payments`, {
      method: 'POST', token, body: { amount: '2000', currency: 'USD' },
    });
    expect(atOrdered.status).toBe(400);
  });

  it('does NOT block paying the uninvoiced balance of a partially invoiced order', async () => {
    const seeded = await seedAuthBasics();
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const orderId = await orderWithLine(token, seeded);
    const db = await getDb();
    const { invoices } = await import('../src/db/schema');

    /**
     * Panel finding: taking the INVOICE alone as the payable would cap a partially
     * invoiced order at what has been billed, so a customer could not prepay the
     * rest. Both are real claims; the payable is the greater of the two.
     */
    await db.insert(invoices).values({
      orderId, invoiceNumber: 'INV-CAP-001', status: 'SENT', dueDate: '2030-01-01', amount: '4000.00',
    });

    // 4,000 invoiced, 10,000 of lines → the payable is the deal, not the invoice.
    const res = await requestJson(`/orders/${orderId}/payments`, {
      method: 'POST', token, body: { amount: '10000', currency: 'USD' },
    });
    expect(res.status).toBe(200);

    const after = await requestJson(`/orders/${orderId}`, { token });
    expect(after.data?.data?.amountDue).toBe('0.00');
  });

  it('does not subtract a payment in another currency from the payable', async () => {
    const seeded = await seedAuthBasics();
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const orderId = await orderWithLine(token, seeded);

    /**
     * Panel finding: summing all currencies made the cap meaningless and produced a
     * wrong message ("3,000 USD outstanding" after paying EUR). Cross-currency
     * netting needs an FX rate, so it is not attempted — the USD payable is judged
     * against USD payments only.
     */
    const eur = await requestJson(`/orders/${orderId}/payments`, {
      method: 'POST', token, body: { amount: '3000', currency: 'EUR' },
    });
    expect(eur.status).toBe(200);

    // The USD balance is untouched by the EUR payment.
    const view = await requestJson(`/orders/${orderId}`, { token });
    expect(view.data?.data?.amountDue).toBe('10000.00');

    // And the full USD 10,000 is still payable.
    const usd = await requestJson(`/orders/${orderId}/payments`, {
      method: 'POST', token, body: { amount: '10000', currency: 'USD' },
    });
    expect(usd.status).toBe(200);
  });

  it('exposes the outstanding balance on the order so the UI need not derive it', async () => {
    const seeded = await seedAuthBasics();
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const orderId = await orderWithLine(token, seeded);

    const before = await requestJson(`/orders/${orderId}`, { token });
    expect(before.data?.data?.amountDue).toBe('10000.00');

    await requestJson(`/orders/${orderId}/payments`, {
      method: 'POST', token, body: { amount: '2500', currency: 'USD' },
    });

    const after = await requestJson(`/orders/${orderId}`, { token });
    expect(after.data?.data?.amountDue).toBe('7500.00');
  });
});
```
