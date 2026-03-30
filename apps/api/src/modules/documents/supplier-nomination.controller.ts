import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import type { ApiResponse, PublicSupplierNominationDto, SupplierNominationAttachmentDto } from '@fueld/types';
import { db } from '../../db';
import { companyContacts, counterparties } from '../../db/schema';
import { createOrderAttachment, getOrderById } from '../orders/orders.service';
import {
  expireSupplierNomination,
  getSupplierNominationByToken,
  linkOrderAttachmentToSupplierNomination,
  listSupplierNominationAttachments,
  markSupplierNominationOpened,
  saveSupplierNominationResponse,
} from './supplier-nomination.service';

function isNominationLinkClosed(orderStatus: string | null | undefined): boolean {
  const normalized = String(orderStatus ?? '').toUpperCase();
  return normalized === 'DELIVERED'
    || normalized === 'INVOICED'
    || normalized === 'PAID'
    || normalized === 'CANCELLED';
}

async function resolveActiveNominationByToken(rawToken: string) {
  const nomination = await getSupplierNominationByToken(rawToken);
  if (!nomination) return { nomination: null, order: null };

  if (nomination.status === 'SUPERSEDED' || nomination.status === 'EXPIRED') {
    return { nomination: null, order: null };
  }

  const order = await getOrderById(nomination.orderId);
  if (!order || isNominationLinkClosed(order.status)) {
    await expireSupplierNomination(nomination.id);
    return { nomination: null, order: null };
  }

  return { nomination, order };
}

export const supplierNominationController = new Elysia({ prefix: '/supplier-nominations' })
  .get(
    '/:token',
    async ({ params, set }): Promise<ApiResponse<PublicSupplierNominationDto | null>> => {
      const resolved = await resolveActiveNominationByToken(params.token);
      if (!resolved.nomination || !resolved.order) {
        set.status = 404;
        return { success: false, data: null, message: 'Supplier nomination link is invalid or expired' };
      }

      const nomination = await markSupplierNominationOpened(resolved.nomination);
      const nominationItems = (resolved.order.items ?? []).filter((item) => {
        if (!nomination.orderSupplierId) return true;
        const supplierCount = resolved.order.orderSuppliers?.length ?? 0;
        if (supplierCount <= 1) return true;
        return item.orderSupplierId === nomination.orderSupplierId;
      });
      const [attachments, supplier, contact] = await Promise.all([
        listSupplierNominationAttachments(nomination.id),
        db
          .select({ name: counterparties.name })
          .from(counterparties)
          .where(eq(counterparties.id, nomination.supplierId))
          .limit(1)
          .then((rows) => rows[0] ?? null),
        nomination.contactId
          ? db
              .select({ name: companyContacts.name })
              .from(companyContacts)
              .where(eq(companyContacts.id, nomination.contactId))
              .limit(1)
              .then((rows) => rows[0] ?? null)
          : Promise.resolve(null),
      ]);

      return {
        success: true,
        data: {
          supplierName: supplier?.name ?? 'Supplier',
          contactName: contact?.name ?? null,
          vesselName: resolved.order.vessel?.name ?? 'Vessel',
          vesselImo: resolved.order.vessel?.imo ?? null,
          portName: resolved.order.place?.name ?? 'Port',
          eta: resolved.order.eta ?? null,
          etd: resolved.order.etd ?? null,
          orderNumber: resolved.order.orderNumber ?? null,
          status: nomination.status,
          sentAt: nomination.sentAt.toISOString(),
          openedAt: nomination.openedAt?.toISOString() ?? null,
          respondedAt: nomination.respondedAt?.toISOString() ?? null,
          deliveryCompletedConfirmed: nomination.deliveryCompletedConfirmed,
          deliveryCompletedAt: nomination.deliveryCompletedAt?.toISOString() ?? null,
          supplierReference: nomination.supplierReference ?? null,
          supplierComment: nomination.supplierComment ?? null,
          attachments,
          items: nominationItems.map((item) => ({
            orderItemId: item.id,
            productType: item.productType as any,
            quantity: item.quantity,
            unit: item.unit ?? 'MT',
            description: item.description ?? null,
          })),
        },
      };
    },
    {
      params: t.Object({ token: t.String() }),
      detail: {
        tags: ['Documents'],
        summary: 'Get supplier nomination response form data (public)',
      },
    },
  )
  .post(
    '/:token/respond',
    async ({ params, body, set }): Promise<ApiResponse<{ submitted: boolean } | null>> => {
      const resolved = await resolveActiveNominationByToken(params.token);
      if (!resolved.nomination || !resolved.order) {
        set.status = 404;
        return { success: false, data: null, message: 'Supplier nomination link is invalid or expired' };
      }

      const result = await saveSupplierNominationResponse({
        nomination: resolved.nomination,
        deliveryCompletedConfirmed: body.deliveryCompletedConfirmed,
        deliveryCompletedAt: body.deliveryCompletedAt,
        supplierReference: body.supplierReference ?? null,
        supplierComment: body.supplierComment ?? null,
      });

      if (!result.success) {
        set.status = 400;
        return { success: false, data: null, message: result.message };
      }

      return { success: true, data: { submitted: true } };
    },
    {
      params: t.Object({ token: t.String() }),
      body: t.Object({
        deliveryCompletedConfirmed: t.Boolean(),
        deliveryCompletedAt: t.String(),
        supplierReference: t.Optional(t.Nullable(t.String())),
        supplierComment: t.Optional(t.Nullable(t.String())),
      }),
      detail: {
        tags: ['Documents'],
        summary: 'Submit supplier nomination response (public)',
      },
    },
  )
  .post(
    '/:token/attachments',
    async ({ params, body, set }): Promise<ApiResponse<SupplierNominationAttachmentDto | null>> => {
      const resolved = await resolveActiveNominationByToken(params.token);
      if (!resolved.nomination || !resolved.order) {
        set.status = 404;
        return { success: false, data: null, message: 'Supplier nomination link is invalid or expired' };
      }

      const file = body.file;
      const allowed = [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
      ];
      if (!allowed.includes(file.type)) {
        set.status = 400;
        return { success: false, data: null, message: 'Only PDF or image files are allowed' };
      }
      if (file.size > 10 * 1024 * 1024) {
        set.status = 400;
        return { success: false, data: null, message: 'Attachment must be under 10 MB' };
      }

      const ext = file.name.split('.').pop() ?? 'bin';
      const filename = `${resolved.order.id}-${randomUUID()}.${ext}`;
      const dir = join(process.cwd(), 'uploads/attachments');
      await mkdir(dir, { recursive: true });
      await Bun.write(join(dir, filename), file);

      const record = await createOrderAttachment({
        orderId: resolved.order.id,
        type: 'BDR',
        fileName: file.name,
        filePath: `/uploads/attachments/${filename}`,
        mimeType: file.type,
        fileSize: file.size,
        uploadedBy: null,
      });

      if (!record) {
        set.status = 400;
        return { success: false, data: null, message: 'Failed to save attachment' };
      }

      await linkOrderAttachmentToSupplierNomination({
        supplierNominationId: resolved.nomination.id,
        orderAttachmentId: record.id,
      });

      return {
        success: true,
        data: {
          id: record.id,
          fileName: record.fileName,
          fileSize: record.fileSize,
          createdAt: record.createdAt.toISOString(),
        },
      };
    },
    {
      params: t.Object({ token: t.String() }),
      body: t.Object({ file: t.File() }),
      detail: {
        tags: ['Documents'],
        summary: 'Upload BDR attachment to a supplier nomination response (public)',
      },
    },
  );