// ═══════════════════════════════════════════════════════════════════════
//  Transfers Controller — INTERNAL_TRANSFER orders.
//
//  POST   /transfers                     — create transfer order
//  GET    /transfers/:orderId            — get transfer extension + sides
//  GET    /transfers/:orderId/sides      — list both finance sides
//  PATCH  /transfers/:orderId/sides/:sideId           — update side
//  POST   /transfers/:orderId/sides/:sideId/finalize  — finalize side (gates internal docs)
//  POST   /transfers/:orderId/sides/:sideId/reopen    — return finalized side to DRAFT
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import type { ApiResponse } from '@fueld/types';
import { authGuard } from '../auth/auth.guard';
import {
  createInternalTransfer,
  finalizeTransferSide,
  getOrderTransfer,
  listTransferSides,
  reopenTransferSide,
  updateTransferSide,
} from './transfers.service';

const PRIVILEGED_ROLES = new Set(['ADMIN', 'OPERATIONSMANAGER']);
const FINANCE_ROLES = new Set(['ADMIN', 'OPERATIONSMANAGER', 'FINANCE']);

function requireOpsPrivileged(auth: { role: string } | undefined): ApiResponse<null> | null {
  if (!auth || !PRIVILEGED_ROLES.has(auth.role)) {
    return { success: false, data: null, message: 'Only admins and operations managers can perform this action' };
  }
  return null;
}

function requireFinanceOrOps(auth: { role: string } | undefined): ApiResponse<null> | null {
  if (!auth || !FINANCE_ROLES.has(auth.role)) {
    return { success: false, data: null, message: 'Only finance, admins, and operations managers can perform this action' };
  }
  return null;
}

export const transfersController = new Elysia({ prefix: '/transfers' })
  .use(authGuard)

  .post(
    '/',
    async ({ body, auth, set }) => {
      const denied = requireOpsPrivileged(auth);
      if (denied) { set.status = 403; return denied; }
      try {
        const order = await createInternalTransfer(body, auth?.sub);
        return { success: true, data: order } satisfies ApiResponse<typeof order>;
      } catch (err) {
        return {
          success: false,
          data: null,
          message: err instanceof Error ? err.message : 'Failed to create transfer',
        };
      }
    },
    {
      body: t.Object({
        sourceCompanyId: t.String(),
        destinationCompanyId: t.String(),
        sourceWarehouseId: t.String(),
        destinationWarehouseId: t.String(),
        vesselId: t.String(),
        placeId: t.String(),
        plannedArrivalAt: t.Optional(t.Nullable(t.String())),
        eta: t.Optional(t.Nullable(t.String())),
        etd: t.Optional(t.Nullable(t.String())),
      }),
    },
  )

  .get(
    '/:orderId',
    async ({ params }) => {
      const transfer = await getOrderTransfer(params.orderId);
      if (!transfer) {
        return { success: false, data: null, message: 'Transfer not found' };
      }
      const sides = await listTransferSides(params.orderId);
      return {
        success: true,
        data: { transfer, sides },
      };
    },
    { params: t.Object({ orderId: t.String() }) },
  )

  .get(
    '/:orderId/sides',
    async ({ params }) => {
      const data = await listTransferSides(params.orderId);
      return { success: true, data } satisfies ApiResponse<typeof data>;
    },
    { params: t.Object({ orderId: t.String() }) },
  )

  .patch(
    '/:orderId/sides/:sideId',
    async ({ params, body, auth, set }) => {
      const denied = requireFinanceOrOps(auth);
      if (denied) { set.status = 403; return denied; }
      const updated = await updateTransferSide(params.sideId, body);
      if (!updated) return { success: false, data: null, message: 'Side not found' };
      return { success: true, data: updated };
    },
    {
      params: t.Object({ orderId: t.String(), sideId: t.String() }),
      body: t.Object({
        invoicingCompanyId: t.Optional(t.Nullable(t.String())),
        bankAccountId: t.Optional(t.Nullable(t.String())),
        paymentTermType: t.Optional(t.Nullable(t.Union([
          t.Literal('CREDIT'),
          t.Literal('COD'),
          t.Literal('PREPAY'),
        ]))),
        creditDays: t.Optional(t.Nullable(t.Number())),
        currency: t.Optional(t.String()),
        note: t.Optional(t.Nullable(t.String())),
      }),
    },
  )

  .post(
    '/:orderId/sides/:sideId/finalize',
    async ({ params, auth, set }) => {
      const denied = requireFinanceOrOps(auth);
      if (denied) { set.status = 403; return denied; }
      if (!auth?.sub) return { success: false, data: null, message: 'Unauthorized' };
      try {
        const updated = await finalizeTransferSide(params.sideId, auth.sub);
        if (!updated) return { success: false, data: null, message: 'Side not found' };
        return { success: true, data: updated };
      } catch (err) {
        return {
          success: false,
          data: null,
          message: err instanceof Error ? err.message : 'Failed to finalize side',
        };
      }
    },
    { params: t.Object({ orderId: t.String(), sideId: t.String() }) },
  )

  .post(
    '/:orderId/sides/:sideId/reopen',
    async ({ params, auth, set }) => {
      const denied = requireFinanceOrOps(auth);
      if (denied) { set.status = 403; return denied; }
      const updated = await reopenTransferSide(params.sideId);
      if (!updated) return { success: false, data: null, message: 'Side not found' };
      return { success: true, data: updated };
    },
    { params: t.Object({ orderId: t.String(), sideId: t.String() }) },
  );
