// ═══════════════════════════════════════════════════════════════════════
//  Inventory Controller
//
//  Auth: all routes require authentication. Mutations that change master
//        data (warehouses, SKUs, manual replenishment) require ADMIN or
//        OPERATIONSMANAGER. Read endpoints are open to any authenticated
//        user since operations and trading rely on visibility.
//
//  GET    /inventory/overview            — aggregated balances per warehouse+SKU
//  GET    /inventory/skus                — list SKUs
//  POST   /inventory/skus                — create SKU
//  PATCH  /inventory/skus/:id            — update SKU
//  DELETE /inventory/skus/:id            — delete (only if no movements)
//
//  GET    /inventory/warehouses          — list warehouses
//  GET    /inventory/warehouses/:id      — get one warehouse
//  POST   /inventory/warehouses          — create warehouse
//  PATCH  /inventory/warehouses/:id      — update warehouse
//
//  GET    /inventory/warehouses/:id/movements        — ledger for a warehouse
//  GET    /inventory/warehouses/:id/balance/:skuId   — balance for warehouse+SKU
//
//  GET    /inventory/replenishment-plans             — list (filter by warehouse, sku, status)
//  POST   /inventory/replenishment-plans             — create plan
//  PATCH  /inventory/replenishment-plans/:id         — update plan
//  POST   /inventory/replenishment-plans/:id/cancel  — cancel plan
//
//  POST   /inventory/check-availability   — check if (warehouse, sku, qty, neededAt) is feasible
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import type { ApiResponse } from '@fueld/types';
import { authGuard } from '../auth/auth.guard';
import {
  cancelReplenishmentPlan,
  checkAvailability,
  createInventorySku,
  createReplenishmentPlan,
  createWarehouse,
  deleteInventorySku,
  getBalance,
  getInventoryOverview,
  getInventorySkuById,
  getWarehouseById,
  listInventorySkus,
  listMovementsByWarehouse,
  listReplenishmentPlans,
  listWarehouses,
  updateInventorySku,
  updateReplenishmentPlan,
  updateWarehouse,
} from './inventory.service';

const PRIVILEGED_ROLES = new Set(['ADMIN', 'OPERATIONSMANAGER']);

function requirePrivileged(auth: { role: string } | undefined) {
  if (!auth || !PRIVILEGED_ROLES.has(auth.role)) {
    throw new Error('Only admins and operations managers can perform this action');
  }
}

export const inventoryController = new Elysia({ prefix: '/inventory' })
  .use(authGuard)

  // ─── Overview ──────────────────────────────────────────────────────
  .get(
    '/overview',
    async ({ query }) => {
      const data = await getInventoryOverview({
        ownerCompanyId: query.ownerCompanyId,
        warehouseId: query.warehouseId,
        vesselId: query.vesselId,
      });
      return { success: true, data } satisfies ApiResponse<typeof data>;
    },
    {
      query: t.Object({
        ownerCompanyId: t.Optional(t.String()),
        warehouseId: t.Optional(t.String()),
        vesselId: t.Optional(t.String()),
      }),
      detail: { tags: ['Inventory'], summary: 'Inventory overview' },
    },
  )

  // ─── SKUs ──────────────────────────────────────────────────────────
  .get('/skus', async () => {
    const data = await listInventorySkus();
    return { success: true, data } satisfies ApiResponse<typeof data>;
  })
  .get(
    '/skus/:id',
    async ({ params }) => {
      const sku = await getInventorySkuById(params.id);
      if (!sku) return { success: false, data: null, message: 'SKU not found' };
      return { success: true, data: sku } satisfies ApiResponse<typeof sku>;
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    '/skus',
    async ({ body, auth }) => {
      requirePrivileged(auth);
      const created = await createInventorySku(body as Parameters<typeof createInventorySku>[0]);
      return { success: true, data: created } satisfies ApiResponse<typeof created>;
    },
    {
      body: t.Object({
        productType: t.String(),
        grade: t.Optional(t.Nullable(t.String())),
        displayName: t.Optional(t.String()),
        baseUnit: t.Optional(t.String()),
        inventoryTracked: t.Optional(t.Boolean()),
        allowedUnits: t.Optional(t.Array(t.String())),
      }),
    },
  )
  .patch(
    '/skus/:id',
    async ({ params, body, auth }) => {
      requirePrivileged(auth);
      const updated = await updateInventorySku(params.id, body);
      if (!updated) return { success: false, data: null, message: 'SKU not found' };
      return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        grade: t.Optional(t.Nullable(t.String())),
        displayName: t.Optional(t.String()),
        baseUnit: t.Optional(t.String()),
        inventoryTracked: t.Optional(t.Boolean()),
        allowedUnits: t.Optional(t.Array(t.String())),
        active: t.Optional(t.Boolean()),
      }),
    },
  )
  .delete(
    '/skus/:id',
    async ({ params, auth }) => {
      requirePrivileged(auth);
      try {
        const ok = await deleteInventorySku(params.id);
        return { success: ok, data: null, message: ok ? undefined : 'SKU not found' };
      } catch (err) {
        return {
          success: false,
          data: null,
          message: err instanceof Error ? err.message : 'Failed to delete SKU',
        };
      }
    },
    { params: t.Object({ id: t.String() }) },
  )

  // ─── Warehouses ────────────────────────────────────────────────────
  .get(
    '/warehouses',
    async ({ query }) => {
      const data = await listWarehouses({
        ownerCompanyId: query.ownerCompanyId,
        vesselId: query.vesselId,
        inventoryEnabledOnly: query.inventoryEnabledOnly === 'true',
        activeOnly: query.activeOnly === 'true',
      });
      return { success: true, data } satisfies ApiResponse<typeof data>;
    },
    {
      query: t.Object({
        ownerCompanyId: t.Optional(t.String()),
        vesselId: t.Optional(t.String()),
        inventoryEnabledOnly: t.Optional(t.String()),
        activeOnly: t.Optional(t.String()),
      }),
    },
  )
  .get(
    '/warehouses/:id',
    async ({ params }) => {
      const data = await getWarehouseById(params.id);
      if (!data) return { success: false, data: null, message: 'Warehouse not found' };
      return { success: true, data } satisfies ApiResponse<typeof data>;
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    '/warehouses',
    async ({ body, auth }) => {
      requirePrivileged(auth);
      try {
        const created = await createWarehouse(body as Parameters<typeof createWarehouse>[0]);
        return { success: true, data: created } satisfies ApiResponse<typeof created>;
      } catch (err) {
        return {
          success: false,
          data: null,
          message: err instanceof Error ? err.message : 'Failed to create warehouse',
        };
      }
    },
    {
      body: t.Object({
        ownerCompanyId: t.String(),
        name: t.String(),
        type: t.Optional(t.String()),
        vesselId: t.Optional(t.Nullable(t.String())),
        placeId: t.Optional(t.Nullable(t.String())),
        inventoryEnabled: t.Optional(t.Boolean()),
        allowManualReplenishment: t.Optional(t.Boolean()),
        notes: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .patch(
    '/warehouses/:id',
    async ({ params, body, auth }) => {
      requirePrivileged(auth);
      const updated = await updateWarehouse(params.id, body as Parameters<typeof updateWarehouse>[1]);
      if (!updated) return { success: false, data: null, message: 'Warehouse not found' };
      return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String()),
        type: t.Optional(t.String()),
        vesselId: t.Optional(t.Nullable(t.String())),
        placeId: t.Optional(t.Nullable(t.String())),
        inventoryEnabled: t.Optional(t.Boolean()),
        allowManualReplenishment: t.Optional(t.Boolean()),
        active: t.Optional(t.Boolean()),
        notes: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .get(
    '/warehouses/:id/movements',
    async ({ params }) => {
      const data = await listMovementsByWarehouse(params.id);
      return { success: true, data } satisfies ApiResponse<typeof data>;
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get(
    '/warehouses/:id/balance/:skuId',
    async ({ params }) => {
      const bal = await getBalance(params.id, params.skuId);
      return {
        success: true,
        data: {
          warehouseId: params.id,
          skuId: params.skuId,
          onHand: bal.onHand.toFixed(3),
          reserved: bal.reserved.toFixed(3),
          availableNow: bal.availableNow.toFixed(3),
          plannedInbound: bal.plannedInbound.toFixed(3),
          plannedOutbound: bal.plannedOutbound.toFixed(3),
          earliestAvailableAt: bal.earliestAvailableAt
            ? bal.earliestAvailableAt.toISOString()
            : null,
        },
      };
    },
    { params: t.Object({ id: t.String(), skuId: t.String() }) },
  )

  // ─── Replenishment Plans ───────────────────────────────────────────
  .get(
    '/replenishment-plans',
    async ({ query }) => {
      const data = await listReplenishmentPlans({
        warehouseId: query.warehouseId,
        skuId: query.skuId,
        status: query.status as
          | 'PLANNED'
          | 'LINKED'
          | 'COMPLETED'
          | 'CANCELLED'
          | undefined,
      });
      return { success: true, data } satisfies ApiResponse<typeof data>;
    },
    {
      query: t.Object({
        warehouseId: t.Optional(t.String()),
        skuId: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    },
  )
  .post(
    '/replenishment-plans',
    async ({ body, auth }) => {
      requirePrivileged(auth);
      try {
        const created = await createReplenishmentPlan(body, auth?.sub);
        return { success: true, data: created } satisfies ApiResponse<typeof created>;
      } catch (err) {
        return {
          success: false,
          data: null,
          message: err instanceof Error ? err.message : 'Failed to create plan',
        };
      }
    },
    {
      body: t.Object({
        warehouseId: t.String(),
        skuId: t.String(),
        quantity: t.String(),
        unit: t.Optional(t.String()),
        expectedAt: t.String(),
        orderId: t.Optional(t.Nullable(t.String())),
        note: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .patch(
    '/replenishment-plans/:id',
    async ({ params, body, auth }) => {
      requirePrivileged(auth);
      const updated = await updateReplenishmentPlan(params.id, body as Parameters<typeof updateReplenishmentPlan>[1]);
      if (!updated) return { success: false, data: null, message: 'Plan not found' };
      return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        quantity: t.Optional(t.String()),
        unit: t.Optional(t.String()),
        expectedAt: t.Optional(t.String()),
        status: t.Optional(t.String()),
        orderId: t.Optional(t.Nullable(t.String())),
        note: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .post(
    '/replenishment-plans/:id/cancel',
    async ({ params, auth }) => {
      requirePrivileged(auth);
      await cancelReplenishmentPlan(params.id);
      return { success: true, data: null };
    },
    { params: t.Object({ id: t.String() }) },
  )

  // ─── Availability check ────────────────────────────────────────────
  .post(
    '/check-availability',
    async ({ body }) => {
      const result = await checkAvailability(body);
      return { success: true, data: result } satisfies ApiResponse<typeof result>;
    },
    {
      body: t.Object({
        warehouseId: t.String(),
        skuId: t.String(),
        quantity: t.String(),
        unit: t.Optional(t.String()),
        neededAt: t.String(),
      }),
    },
  );
