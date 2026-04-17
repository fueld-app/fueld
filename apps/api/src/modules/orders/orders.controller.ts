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
  getOrderActivity,
  resolveOrderId,
  listOrderAttachments,
  createOrderAttachment,
  listOrderPayments,
  createOrderPayment,
  finalizeItemPrice,
} from './orders.service';
import { logActivity } from '../activity/activity.service';
import type { ApiResponse } from '@fueld/types';
import { db } from '../../db';
import { users } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { getAttachmentTypeSettings, getInquiryCancelReasonSettings } from '../admin/settings.service';

const PaymentTermTypeSchema = t.Union([
  t.Literal('CREDIT'),
  t.Literal('COD'),
  t.Literal('PREPAY'),
]);

export const ordersController = new Elysia({ prefix: '/orders' })
  .use(authGuard)

  // ─── List Orders ───────────────────────────────────────────────────
  .get(
    '/',
    async ({ query }) => {
      try {
        const statuses = query.statuses
          ? query.statuses.split(',').map((s) => s.trim())
          : undefined;
        const results = await listOrders({
          search: query.search,
          statuses,
          salesRepId: query.salesRepId,
          brokerId: query.brokerId,
          sortBy: query.sortBy,
          sortDir: query.sortDir as 'asc' | 'desc' | undefined,
          page: query.page ? parseInt(query.page) : undefined,
          limit: query.limit ? parseInt(query.limit) : undefined,
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
        sortBy: t.Optional(t.String()),
        sortDir: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
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
        const supplier = await updateOrderSupplierRecord(orderId, params.supplierRecordId, body);
        if (!supplier) return { success: false, data: null, message: 'Order supplier not found' };
        await logActivity({
          userId: auth.sub,
          action: 'UPDATE',
          entityType: 'order',
          entityId: orderId,
          metadata: { action: 'update_supplier_leg', supplierRecordId: params.supplierRecordId },
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
          supplierId: body.supplierId ?? null,
          supplierPaymentTermType: body.supplierPaymentTermType ?? null,
          supplierCreditDays: body.supplierCreditDays ?? null,
          supplierNote: body.supplierNote ?? null,
          customerContactId: body.customerContactId ?? null,
          supplierContactId: body.supplierContactId ?? null,
          termsAndConditions: body.termsAndConditions ?? null,
          brokerId: body.brokerId ?? null,
          brokerContactId: body.brokerContactId ?? null,
          brokerGetsAll: body.brokerGetsAll ?? false,
          agentId: body.agentId ?? null,
          agentContactId: body.agentContactId ?? null,
          eta: body.eta,
          etd: body.etd,
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
        customerContactId: t.Optional(t.Nullable(t.String())),
        supplierId: t.Optional(t.Nullable(t.String())),
        supplierPaymentTermType: t.Optional(t.Nullable(PaymentTermTypeSchema)),
        supplierCreditDays: t.Optional(t.Nullable(t.Number())),
        supplierNote: t.Optional(t.Nullable(t.String())),
        supplierContactId: t.Optional(t.Nullable(t.String())),
        brokerId: t.Optional(t.Nullable(t.String())),
        brokerContactId: t.Optional(t.Nullable(t.String())),
        brokerGetsAll: t.Optional(t.Boolean()),
        agentId: t.Optional(t.Nullable(t.String())),
        agentContactId: t.Optional(t.Nullable(t.String())),
        termsAndConditions: t.Optional(t.Nullable(t.String())),
        eta: t.Optional(t.String()),
        etd: t.Optional(t.String()),
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
        const updated = await updateOrder(orderId, body, auth.sub);
        if (!updated) {
          return { success: false, data: null, message: 'Order not found' };
        }

        return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
      } catch (err) {
        console.error('[Orders] Update failed:', err);
        return { success: false, data: null, message: 'Failed to update order' };
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
        customerContactId: t.Optional(t.Nullable(t.String())),
        supplierId: t.Optional(t.Nullable(t.String())),
        supplierPaymentTermType: t.Optional(t.Nullable(PaymentTermTypeSchema)),
        supplierCreditDays: t.Optional(t.Nullable(t.Number())),
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
        lossReason: t.Optional(t.Nullable(t.String())),
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
        }

        if (body.status === 'CANCELLED') {
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

        const updated = await updateOrderStatus(
          orderId,
          body.status,
          auth.sub,
          body.lossReason?.trim(),
        );
        if (!updated) {
          return { success: false, data: null, message: 'Order not found' };
        }
        return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
      } catch (err) {
        console.error('[Orders] Status update failed:', err);
        return { success: false, data: null, message: 'Failed to update status' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        status: t.String(),
        lossReason: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Change order status (e.g. INQUIRY → OFFER, OFFER → CONFIRMED)',
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
        return { success: false, data: [], message: 'Failed to save items' };
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
            costCreditDays: t.Optional(t.Nullable(t.Number())),
            costPriceFinalized: t.Optional(t.Nullable(t.Boolean())),
            // Formula pricing (sell side)
            salesPricingModel: t.Optional(t.Nullable(t.String())),
            salesReferenceId: t.Optional(t.Nullable(t.String())),
            salesPlattsEntryId: t.Optional(t.Nullable(t.String())),
            salesPremium: t.Optional(t.Nullable(t.String())),
            salesBarging: t.Optional(t.Nullable(t.String())),
            salesBargingUnit: t.Optional(t.Nullable(t.String())),
            salesCreditDays: t.Optional(t.Nullable(t.Number())),
            salesPriceFinalized: t.Optional(t.Nullable(t.Boolean())),
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
    async ({ params, body, auth }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };
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

        const ext = file.name.split('.').pop() ?? 'bin';
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
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Upload an attachment for an order',
      },
    },
  )

  // ─── Delete Order ─────────────────────────────────────────────────
  .delete(
    '/:id',
    async ({ params, auth }) => {
      try {
        const orderId = await resolveOrderId(params.id);
        if (!orderId) return { success: false, data: null, message: 'Order not found' };
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
