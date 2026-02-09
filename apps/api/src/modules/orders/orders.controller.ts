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
  createOrder,
  updateOrder,
  deleteOrder,
  saveOrderItems,
  updateOrderStatus,
  getOrderActivity,
  resolveOrderId,
} from './orders.service';
import { logActivity } from '../activity/activity.service';
import type { ApiResponse } from '@fueld/types';
import { db } from '../../db';
import { users } from '../../db/schema';
import { eq } from 'drizzle-orm';

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
        return { success: false, data: null, message: 'Failed to fetch order' };
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
          currency: body.currency,
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
        currency: t.Optional(t.String()),
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
        const updated = await updateOrder(orderId, body);
        if (!updated) {
          return { success: false, data: null, message: 'Order not found' };
        }

        await logActivity({
          userId: auth.sub,
          action: 'UPDATE',
          entityType: 'order',
          entityId: orderId,
          metadata: body,
        });

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
        currency: t.Optional(t.String()),
        status: t.Optional(t.String()),
        eta: t.Optional(t.Nullable(t.String())),
        etd: t.Optional(t.Nullable(t.String())),
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
        const updated = await updateOrderStatus(
          orderId,
          body.status,
          auth.sub,
          body.lossReason,
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
            productType: t.String(),
            quantity: t.String(),
            quantityMin: t.Optional(t.Nullable(t.String())),
            quantityMax: t.Optional(t.Nullable(t.String())),
            unit: t.Optional(t.String()),
            supplierId: t.Optional(t.Nullable(t.String())),
            costPrice: t.Optional(t.Nullable(t.String())),
            salesPrice: t.Optional(t.Nullable(t.String())),
            paymentTerms: t.Optional(t.Nullable(t.String())),
          }),
        ),
      }),
      detail: {
        tags: ['Orders'],
        summary: 'Replace all line items for an order',
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
