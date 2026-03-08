import { Elysia, t } from 'elysia';
import { and, eq, isNull, or, gt } from 'drizzle-orm';
import type { ApiResponse, PublicSupplierInquiryDto } from '@fueld/types';
import { db } from '../../db';
import { supplierInquiries, supplierInquiryItemQuotes, counterparties, companyContacts } from '../../db/schema';
import { getOrderById } from '../orders/orders.service';
import { applyStaleSupplierInquiryStatuses, getSupplierInquiryOrderContext, hashSupplierQuoteToken, saveSupplierInquiryResponse } from './supplier-inquiry.service';

async function getSupplierInquiryByToken(rawToken: string) {
  const tokenHash = hashSupplierQuoteToken(rawToken);
  const [row] = await db
    .select()
    .from(supplierInquiries)
    .where(
      and(
        eq(supplierInquiries.quoteTokenHash, tokenHash),
        or(isNull(supplierInquiries.quoteTokenExpiresAt), gt(supplierInquiries.quoteTokenExpiresAt, new Date())),
      ),
    )
    .limit(1);
  return row ?? null;
}

export const supplierQuoteController = new Elysia({ prefix: '/supplier-inquiries' })
  .get(
    '/:token',
    async ({ params, set }): Promise<ApiResponse<PublicSupplierInquiryDto | null>> => {
      const inquiry = await getSupplierInquiryByToken(params.token);
      if (!inquiry) {
        set.status = 404;
        return { success: false, data: null, message: 'Supplier inquiry link is invalid or expired' };
      }

      await applyStaleSupplierInquiryStatuses({ inquiryId: inquiry.id });

      const refreshedInquiry = await getSupplierInquiryByToken(params.token);
      if (!refreshedInquiry) {
        set.status = 404;
        return { success: false, data: null, message: 'Supplier inquiry link is invalid or expired' };
      }

      const [order, orderContext, supplier, contact, existingQuotes] = await Promise.all([
        getOrderById(refreshedInquiry.orderId),
        getSupplierInquiryOrderContext(refreshedInquiry.orderId),
        db.select({ name: counterparties.name }).from(counterparties).where(eq(counterparties.id, refreshedInquiry.supplierId)).limit(1).then((rows) => rows[0] ?? null),
        refreshedInquiry.contactId
          ? db.select({ name: companyContacts.name }).from(companyContacts).where(eq(companyContacts.id, refreshedInquiry.contactId)).limit(1).then((rows) => rows[0] ?? null)
          : Promise.resolve(null),
        db
          .select({ orderItemId: supplierInquiryItemQuotes.orderItemId, price: supplierInquiryItemQuotes.price, currency: supplierInquiryItemQuotes.currency, note: supplierInquiryItemQuotes.note })
          .from(supplierInquiryItemQuotes)
          .where(eq(supplierInquiryItemQuotes.supplierInquiryId, refreshedInquiry.id)),
      ]);

      if (!order || !orderContext) {
        set.status = 404;
        return { success: false, data: null, message: 'Order not found' };
      }

      const quoteByItemId = new Map(existingQuotes.map((quote) => [quote.orderItemId, quote]));

      return {
        success: true,
        data: {
          supplierName: supplier?.name ?? 'Supplier',
          contactName: contact?.name ?? null,
          vesselName: order.vessel?.name ?? 'Vessel',
          vesselImo: order.vessel?.imo ?? null,
          portName: order.place?.name ?? 'Port',
          eta: order.eta ?? null,
          etd: order.etd ?? null,
          orderNumber: order.orderNumber ?? null,
          status: refreshedInquiry.status,
          canDeliver: refreshedInquiry.canDeliver ?? null,
          declineReason: refreshedInquiry.declineReason ?? null,
          responseDeadlineAt: refreshedInquiry.responseDeadlineAt?.toISOString() ?? null,
          quoteSubmittedAt: refreshedInquiry.respondedAt?.toISOString() ?? null,
          quoteValidUntil: refreshedInquiry.quoteValidUntil?.toISOString() ?? null,
          deliveryWindow: refreshedInquiry.deliveryWindow ?? null,
          supplierPaymentTerms: refreshedInquiry.supplierPaymentTerms ?? null,
          supplierComment: refreshedInquiry.supplierComment ?? null,
          currency: order.currency ?? 'USD',
          items: orderContext.items.map((item) => ({
            ...item,
            price: quoteByItemId.get(item.orderItemId)?.price ?? null,
            currency: quoteByItemId.get(item.orderItemId)?.currency ?? order.currency ?? 'USD',
            note: quoteByItemId.get(item.orderItemId)?.note ?? null,
          })),
        },
      };
    },
    {
      params: t.Object({ token: t.String() }),
      detail: {
        tags: ['Documents'],
        summary: 'Get supplier quote form data (public)',
      },
    },
  )
  .post(
    '/:token/quote',
    async ({ params, body, set }): Promise<ApiResponse<{ submitted: boolean } | null>> => {
      const inquiry = await getSupplierInquiryByToken(params.token);
      if (!inquiry) {
        set.status = 404;
        return { success: false, data: null, message: 'Supplier inquiry link is invalid or expired' };
      }

      const order = await getOrderById(inquiry.orderId);
      if (!order) {
        set.status = 404;
        return { success: false, data: null, message: 'Order not found' };
      }

      const result = await saveSupplierInquiryResponse({
        inquiry,
        status: body.canDeliver ? 'QUOTED' : 'DECLINED',
        respondedAt: new Date(),
        declineReason: body.declineReason ?? null,
        quoteValidUntil: body.quoteValidUntil ?? null,
        deliveryWindow: body.deliveryWindow ?? null,
        supplierPaymentTerms: body.supplierPaymentTerms ?? null,
        supplierComment: body.supplierComment ?? null,
        items: body.items ?? [],
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
        canDeliver: t.Boolean(),
        declineReason: t.Optional(t.Nullable(t.String())),
        quoteValidUntil: t.Optional(t.Nullable(t.String())),
        deliveryWindow: t.Optional(t.Nullable(t.String())),
        supplierPaymentTerms: t.Optional(t.Nullable(t.String())),
        supplierComment: t.Optional(t.Nullable(t.String())),
        items: t.Array(t.Object({
          orderItemId: t.String(),
          price: t.Optional(t.Nullable(t.String())),
          note: t.Optional(t.Nullable(t.String())),
        })),
      }),
      detail: {
        tags: ['Documents'],
        summary: 'Submit supplier quote response (public)',
      },
    },
  );