// ═══════════════════════════════════════════════════════════════════════
//  Orders Controller
//
//  GET    /orders?statuses=INQUIRY,OFFER&search=...&page=...&limit=...
//  GET    /orders/:id
//  GET    /orders/:id/activity
//  POST   /orders
//  PUT    /orders/:id
//  PUT    /orders/:id/status
//  PUT    /orders/:id/items
//  DELETE /orders/:id
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import {
  listDealEconomics,
  listOrders,
  getOrderById,
  getOrderSuppliers,
  addOrderSupplier,
  updateOrderSupplierRecord,
  deleteOrderSupplierRecord,
  createOrder,
  updateOrder,
  deleteOrder,
  saveOrderItems,
  updateOrderStatus,
  assertCreditForConfirmation,
  getOrderActivity,
  resolveOrderId,
  listOrderAttachments,
  listOrderPhotos,
  createOrderAttachment,
  updateOrderAttachmentType,
  updateOrderAttachmentCategory,
  deleteOrderAttachment,
  listOrderPayments,
  createOrderPayment,
  listSupplierPayments,
  createSupplierPayment,
  updateSupplierPayment,
  deleteSupplierPayment,
  finalizeItemPrice,
  setOrderBunkerBookingSent,
} from './orders.service';
import { logActivity } from '../activity/activity.service';
import { listOrderPaymentSchedule, setOrderPaymentSchedule, InvalidScheduleError } from './payment-schedule.service';
import { voidOrderInvoice, InvoiceNotFoundError, InvoiceAlreadyVoidError, AmbiguousInvoiceError, MixedCurrencyInvoiceError, InternalTransferHasNoInvoiceError, InvoiceLinesChangedError, UnpricedScheduleError } from './invoice.service';
import {
  SupplierCreditNoteError,
  createSupplierCreditNote,
  listSupplierCreditNotes,
  updateSupplierCreditNote,
} from './supplier-credit-notes.service';
import type { ApiResponse, CreateSupplierCreditNoteDto, UpdateSupplierCreditNoteDto } from '@fueld/types';
import { db } from '../../db';
import { users, tenants, orders } from '../../db/schema';
import { eq } from 'drizzle-orm';

/**
 * Deal economics (Riviera / trader-commission model) — tenant-gated by the
 * 'deal-economics' view. When the view is disabled, strip the fields. When
 * enabled and the trader commission % is not explicitly provided, auto-fill
 * it from the tenant traderCommissions config (per trader, per deal type).
 */
async function gateDealEconomicsFields(
  tenantId: string,
  body: Record<string, unknown>,
  salesRepId?: string | null,
  currentOrderId?: string | null,
): Promise<void> {
  const [tenant] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const views = ((tenant?.settings as any)?.enabledViews ?? []) as string[];
  if (!views.includes('deal-economics')) {
    // View disabled: ignore (drop) the keys instead of nulling them, so a
    // full-payload autosave cannot erase stored deal data.
    delete body.dealType;
    delete body.tpcPerMt;
    delete body.tpcCurrency;
    delete body.traderCommissionPct;
    return;
  }
  // Auto-fill the trader commission snapshot from the tenant scheme when the
  // client did not provide one (undefined OR null — the client clears it on
  // deal-type change expecting a re-fill). Uses the effective sales rep:
  // the one in the body, or the order's current rep for updates.
  if (body.traderCommissionPct == null && body.dealType) {
    let repId = salesRepId ?? null;
    if (!repId && currentOrderId) {
      const [current] = await db.select({ salesRepId: orders.salesRepId }).from(orders).where(eq(orders.id, currentOrderId)).limit(1);
      repId = current?.salesRepId ?? null;
    }
    if (repId) {
      const dealType = String(body.dealType).trim().toUpperCase();
      const schemes = ((tenant?.settings as any)?.traderCommissions ?? []) as { userId: string; rates: Record<string, number> }[];
      const pct = schemes.find((c) => c.userId === repId)?.rates?.[dealType];
      if (pct !== undefined && pct !== null) body.traderCommissionPct = String(pct);
    }
  }
}

/** Check if broker deals are enabled for the tenant. If not, strip broker deal fields from request body. */
async function gateBrokerDealFields(tenantId: string, body: Record<string, unknown>): Promise<void> {
  const [tenant] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const bd = (tenant?.settings as any)?.brokerDeals ?? {};
  if (!bd.enabled) {
    // Feature disabled — strip broker deal fields
    body.isBrokerDeal = false;
    body.commissionPerMt = null;
  }
}
import { getAttachmentTypeSettings, getInquiryCancelReasonSettings, getBookingEmailSettings } from '../admin/settings.service';
import { composeBookingEmail, resolveBookingRecipients } from '../documents/booking-email.service';
import { sendDocumentEmail } from '../documents/mail.service';

const PaymentTermTypeSchema = t.Union([
  t.Literal('CREDIT'),
  t.Literal('COD'),
  t.Literal('PREPAY'),
]);

export const ordersController = new Elysia({ prefix: '/orders' })
  .use(authGuard)

  // ─── GET /orders/deal-economics (Riviera "DEALS" register) ────────
  // Restricted: tenant must have the 'deal-economics' view enabled AND the
  // caller must hold a money-privileged role (admin/finance/credit-manager).
  // Per-user view assignment may replace the role check later.
  .get(
    '/deal-economics',
    async ({ auth, query }) => {
      try {
        const allowedRoles = ['ADMIN', 'FINANCE', 'CREDITMANAGER'];
        if (!allowedRoles.includes(auth.role)) {
          return { success: false, data: null, message: 'Forbidden' };
        }
        const [tenant] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1);
        const views = ((tenant?.settings as any)?.enabledViews ?? []) as string[];
        if (!views.includes('deal-economics')) {
          return { success: true, data: [] } satisfies ApiResponse<unknown>;
        }
        const params = query as { from?: string; to?: string; dateBasis?: string };
        const rows = await listDealEconomics(auth.tenantId, {
          from: params.from ?? null,
          to: params.to ?? null,
          dateBasis: params.dateBasis === 'created' ? 'created' : 'delivery',
        });
        return { success: true, data: rows } satisfies ApiResponse<unknown>;
      } catch (err) {
        console.error('[Orders] Deal economics failed:', err);
        return { success: false, data: null, message: 'Failed to load deal economics' };
      }
    },
    {
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        dateBasis: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Deal economics register — one row per confirmed+ deal with commissions (restricted roles)',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ─── List Orders ───────────────────────────────────────────────────
  .get(
    '/',
    async ({ query }) => {
      try {
        const statuses = query.statuses
          ? query.statuses.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined;
        const salesRepIds = query.salesRepId
          ? query.salesRepId.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined;
        const productTypes = query.productType
          ? query.productType.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined;
        const results = await listOrders({
          search: query.search,
          statuses,
          salesRepIds,
          brokerId: query.brokerId,
          clientId: query.clientId,
          vesselId: query.vesselId,
          placeId: query.placeId,
          invoicingCompanyId: query.invoicingCompanyId,
          productTypes,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          createdFrom: query.createdFrom,
          createdTo: query.createdTo,
          sortBy: query.sortBy,
          sortDir: query.sortDir as 'asc' | 'desc' | undefined,
          page: query.page ? parseInt(query.page, 10) : undefined,
          limit: query.limit ? parseInt(query.limit, 10) : undefined,
          isBrokerDeal: query.isBrokerDeal === 'true' ? true : query.isBrokerDeal === 'false' ? false : undefined,
        });
        return { success: true, data: results } satisfies ApiResponse<typeof results>;
      } catch (err) {
        console.error('[Orders] List failed:', err);
        return { success: false, data: { items: [], total: 0 }, message: 'Failed to list orders' };
      }
    },
    {
      query: t.Object({
        statuses: t.Optional(t.String()),
        search: t.Optional(t.String()),
        salesRepId: t.Optional(t.String()),
        brokerId: t.Optional(t.String()),
        clientId: t.Optional(t.String()),
        vesselId: t.Optional(t.String()),
        placeId: t.Optional(t.String()),
        invoicingCompanyId: t.Optional(t.String()),
        productType: t.Optional(t.String()),
        dateFrom: t.Optional(t.String()),
        dateTo: t.Optional(t.String()),
        createdFrom: t.Optional(t.String()),
        createdTo: t.Optional(t.String()),
        sortBy: t.Optional(t.String()),
        sortDir: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        isBrokerDeal: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'List orders/inquiries with optional status filter',
      },
    },
  )

  // ─── Get Order Detail ──────────────────────────────────────────────
  .get(
    '/:id',
    async ({ params }) => {
      try {
        const order = await getOrderById(params.id);
        if (!order) {
          return { success: false, data: null, message: 'Order not found' };
        }
        return { success: true, data: order } satisfies ApiResponse<typeof order>;
      } catch (err) {
        console.error('[Orders] GetById failed:', err);
        const message = err instanceof Error ? err.message : 'Failed to fetch order';
        return { success: false, data: null, message };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Orders'],
        summary: 'Get a single order with all relations and items',
      },
    },
  )

  // ─── Order Suppliers ───────────────────────────────────────────────
  .get(
    '/:id/suppliers',
    async ({ params }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: [], message: 'Order not found' };
        const suppliers = await getOrderSuppliers(orderId);
        return { success: true, data: suppliers } satisfies ApiResponse<typeof suppliers>;
      } catch (err) {
        console.error('[Orders] Supplier list failed:', err);
        return { success: false, data: [], message: 'Failed to load order suppliers' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Orders'],
        summary: 'List supplier legs for an order',
      },
    },
  )
  .post(
    '/:id/suppliers',
    async ({ params, body, auth }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };
        const supplier = await addOrderSupplier(orderId, body);
        await logActivity({
          userId: auth.sub,
          action: 'UPDATE',
          entityType: 'order',
          entityId: orderId,
          metadata: { action: 'add_supplier_leg', companyId: body.companyId },
        });
        return { success: true, data: supplier } satisfies ApiResponse<typeof supplier>;
      } catch (err) {
        console.error('[Orders] Add supplier failed:', err);
        const message = err instanceof Error ? err.message : 'Failed to add order supplier';
        return { success: false, data: null, message };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        companyId: t.String(),
        contactId: t.Optional(t.Nullable(t.String())),
        paymentTermType: t.Optional(t.Nullable(PaymentTermTypeSchema)),
        creditDays: t.Optional(t.Nullable(t.Number())),
        note: t.Optional(t.Nullable(t.String())),
        supplierDueDate: t.Optional(t.Nullable(t.String())),
        deliveredAt: t.Optional(t.Nullable(t.String())),
        isPrimary: t.Optional(t.Boolean()),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Add a supplier leg to an order',
      },
    },
  )
  .put(
    '/:id/suppliers/:supplierRecordId',
    async ({ params, body, auth }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };
        // Capture the previous due-date override so the activity log can show the change
        const legsBefore = await getOrderSuppliers(orderId);
        const previousDueDate = legsBefore.find((s) => s.id === params.supplierRecordId)?.supplierDueDate ?? null;
        const supplier = await updateOrderSupplierRecord(orderId, params.supplierRecordId, body);
        if (!supplier) return { success: false, data: null, message: 'Order supplier not found' };
        const dueDateChanged = body.supplierDueDate !== undefined && (previousDueDate ?? null) !== (supplier.supplierDueDate ?? null);
        await logActivity({
          userId: auth.sub,
          action: 'UPDATE',
          entityType: 'order',
          entityId: orderId,
          metadata: {
            action: 'update_supplier_leg',
            supplierRecordId: params.supplierRecordId,
            ...(dueDateChanged
              ? { changes: [{ field: 'supplierDueDate', from: previousDueDate, to: supplier.supplierDueDate }] }
              : {}),
          },
        });
        return { success: true, data: supplier } satisfies ApiResponse<typeof supplier>;
      } catch (err) {
        console.error('[Orders] Update supplier failed:', err);
        const message = err instanceof Error ? err.message : 'Failed to update order supplier';
        return { success: false, data: null, message };
      }
    },
    {
      params: t.Object({ id: t.String(), supplierRecordId: t.String() }),
      body: t.Object({
        companyId: t.Optional(t.String()),
        contactId: t.Optional(t.Nullable(t.String())),
        paymentTermType: t.Optional(t.Nullable(PaymentTermTypeSchema)),
        creditDays: t.Optional(t.Nullable(t.Number())),
        note: t.Optional(t.Nullable(t.String())),
        supplierDueDate: t.Optional(t.Nullable(t.String())),
        deliveredAt: t.Optional(t.Nullable(t.String())),
        sortOrder: t.Optional(t.Number()),
        isPrimary: t.Optional(t.Boolean()),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Update a supplier leg on an order',
      },
    },
  )
  .delete(
    '/:id/suppliers/:supplierRecordId',
    async ({ params, auth }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };
        const deleted = await deleteOrderSupplierRecord(orderId, params.supplierRecordId);
        if (!deleted) return { success: false, data: null, message: 'Order supplier not found' };
        await logActivity({
          userId: auth.sub,
          action: 'UPDATE',
          entityType: 'order',
          entityId: orderId,
          metadata: { action: 'delete_supplier_leg', supplierRecordId: params.supplierRecordId },
        });
        return { success: true, data: deleted } satisfies ApiResponse<typeof deleted>;
      } catch (err) {
        console.error('[Orders] Delete supplier failed:', err);
        const message = err instanceof Error ? err.message : 'Failed to remove order supplier';
        return { success: false, data: null, message };
      }
    },
    {
      params: t.Object({ id: t.String(), supplierRecordId: t.String() }),
      detail: {
        tags: ['Orders'],
        summary: 'Remove a supplier leg from an order',
      },
    },
  )

  // ─── Supplier Credit Notes (money back from a supplier on a leg) ──
  .get(
    '/:id/supplier-credit-notes',
    async ({ params }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: [], message: 'Order not found' };
        const credits = await listSupplierCreditNotes(orderId);
        return { success: true, data: credits } satisfies ApiResponse<typeof credits>;
      } catch (err) {
        console.error('[Orders] Credit note list failed:', err);
        const message = err instanceof Error ? err.message : 'Failed to list supplier credit notes';
        return { success: false, data: [], message };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Orders'],
        summary: 'List supplier credit notes for an order',
      },
    },
  )
  .post(
    '/:id/supplier-credit-notes',
    async ({ params, body, auth }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };
        const order = await getOrderById(orderId);
        if (!order) return { success: false, data: null, message: 'Order not found' };
        const credit = await createSupplierCreditNote(
          orderId,
          auth.tenantId,
          (order as { currency?: string | null }).currency ?? 'USD',
          auth.sub,
          body as CreateSupplierCreditNoteDto,
        );
        await logActivity({
          userId: auth.sub,
          action: 'CREATE',
          entityType: 'order',
          entityId: orderId,
          metadata: {
            action: 'add_supplier_credit_note',
            creditId: credit.id,
            amount: credit.amount,
            currency: credit.currency,
            status: credit.status,
          },
        });
        return { success: true, data: credit } satisfies ApiResponse<typeof credit>;
      } catch (err) {
        if (err instanceof SupplierCreditNoteError) {
          return { success: false, data: null, message: err.message };
        }
        console.error('[Orders] Add credit note failed:', err);
        const message = err instanceof Error ? err.message : 'Failed to add supplier credit note';
        return { success: false, data: null, message };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        orderSupplierId: t.String(),
        orderLineId: t.Optional(t.Nullable(t.String())),
        supplierReference: t.Optional(t.Nullable(t.String())),
        amount: t.String(),
        currency: t.Optional(t.String()),
        fxRate: t.Optional(t.Nullable(t.String())),
        amountInOrderCurrency: t.Optional(t.Nullable(t.String())),
        creditDate: t.Optional(t.String()),
        reason: t.Optional(t.String()),
        note: t.Optional(t.Nullable(t.String())),
        status: t.Optional(t.Union([t.Literal('EXPECTED'), t.Literal('RECEIVED')])),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Add a supplier credit note to an order',
      },
    },
  )
  .patch(
    '/:id/supplier-credit-notes/:creditId',
    async ({ params, body, auth }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };
        const credit = await updateSupplierCreditNote(
          orderId,
          params.creditId,
          body as UpdateSupplierCreditNoteDto,
        );
        await logActivity({
          userId: auth.sub,
          action: 'UPDATE',
          entityType: 'order',
          entityId: orderId,
          metadata: {
            action: 'update_supplier_credit_note',
            creditId: params.creditId,
            status: credit.status,
          },
        });
        return { success: true, data: credit } satisfies ApiResponse<typeof credit>;
      } catch (err) {
        if (err instanceof SupplierCreditNoteError) {
          return { success: false, data: null, message: err.message };
        }
        console.error('[Orders] Update credit note failed:', err);
        const message = err instanceof Error ? err.message : 'Failed to update supplier credit note';
        return { success: false, data: null, message };
      }
    },
    {
      params: t.Object({ id: t.String(), creditId: t.String() }),
      body: t.Object({
        supplierReference: t.Optional(t.Nullable(t.String())),
        amount: t.Optional(t.String()),
        currency: t.Optional(t.String()),
        fxRate: t.Optional(t.Nullable(t.String())),
        amountInOrderCurrency: t.Optional(t.Nullable(t.String())),
        creditDate: t.Optional(t.String()),
        reason: t.Optional(t.String()),
        note: t.Optional(t.Nullable(t.String())),
        status: t.Optional(
          t.Union([t.Literal('EXPECTED'), t.Literal('RECEIVED'), t.Literal('CANCELLED')]),
        ),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Update a supplier credit note (status lifecycle; received amounts immutable)',
      },
    },
  )

  // ─── Supplier Payments (per-leg settlement) ───────────────────────
  .get(
    '/:id/suppliers/:supplierRecordId/payments',
    async ({ params }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: [], message: 'Order not found' };
        const payments = await listSupplierPayments(params.supplierRecordId);
        return { success: true, data: payments } satisfies ApiResponse<typeof payments>;
      } catch (err) {
        console.error('[Orders] List supplier payments failed:', err);
        return { success: false, data: [], message: 'Failed to load supplier payments' };
      }
    },
    {
      params: t.Object({ id: t.String(), supplierRecordId: t.String() }),
      detail: { tags: ['Orders'], summary: 'List supplier payments for a leg' },
    },
  )
  .post(
    '/:id/suppliers/:supplierRecordId/payments',
    async ({ params, body, auth, set }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount < 0) {
          set.status = 400;
          return { success: false, data: null, message: 'Invalid payment amount' };
        }
        const created = await createSupplierPayment(params.supplierRecordId, {
          amount: body.amount,
          currency: body.currency,
          paidAt: body.paidAt ?? null,
          method: body.method ?? null,
          note: body.note ?? null,
          createdBy: auth.sub,
        });
        if (!created) return { success: false, data: null, message: 'Order supplier leg not found' };
        await logActivity({
          userId: auth.sub,
          action: 'UPDATE',
          entityType: 'order',
          entityId: orderId,
          metadata: { action: 'add_supplier_payment', supplierRecordId: params.supplierRecordId, amount: body.amount },
        });
        return { success: true, data: created } satisfies ApiResponse<typeof created>;
      } catch (err) {
        console.error('[Orders] Create supplier payment failed:', err);
        return { success: false, data: null, message: 'Failed to add supplier payment' };
      }
    },
    {
      params: t.Object({ id: t.String(), supplierRecordId: t.String() }),
      body: t.Object({
        amount: t.String(),
        currency: t.String(),
        paidAt: t.Optional(t.String()),
        method: t.Optional(t.Nullable(t.String())),
        note: t.Optional(t.Nullable(t.String())),
      }),
      detail: { tags: ['Orders'], summary: 'Create a supplier payment for a leg' },
    },
  )
  // ── PUT /orders/:id/bunker-booking-sent ────────────────────────────
  //  Manual toggle for the "Sendt Bunker Booking" (red/green) indicator.
  //  Used when a booking was sent outside Fueld (manual email) — flips the
  //  indicator red→green or green→red.
  .put(
    '/:id/bunker-booking-sent',
    async ({ params, body, auth }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };
        const result = await setOrderBunkerBookingSent(orderId, body.sent, auth.tenantId);
        if (!result.found) return { success: false, data: null, message: 'Order not found' };
        const sentAt = result.sentAt;
        await logActivity({
          userId: auth.sub,
          tenantId: auth.tenantId,
          action: 'UPDATE',
          entityType: 'order',
          entityId: orderId,
          metadata: { bunkerBookingSent: body.sent },
        }).catch(() => {});
        return { success: true, data: { bunkerBookingSentAt: sentAt } } satisfies ApiResponse<{ bunkerBookingSentAt: Date | null }>;
      } catch (err) {
        console.error('[Orders] Toggle bunker booking sent failed:', err);
        return { success: false, data: null, message: 'Failed to update bunker booking indicator' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ sent: t.Boolean() }),
      detail: { tags: ['Orders'], summary: 'Toggle the Sendt Bunker Booking indicator (red/green)' },
    },
  )

  .patch(
    '/supplier-payments/:paymentId',
    async ({ params, body }) => {
      try {
        const updated = await updateSupplierPayment(params.paymentId, {
          amount: body.amount,
          currency: body.currency,
          paidAt: body.paidAt ?? null,
          method: body.method ?? null,
          note: body.note ?? null,
        });
        if (!updated) return { success: false, data: null, message: 'Supplier payment not found' };
        return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
      } catch (err) {
        console.error('[Orders] Update supplier payment failed:', err);
        return { success: false, data: null, message: 'Failed to update supplier payment' };
      }
    },
    {
      params: t.Object({ paymentId: t.String() }),
      body: t.Object({
        amount: t.Optional(t.String()),
        currency: t.Optional(t.String()),
        paidAt: t.Optional(t.Nullable(t.String())),
        method: t.Optional(t.Nullable(t.String())),
        note: t.Optional(t.Nullable(t.String())),
      }),
      detail: { tags: ['Orders'], summary: 'Update a supplier payment' },
    },
  )
  .delete(
    '/supplier-payments/:paymentId',
    async ({ params, auth }) => {
      try {
        const deleted = await deleteSupplierPayment(params.paymentId);
        if (!deleted) return { success: false, data: null, message: 'Supplier payment not found' };
        await logActivity({
          userId: auth.sub,
          action: 'UPDATE',
          entityType: 'order',
          entityId: 'supplier-payment',
          metadata: { action: 'delete_supplier_payment', paymentId: params.paymentId },
        });
        return { success: true, data: deleted } satisfies ApiResponse<typeof deleted>;
      } catch (err) {
        console.error('[Orders] Delete supplier payment failed:', err);
        return { success: false, data: null, message: 'Failed to delete supplier payment' };
      }
    },
    {
      params: t.Object({ paymentId: t.String() }),
      detail: { tags: ['Orders'], summary: 'Delete a supplier payment' },
    },
  )

  // ─── Get Order Activity ────────────────────────────────────────────
  .get(
    '/:id/activity',
    async ({ params }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: [], message: 'Order not found' };
        const logs = await getOrderActivity(orderId);
        return { success: true, data: logs } satisfies ApiResponse<typeof logs>;
      } catch (err) {
        console.error('[Orders] Activity failed:', err);
        return { success: false, data: [], message: 'Failed to fetch activity' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Orders'],
        summary: 'Get activity history for an order',
      },
    },
  )

  // ─── Create Order ─────────────────────────────────────────────────
  .post(
    '/',
    async ({ body, auth }) => {
      try {
        // Look up user's tenantId
        const [user] = await db
          .select({ tenantId: users.tenantId })
          .from(users)
          .where(eq(users.id, auth.sub))
          .limit(1);

        if (!user?.tenantId) {
          return { success: false, data: null, message: 'User has no tenant' };
        }

        // Gate broker deal fields by tenant setting
        await gateBrokerDealFields(user.tenantId, body as Record<string, unknown>);
        await gateDealEconomicsFields(user.tenantId, body as Record<string, unknown>, (body as any).salesRepId ?? null);

        const order = await createOrder({
          tenantId: user.tenantId,
          clientId: body.clientId,
          vesselId: body.vesselId,
          placeId: body.placeId,
          salesRepId: body.salesRepId ?? auth.sub,
          invoicingCompanyId: body.invoicingCompanyId,
          bankAccountId: body.bankAccountId ?? null,
          currency: body.currency,
          customerPaymentTermType: body.customerPaymentTermType ?? null,
          customerCreditDays: body.customerCreditDays ?? null,
          customerNote: body.customerNote ?? null,
          purchaseOrderNumber: body.purchaseOrderNumber ?? null,
          supplierId: body.supplierId ?? null,
          supplierPaymentTermType: body.supplierPaymentTermType ?? null,
          supplierCreditDays: body.supplierCreditDays ?? null,
          supplierDueDate: body.supplierDueDate ?? null,
          supplierNote: body.supplierNote ?? null,
          customerContactId: body.customerContactId ?? null,
          supplierContactId: body.supplierContactId ?? null,
          termsAndConditions: body.termsAndConditions ?? null,
          brokerId: body.brokerId ?? null,
          brokerContactId: body.brokerContactId ?? null,
          brokerGetsAll: body.brokerGetsAll ?? false,
          agentId: body.agentId ?? null,
          agentContactId: body.agentContactId ?? null,
          categoryKey: body.categoryKey ?? null,
          deliveryMethod: body.deliveryMethod ?? null,
          responseDeadlineAt: body.responseDeadlineAt ?? null,
          eta: body.eta,
          etd: body.etd,
          isBrokerDeal: body.isBrokerDeal ?? false,
          commissionPerMt: body.commissionPerMt ?? null,
          customFields: body.customFields,
        });

        // Log activity
        await logActivity({
          userId: auth.sub,
          action: 'CREATE',
          entityType: 'order',
          entityId: order.id,
          metadata: { status: order.status },
        });

        return { success: true, data: order } satisfies ApiResponse<typeof order>;
      } catch (err) {
        console.error('[Orders] Create failed:', err);
        return { success: false, data: null, message: 'Failed to create order' };
      }
    },
    {
      body: t.Object({
        clientId: t.String(),
        vesselId: t.String(),
        placeId: t.String(),
        salesRepId: t.Optional(t.String()),
        invoicingCompanyId: t.Optional(t.String()),
        bankAccountId: t.Optional(t.Nullable(t.String())),
        currency: t.Optional(t.String()),
        customerPaymentTermType: t.Optional(t.Nullable(PaymentTermTypeSchema)),
        customerCreditDays: t.Optional(t.Nullable(t.Number())),
        customerNote: t.Optional(t.Nullable(t.String())),
        purchaseOrderNumber: t.Optional(t.Nullable(t.String())),
        customerContactId: t.Optional(t.Nullable(t.String())),
        supplierId: t.Optional(t.Nullable(t.String())),
        supplierPaymentTermType: t.Optional(t.Nullable(PaymentTermTypeSchema)),
        supplierCreditDays: t.Optional(t.Nullable(t.Number())),
        supplierDueDate: t.Optional(t.Nullable(t.String())),
        supplierNote: t.Optional(t.Nullable(t.String())),
        supplierContactId: t.Optional(t.Nullable(t.String())),
        brokerId: t.Optional(t.Nullable(t.String())),
        brokerContactId: t.Optional(t.Nullable(t.String())),
        brokerGetsAll: t.Optional(t.Boolean()),
        agentId: t.Optional(t.Nullable(t.String())),
        agentContactId: t.Optional(t.Nullable(t.String())),
        termsAndConditions: t.Optional(t.Nullable(t.String())),
        categoryKey: t.Optional(t.Nullable(t.String())),
        deliveryMethod: t.Optional(t.Nullable(t.String())),
        responseDeadlineAt: t.Optional(t.Nullable(t.String())),
        eta: t.Optional(t.String()),
        etd: t.Optional(t.String()),
        isBrokerDeal: t.Optional(t.Boolean()),
        commissionPerMt: t.Optional(t.String()),
        dealType: t.Optional(t.Nullable(t.String())),
        tpcPerMt: t.Optional(t.Nullable(t.String())),
        tpcCurrency: t.Optional(t.Nullable(t.String())),
        traderCommissionPct: t.Optional(t.Nullable(t.String())),
        customFields: t.Optional(t.Record(t.String(), t.Union([t.String(), t.Number(), t.Null()]))),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Create a new order (defaults to INQUIRY status)',
      },
    },
  )

  // ─── Update Order ─────────────────────────────────────────────────
  .put(
    '/:id',
    async ({ params, body, auth }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };
        // Gate broker deal fields by tenant setting
        await gateBrokerDealFields(auth.tenantId, body as Record<string, unknown>);
        await gateDealEconomicsFields(auth.tenantId, body as Record<string, unknown>, (body as any).salesRepId ?? null, orderId);
        const updated = await updateOrder(orderId, body, auth.sub);
        if (!updated) {
          return { success: false, data: null, message: 'Order not found' };
        }

        return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
      } catch (err) {
        console.error('[Orders] Update failed:', err);
        return {
          success: false,
          data: null,
          message: err instanceof Error ? err.message : 'Failed to update order',
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        clientId: t.Optional(t.String()),
        vesselId: t.Optional(t.String()),
        placeId: t.Optional(t.String()),
        salesRepId: t.Optional(t.Nullable(t.String())),
        invoicingCompanyId: t.Optional(t.Nullable(t.String())),
        bankAccountId: t.Optional(t.Nullable(t.String())),
        currency: t.Optional(t.String()),
        customerPaymentTermType: t.Optional(t.Nullable(PaymentTermTypeSchema)),
        customerCreditDays: t.Optional(t.Nullable(t.Number())),
        customerNote: t.Optional(t.Nullable(t.String())),
        purchaseOrderNumber: t.Optional(t.Nullable(t.String())),
        customerContactId: t.Optional(t.Nullable(t.String())),
        supplierId: t.Optional(t.Nullable(t.String())),
        supplierPaymentTermType: t.Optional(t.Nullable(PaymentTermTypeSchema)),
        supplierCreditDays: t.Optional(t.Nullable(t.Number())),
        supplierDueDate: t.Optional(t.Nullable(t.String())),
        supplierNote: t.Optional(t.Nullable(t.String())),
        supplierContactId: t.Optional(t.Nullable(t.String())),
        brokerId: t.Optional(t.Nullable(t.String())),
        brokerContactId: t.Optional(t.Nullable(t.String())),
        brokerGetsAll: t.Optional(t.Boolean()),
        agentId: t.Optional(t.Nullable(t.String())),
        agentContactId: t.Optional(t.Nullable(t.String())),
        termsAndConditions: t.Optional(t.Nullable(t.String())),
        placeRemark: t.Optional(t.Nullable(t.String())),
        status: t.Optional(t.String()),
        eta: t.Optional(t.Nullable(t.String())),
        etd: t.Optional(t.Nullable(t.String())),
        deliveredAt: t.Optional(t.Nullable(t.String())),
        deliveryMethod: t.Optional(t.Nullable(t.String())),
        responseDeadlineAt: t.Optional(t.Nullable(t.String())),
        lossReason: t.Optional(t.Nullable(t.String())),
        isBrokerDeal: t.Optional(t.Boolean()),
        commissionPerMt: t.Optional(t.Nullable(t.String())),
        dealType: t.Optional(t.Nullable(t.String())),
        tpcPerMt: t.Optional(t.Nullable(t.String())),
        tpcCurrency: t.Optional(t.Nullable(t.String())),
        traderCommissionPct: t.Optional(t.Nullable(t.String())),
        customFields: t.Optional(t.Record(t.String(), t.Union([t.String(), t.Number(), t.Null()]))),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Update an order',
      },
    },
  )

  // ─── Update Status ────────────────────────────────────────────────
  .put(
    '/:id/status',
    async ({ params, body, auth }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };
        let order: Awaited<ReturnType<typeof getOrderById>> | null = null;
        if (body.status === 'CONFIRMED' || body.status === 'CANCELLED') {
          order = await getOrderById(orderId);
        }

        if (body.status === 'CONFIRMED') {
          if (!order?.items?.length) {
            return { success: false, data: null, message: 'Add at least one line item before converting to order' };
          }
          // Server-side credit enforcement: every CREDIT term on the deal must
          // be backed by same-currency availability at the moment of conversion.
          // Only on a real transition — re-saving CONFIRMED must not fail on
          // the deal's own usage, which already counts against the line.
          if (order.status !== 'CONFIRMED') {
            await assertCreditForConfirmation(orderId);
          }
        }

        if (body.status === 'CANCELLED') {
          if (order && (order.status === 'DELIVERED' || order.status === 'INVOICED' || order.status === 'PAID')) {
            return { success: false, data: null, message: 'Cannot cancel an order after delivery' };
          }
          const reason = body.lossReason?.trim();
          if (!reason) {
            return { success: false, data: null, message: 'Cancellation reason is required' };
          }

          const reasonSettings = await getInquiryCancelReasonSettings();
          const isOtherReason = reasonSettings.reasons.includes('Other') && reason.startsWith('Other:');
          if (!isOtherReason && !reasonSettings.reasons.includes(reason)) {
            return { success: false, data: null, message: 'Invalid cancellation reason' };
          }
        }

        // Determine actual status: cancelling an inquiry → LOST, cancelling an order → CANCELLED
        let actualStatus = body.status;
        if (body.status === 'CANCELLED' && order) {
          if (order.status === 'INQUIRY' || order.status === 'OFFER') {
            actualStatus = 'LOST';
          }
        }

        const updated = await updateOrderStatus(
          orderId,
          actualStatus,
          auth.sub,
          body.lossReason?.trim(),
          body.skipDeliveryDocumentation,
        );
        if (!updated) {
          return { success: false, data: null, message: 'Order not found' };
        }

        // Auto-send the Bunker Booking email when converting to an order
        // (CONFIRMED), if enabled in Admin Settings. A failed email must never
        // break the conversion.
        if (body.status === 'CONFIRMED') {
          try {
            const { autoSendOnConvert } = await getBookingEmailSettings();
            if (autoSendOnConvert) {
              const fullOrder = await getOrderById(orderId);
              if (fullOrder) {
                const [senderUser] = await db
                  .select({ name: users.name, email: users.email, phone: users.phone, skype: users.skype, whatsapp: users.whatsapp })
                  .from(users)
                  .where(eq(users.id, auth.sub))
                  .limit(1);
                const senderName = senderUser?.name ?? 'Fueld';
                const { subject, body: htmlBody } = await composeBookingEmail(fullOrder, senderUser
                  ? { name: senderName, email: senderUser.email, phone: senderUser.phone, skype: senderUser.skype, whatsapp: senderUser.whatsapp }
                  : 'Fueld');
                const { to, cc, bcc } = await resolveBookingRecipients(fullOrder);
                if (to.length) {
                  await sendDocumentEmail({
                    documentType: 'BUNKER_BOOKING',
                    orderId,
                    tenantId: auth.tenantId,
                    sentByUserId: auth.sub,
                    senderEmail: auth.email,
                    senderName,
                    recipientEmails: to,
                    ccEmails: cc,
                    bccEmails: bcc,
                    subject,
                    htmlBody,
                  });
                  // Flip the "Sendt Bunker Booking" indicator to green.
                  await setOrderBunkerBookingSent(orderId, true, auth.tenantId);
                }
              }
            }
          } catch (bookingErr) {
            console.error('[Orders] Auto booking email failed:', bookingErr);
          }
        }

        return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
      } catch (err) {
        console.error('[Orders] Status update failed:', err);
        return {
          success: false,
          data: null,
          message: err instanceof Error ? err.message : 'Failed to update status',
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        status: t.String(),
        lossReason: t.Optional(t.String()),
        skipDeliveryDocumentation: t.Optional(t.Boolean()),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Change order status (e.g. INQUIRY → OFFER, OFFER → CONFIRMED)',
      },
    },
  )

  // ─── Batch status update (batch complete invoiced orders) ─────────
  .put(
    '/batch/status',
    async ({ body, auth }) => {
      try {
        const { orderIds, status } = body;
        if (!orderIds.length || orderIds.length > 20) {
          return { success: false, data: null, message: 'Select between 1 and 20 orders' };
        }
        const results: { id: string; success: boolean; message?: string }[] = [];
        for (const orderId of orderIds) {
          try {
            const updated = await updateOrderStatus(orderId, status, auth.sub);
            if (updated) {
              results.push({ id: orderId, success: true });
            } else {
              results.push({ id: orderId, success: false, message: 'Order not found' });
            }
          } catch (err: any) {
            results.push({ id: orderId, success: false, message: err?.message ?? 'Failed' });
          }
        }
        const succeeded = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success);
        const message = failed.length
          ? `${succeeded} order(s) updated, ${failed.length} failed`
          : `${succeeded} order(s) marked as ${status.toLowerCase()}`;
        return { success: failed.length === 0, data: { results, succeeded, failed: failed.length }, message } satisfies ApiResponse<unknown>;
      } catch (err) {
        console.error('[Orders] Batch status update failed:', err);
        return { success: false, data: null, message: 'Failed to batch update orders' };
      }
    },
    {
      body: t.Object({
        orderIds: t.Array(t.String(), { maxItems: 20 }),
        status: t.String(),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Batch update order status (max 20 orders at once)',
      },
    },
  )

  // ─── Save Order Items ─────────────────────────────────────────────
  .put(
    '/:id/items',
    async ({ params, body, auth }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: [], message: 'Order not found' };
        const items = await saveOrderItems(orderId, body.items);

        await logActivity({
          userId: auth.sub,
          action: 'UPDATE',
          entityType: 'order',
          entityId: orderId,
          metadata: { action: 'save_items', itemCount: items.length },
        });

        return { success: true, data: items } satisfies ApiResponse<typeof items>;
      } catch (err) {
        console.error('[Orders] Save items failed:', err);
        // Forward the thrower's message, as the order-PUT handler does. The
        // hard-coded string made the client's own message-surfacing inert for
        // this path: saveOrderItems throws actionable reasons (e.g. "Order item
        // supplier must belong to the same order", "Each order item must specify
        // a supplier when an order has multiple suppliers", the CREDIT_NOTE
        // negative-cost rule) and all of them were flattened to one generic line.
        const message = err instanceof Error ? err.message : 'Failed to save items';
        return { success: false, data: [], message };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        items: t.Array(
          t.Object({
            id: t.Optional(t.String()),
            orderSupplierId: t.Optional(t.Nullable(t.String())),
            productType: t.String(),
            quantity: t.String(),
            quantityMin: t.Optional(t.Nullable(t.String())),
            quantityMax: t.Optional(t.Nullable(t.String())),
            unit: t.Optional(t.String()),
            costUnit: t.Optional(t.String()),
            salesUnit: t.Optional(t.String()),
            costConversionFactor: t.Optional(t.Nullable(t.String())),
            unitConversionFactor: t.Optional(t.Nullable(t.String())),
            description: t.Optional(t.Nullable(t.String())),
            costPrice: t.Optional(t.Nullable(t.String())),
            costCurrency: t.Optional(t.Nullable(t.String())),
            salesPrice: t.Optional(t.Nullable(t.String())),
            salesCurrency: t.Optional(t.Nullable(t.String())),
            paymentTerms: t.Optional(t.Nullable(t.String())),
            customerNote: t.Optional(t.Nullable(t.String())),
            deliveredQuantity: t.Optional(t.Nullable(t.String())),
            // Formula pricing (cost side)
            costPricingModel: t.Optional(t.Nullable(t.String())),
            costReferenceId: t.Optional(t.Nullable(t.String())),
            costPlattsEntryId: t.Optional(t.Nullable(t.String())),
            costPremium: t.Optional(t.Nullable(t.String())),
            costBarging: t.Optional(t.Nullable(t.String())),
            costBargingUnit: t.Optional(t.Nullable(t.String())),
            // Accept string too — older frontend builds serialize credit days as
            // strings in the item payload; a strict Number here 422s the whole
            // items save and silently loses every line item (see save_items
            // activity logs with itemCount: 0 + missing items after refresh).
            costCreditDays: t.Optional(t.Nullable(t.Union([t.Number(), t.String()]))),
            costPriceFinalized: t.Optional(t.Nullable(t.Boolean())),
            // Formula pricing (sell side)
            salesPricingModel: t.Optional(t.Nullable(t.String())),
            salesReferenceId: t.Optional(t.Nullable(t.String())),
            salesPlattsEntryId: t.Optional(t.Nullable(t.String())),
            salesPremium: t.Optional(t.Nullable(t.String())),
            salesBarging: t.Optional(t.Nullable(t.String())),
            salesBargingUnit: t.Optional(t.Nullable(t.String())),
            salesCreditDays: t.Optional(t.Nullable(t.Union([t.Number(), t.String()]))),
            salesPriceFinalized: t.Optional(t.Nullable(t.Boolean())),
            taxRate: t.Optional(t.Nullable(t.String())),
            commissionPerUnit: t.Optional(t.Nullable(t.String())),
            hideOnDocuments: t.Optional(t.Boolean()),
            // Inventory linkage — the frontend payload includes these; without
            // declaring them Elysia strips the keys and every items save
            // re-inserts rows with the linkage nulled out (silent wipe).
            inventorySkuId: t.Optional(t.Nullable(t.String())),
            warehouseId: t.Optional(t.Nullable(t.String())),
            plannedInventoryAt: t.Optional(t.Nullable(t.String())),
          }),
        ),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Replace all line items for an order',
      },
    },
  )

  // ─── Finalize Formula Price ──────────────────────────────────────
  .post(
    '/:id/items/:itemId/finalize-price',
    async ({ params, body, auth }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };
        const updated = await finalizeItemPrice(orderId, params.itemId, {
          side: body.side as 'cost' | 'sales',
          finalPrice: body.finalPrice,
        });

        await logActivity({
          userId: auth.sub,
          action: 'UPDATE',
          entityType: 'order',
          entityId: orderId,
          metadata: { action: 'finalize_price', itemId: params.itemId, side: body.side },
        });

        return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
      } catch (err) {
        console.error('[Orders] Finalize price failed:', err);
        const message = err instanceof Error ? err.message : 'Failed to finalize price';
        return { success: false, data: null, message };
      }
    },
    {
      params: t.Object({ id: t.String(), itemId: t.String() }),
      body: t.Object({
        side: t.Union([t.Literal('cost'), t.Literal('sales')]),
        finalPrice: t.String(),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Finalize a formula-priced order item with the resolved reference price',
      },
    },
  )

  // ─── Order Attachments ───────────────────────────────────────────
  .get(
    '/:id/attachments',
    async ({ params }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: [], message: 'Order not found' };
        const attachments = await listOrderAttachments(orderId);
        return { success: true, data: attachments } satisfies ApiResponse<typeof attachments>;
      } catch (err) {
        console.error('[Orders] List attachments failed:', err);
        return { success: false, data: [], message: 'Failed to load attachments' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Orders'],
        summary: 'List attachments for an order',
      },
    },
  )

  // ─── Order Payments (ledger) ─────────────────────────────────────
  .get(
    '/:id/payments',
    async ({ params }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: [], message: 'Order not found' };
        const payments = await listOrderPayments(orderId);
        return { success: true, data: payments } satisfies ApiResponse<typeof payments>;
      } catch (err) {
        console.error('[Orders] List payments failed:', err);
        return { success: false, data: [], message: 'Failed to load payments' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Orders'],
        summary: 'List payments for an order',
      },
    },
  )
  .post(
    '/:id/payments',
    async ({ params, body, auth, set }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount < 0) {
          set.status = 400;
          return { success: false, data: null, message: 'Invalid payment amount' };
        }
        const created = await createOrderPayment(orderId, {
          amount: body.amount,
          currency: body.currency,
          receivedAt: body.receivedAt ?? null,
          method: body.method ?? null,
          note: body.note ?? null,
          createdBy: auth.sub,
        });
        if (!created) return { success: false, data: null, message: 'Order not found' };
        return { success: true, data: created } satisfies ApiResponse<typeof created>;
      } catch (err) {
        console.error('[Orders] Create payment failed:', err);
        return { success: false, data: null, message: 'Failed to add payment' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        amount: t.String(),
        currency: t.String(),
        receivedAt: t.Optional(t.String()),
        method: t.Optional(t.Nullable(t.String())),
        note: t.Optional(t.Nullable(t.String())),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Create a payment ledger entry for an order',
      },
    },
  )
  .post(
    '/:id/attachments',
    async ({ params, body, auth }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };

        const file = body.file;
        const allowed = [
          'application/pdf',
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/heic',
        ];
        if (!allowed.includes(file.type)) {
          return { success: false, data: null, message: 'Only PDF or image files are allowed' };
        }
        if (file.size > 10 * 1024 * 1024) {
          return { success: false, data: null, message: 'Attachment must be under 10 MB' };
        }

        const attachmentType = String(body.type ?? '').trim().toUpperCase();
        const configuredAttachmentTypes = (await getAttachmentTypeSettings()).attachmentTypes;
        if (!configuredAttachmentTypes.includes(attachmentType)) {
          return { success: false, data: null, message: 'Invalid attachment type' };
        }

        const ext = (file.name.split('.').pop() ?? '').toLowerCase();
        const allowedExtensions = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic']);
        if (!allowedExtensions.has(ext)) {
          return { success: false, data: null, message: 'Only PDF or image files are allowed' };
        }
        const filename = `${orderId}-${crypto.randomUUID()}.${ext}`;
        const { join } = await import('path');
        const { mkdir } = await import('fs/promises');
        const dir = join(process.cwd(), 'uploads/attachments');
        await mkdir(dir, { recursive: true });
        await Bun.write(join(dir, filename), file);

        const record = await createOrderAttachment({
          orderId,
          type: attachmentType,
          fileName: file.name,
          filePath: `/uploads/attachments/${filename}`,
          mimeType: file.type,
          fileSize: file.size,
          category: body.category ? String(body.category).trim().toUpperCase() : null,
          uploadedBy: auth.sub,
        });

        if (!record) {
          return { success: false, data: null, message: 'Failed to save attachment' };
        }

        return { success: true, data: record } satisfies ApiResponse<typeof record>;
      } catch (err) {
        console.error('[Orders] Upload attachment failed:', err);
        return { success: false, data: null, message: 'Failed to upload attachment' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        file: t.File(),
        type: t.String(),
        category: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Upload an attachment for an order',
      },
    },
  )
  .delete(
    '/:id/attachments/:attachmentId',
    async ({ params, auth }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };

        await deleteOrderAttachment(params.attachmentId, orderId);
        return { success: true, data: { deleted: true } } satisfies ApiResponse<{ deleted: boolean }>;
      } catch (err) {
        console.error('[Orders] Delete attachment failed:', err);
        const message = err instanceof Error ? err.message : 'Failed to delete attachment';
        return { success: false, data: null, message };
      }
    },
    {
      params: t.Object({ id: t.String(), attachmentId: t.String() }),
      detail: {
        tags: ['Orders'],
        summary: 'Soft-delete an attachment from an order (file retained on disk)',
      },
    },
  )
  .patch(
    '/:id/attachments/:attachmentId',
    async ({ params, body }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };

        const newType = String(body.type ?? '').trim().toUpperCase();
        const configuredAttachmentTypes = (await getAttachmentTypeSettings()).attachmentTypes;
        if (!configuredAttachmentTypes.includes(newType)) {
          return { success: false, data: null, message: 'Invalid attachment type' };
        }

        const updated = await updateOrderAttachmentType(params.attachmentId, orderId, newType);
        if (!updated) {
          return { success: false, data: null, message: 'Attachment not found' };
        }

        // If a category was provided, update it as well
        let finalRecord = updated;
        if (body.category !== undefined) {
          const catResult = await updateOrderAttachmentCategory(
            params.attachmentId,
            orderId,
            body.category ? String(body.category).trim().toUpperCase() : null,
          );
          if (catResult) finalRecord = catResult;
        }

        return { success: true, data: finalRecord } satisfies ApiResponse<typeof finalRecord>;
      } catch (err) {
        console.error('[Orders] Update attachment type failed:', err);
        return { success: false, data: null, message: 'Failed to update attachment type' };
      }
    },
    {
      params: t.Object({ id: t.String(), attachmentId: t.String() }),
      body: t.Object({
        type: t.String(),
        category: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Update the type (and optionally category) of an order attachment',
      },
    },
  )

  .get(
    '/:id/photos',
    async ({ params, auth }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };

        const photos = await listOrderPhotos(orderId);
        return { success: true, data: photos } satisfies ApiResponse<typeof photos>;
      } catch (err) {
        console.error('[Orders] List order photos failed:', err);
        return { success: false, data: null, message: 'Failed to list photos' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Orders'],
        summary: 'List all photo (image) attachments for an order',
      },
    },
  )

  // ─── Payment schedule (split payment terms) ───────────────────────
  .get(
    '/:id/payment-schedule',
    async ({ params, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) { set.status = 404; return { success: false, data: null, message: 'Order not found' }; }
      const schedule = await listOrderPaymentSchedule(orderId);
      return { success: true, data: schedule } satisfies ApiResponse<typeof schedule>;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Orders'], summary: "Get an order's payment schedule (split terms)" },
    },
  )
  .put(
    '/:id/payment-schedule',
    async ({ params, body, auth, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) { set.status = 404; return { success: false, data: null, message: 'Order not found' }; }
      try {
        const schedule = await setOrderPaymentSchedule(orderId, body.tranches);
        await logActivity({
          userId: auth.sub,
          tenantId: auth.tenantId,
          action: 'UPDATE',
          entityType: 'order',
          entityId: orderId,
          metadata: { event: 'PAYMENT_SCHEDULE_SET', tranches: schedule.length },
        });
        return { success: true, data: schedule } satisfies ApiResponse<typeof schedule>;
      } catch (err) {
        // A schedule that does not total 100%, or one that would restate already
        // issued invoices, is the trader's to fix — a 400, not a 500.
        if (!(err instanceof InvalidScheduleError)) throw err;
        set.status = 400;
        return { success: false, data: null, message: err.message };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        tranches: t.Array(t.Object({
          label: t.Optional(t.Nullable(t.String())),
          percent: t.Number(),
          dueBasis: t.Union([t.Literal('ON_ISSUE'), t.Literal('FROM_DELIVERY'), t.Literal('FIXED_DATE')]),
          creditDays: t.Optional(t.Nullable(t.Number())),
          fixedDueDate: t.Optional(t.Nullable(t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }))),
        })),
      }),
      detail: { tags: ['Orders'], summary: "Replace an order's payment schedule (split terms)" },
    },
  )

  // ─── Void / reissue an issued invoice ────────────────────────────
  // An issued invoice never re-renders (number, amount and due date are frozen
  // on the row), so this is the ONLY correction path. Voiding keeps the original
  // for audit and issues a fresh invoice with a new number.
  .post(
    '/:id/invoice/void',
    async ({ params, body, auth, set }) => {
      try {
        // Voiding a receivable and minting a replacement number is as
        // destructive as deleting an order, so it carries the same gate as the
        // DELETE route below: admin only, and only for the caller's own tenant.
        if (auth.role !== 'ADMIN') {
          set.status = 403;
          return { success: false, data: null, message: 'Admin access required to void an invoice' };
        }
        const orderId = await resolveOrderId(params.id);
        if (!orderId) { set.status = 404; return { success: false, data: null, message: 'Order not found' }; }
        const [ownership] = await db
          .select({ tenantId: orders.tenantId })
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1);
        if (!ownership || ownership.tenantId !== auth.tenantId) {
          set.status = 404;
          return { success: false, data: null, message: 'Order not found' };
        }

        const result = await voidOrderInvoice(orderId, {
          reissue: body.reissue ?? true,
          ...(body.dueDate ? { dueDate: body.dueDate } : {}),
          ...(body.invoiceId ? { invoiceId: body.invoiceId } : {}),
        });

        await logActivity({
          userId: auth.sub,
          tenantId: auth.tenantId,
          action: 'UPDATE',
          entityType: 'order',
          entityId: orderId,
          metadata: {
            event: 'INVOICE_VOIDED',
            voidedInvoiceNumber: result.voided.invoiceNumber,
            reissuedInvoiceNumber: result.replacement?.invoiceNumber ?? null,
            reason: body.reason ?? null,
          },
        });

        return { success: true, data: result } satisfies ApiResponse<typeof result>;
      } catch (err) {
        console.error('[Orders] Void invoice failed:', err);
        // Only domain refusals become 400s. An unexpected failure must stay a
        // 500 (and not leak a raw driver message to the client).
        const isDomainRefusal = err instanceof InvoiceNotFoundError
          || err instanceof InvoiceAlreadyVoidError
          || err instanceof MixedCurrencyInvoiceError
          || err instanceof InvoiceLinesChangedError
          || err instanceof UnpricedScheduleError
          || err instanceof AmbiguousInvoiceError
          || err instanceof InternalTransferHasNoInvoiceError;
        set.status = isDomainRefusal ? 400 : 500;
        const message = isDomainRefusal && err instanceof Error ? err.message : 'Failed to void invoice';
        return { success: false, data: null, message };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        reissue: t.Optional(t.Boolean({ description: 'Issue a replacement invoice with a new number (default true)' })),
        reason: t.Optional(t.Nullable(t.String({ description: 'Why the invoice is being voided (audit log)' }))),
        dueDate: t.Optional(t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Correct the replacement due date (YYYY-MM-DD); defaults to the original' })),
        invoiceId: t.Optional(t.String({ description: 'With split payment terms, which tranche invoice to void (required when the order has several live invoices)' })),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Void an issued invoice and optionally reissue it',
      },
    },
  )

  // ─── Delete Order ─────────────────────────────────────────────────
  .delete(
    '/:id',
    async ({ params, auth }) => {
      try {
        // Only admins may hard-delete an order (e.g. a delivered inquiry that must be removed).
        if (auth.role !== 'ADMIN') {
          return { success: false, data: null, message: 'Admin access required to delete an order' };
        }
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };
        // Ensure the order belongs to the caller's tenant before deleting.
        const [orderRow] = await db
          .select({ tenantId: orders.tenantId })
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1);
        if (!orderRow || orderRow.tenantId !== auth.tenantId) {
          return { success: false, data: null, message: 'Order not found' };
        }
        const deleted = await deleteOrder(orderId);
        if (!deleted) {
          return { success: false, data: null, message: 'Order not found' };
        }

        await logActivity({
          userId: auth.sub,
          action: 'DELETE',
          entityType: 'order',
          entityId: orderId,
        });

        return { success: true, data: deleted } satisfies ApiResponse<typeof deleted>;
      } catch (err) {
        console.error('[Orders] Delete failed:', err);
        return { success: false, data: null, message: 'Failed to delete order' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Orders'],
        summary: 'Delete an order and its line items',
      },
    },
  );
