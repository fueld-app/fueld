// ═══════════════════════════════════════════════════════════════════════
//  Order Status Service — status transitions, inventory effects,
//  delivery doc validation, WhatsApp notifications
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { orders, orderItems, orderAttachments, vessels, places, counterparties } from '../../db/schema';
import { logActivity } from '../activity/activity.service';
import { sendTemplatedGroupMessage, buildProductTemplateVariables } from '../whatsapp/whatsapp.service';

export async function updateOrderStatus(
  id: string,
  newStatus: string,
  userId?: string,
  lossReason?: string,
) {
  const setData: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
  };

  if (lossReason !== undefined) setData.lossReason = lossReason;

  if (newStatus === 'CANCELLED' || newStatus === 'PAID') {
    setData.closedAt = new Date();
  }

  const [previous] = await db
    .select({ status: orders.status, orderKind: orders.orderKind })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);

  // Validate delivery documentation
  if (newStatus === 'DELIVERED') {
    const { getDeliveryDocumentationSettings } = await import('../admin/settings.service');
    const docSettings = await getDeliveryDocumentationSettings();
    if (docSettings.requireDeliveryDocumentation) {
      const requiredTypes = docSettings.deliveryDocumentationTypes;
      const deliveryDocs = await db
        .select({ type: orderAttachments.type })
        .from(orderAttachments)
        .where(
          and(
            eq(orderAttachments.orderId, id),
            isNull(orderAttachments.deletedAt),
          ),
        );
      const hasRequiredDoc = deliveryDocs.some((doc) =>
        requiredTypes.includes((doc.type ?? '').toUpperCase()),
      );
      if (!hasRequiredDoc) {
        throw new Error(
          `Missing required delivery documentation. Required types: ${requiredTypes.join(', ')}`,
        );
      }
    }
  }

  const [updated] = await db
    .update(orders)
    .set(setData)
    .where(eq(orders.id, id))
    .returning();

  if (updated && previous) {
    try {
      await applyInventoryEffectsForStatusChange({
        orderId: id,
        fromStatus: previous.status,
        toStatus: newStatus,
        userId: userId ?? null,
      });
    } catch (err) {
      console.error('[orders] Inventory effect failed on status change:', err);
    }
  }

  if (updated && userId) {
    await logActivity({
      userId,
      action: 'STATUS_CHANGE',
      entityType: 'order',
      entityId: id,
      metadata: { newStatus, lossReason },
    });
  }

  // WhatsApp notifications
  if (updated) {
    const eventType =
      newStatus === 'CONFIRMED'
        ? 'order_confirmed'
        : newStatus === 'DELIVERED'
          ? 'order_delivered'
          : null;

    if (eventType) {
      const [orderDetails] = await db
        .select({
          orderNumber: orders.orderNumber,
          tenantId: orders.tenantId,
          vesselName: vessels.name,
          placeName: places.name,
          customerName: counterparties.name,
          purchaseOrderNumber: orders.purchaseOrderNumber,
          customerNote: orders.customerNote,
        })
        .from(orders)
        .leftJoin(vessels, eq(orders.vesselId, vessels.id))
        .leftJoin(places, eq(orders.placeId, places.id))
        .leftJoin(counterparties, eq(orders.clientId, counterparties.id))
        .where(eq(orders.id, id))
        .limit(1);

      const items = await db
        .select({
          productType: orderItems.productType,
          quantity: orderItems.quantity,
          quantityMin: orderItems.quantityMin,
          unit: orderItems.unit,
          description: orderItems.description,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, id));

      if (orderDetails) {
        const productVars = buildProductTemplateVariables(items);

        sendTemplatedGroupMessage(orderDetails.tenantId, eventType, {
          ...productVars,
          orderNumber: orderDetails.orderNumber ?? id.slice(0, 8),
          vesselName: orderDetails.vesselName ?? 'Unknown Vessel',
          portName: orderDetails.placeName ?? 'Unknown Port',
          customerName: orderDetails.customerName ?? 'Unknown Customer',
          status: newStatus,
          poNumber: orderDetails.purchaseOrderNumber ?? '',
          notes: orderDetails.customerNote ?? '',
        }).catch((err) => {
          console.error(`[orders] WhatsApp ${eventType} notification failed:`, err);
        });
      }
    }
  }

  return updated ?? null;
}

async function applyInventoryEffectsForStatusChange(args: {
  orderId: string;
  fromStatus: string;
  toStatus: string;
  userId: string | null;
}) {
  const { orderId, toStatus, userId } = args;
  const inv = await import('../inventory/inventory.service');
  const { orderTransfers } = await import('../../db/schema');

  const [order] = await db
    .select({
      id: orders.id,
      tenantId: orders.tenantId,
      orderKind: orders.orderKind,
      eta: orders.eta,
      etd: orders.etd,
      deliveredAt: orders.deliveredAt,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return;

  const items = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      quantity: orderItems.quantity,
      unit: orderItems.unit,
      inventorySkuId: orderItems.inventorySkuId,
      warehouseId: orderItems.warehouseId,
      plannedInventoryAt: orderItems.plannedInventoryAt,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  const [transfer] =
    order.orderKind === 'INTERNAL_TRANSFER'
      ? await db
          .select()
          .from(orderTransfers)
          .where(eq(orderTransfers.orderId, orderId))
          .limit(1)
      : [];

  const eventTime = (
    item: { plannedInventoryAt: Date | null },
    fallback: Date | null,
  ): Date => {
    if (item.plannedInventoryAt) return item.plannedInventoryAt;
    if (fallback) return fallback;
    return new Date();
  };

  if (toStatus === 'CONFIRMED') {
    for (const item of items) {
      if (!item.inventorySkuId || !item.warehouseId) continue;
      const qty = Number(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;

      if (order.orderKind === 'EXTERNAL') {
        await inv.upsertReservation({
          warehouseId: item.warehouseId,
          skuId: item.inventorySkuId,
          quantity: qty,
          unit: item.unit,
          reservedFor: eventTime(item, order.eta ?? order.etd ?? null),
          orderId,
          orderItemId: item.id,
          direction: 'OUTBOUND',
        });
      } else if (order.orderKind === 'INTERNAL_TRANSFER' && transfer) {
        await inv.upsertReservation({
          warehouseId: transfer.sourceWarehouseId,
          skuId: item.inventorySkuId,
          quantity: qty,
          unit: item.unit,
          reservedFor: eventTime(item, order.etd ?? order.eta ?? null),
          orderId,
          orderItemId: item.id,
          direction: 'TRANSFER_OUT',
        });
        await inv.createReplenishmentPlan(
          {
            warehouseId: transfer.destinationWarehouseId,
            skuId: item.inventorySkuId,
            quantity: qty.toFixed(3),
            unit: item.unit,
            expectedAt: (
              transfer.plannedArrivalAt ??
              order.eta ??
              eventTime(item, null)
            ).toISOString(),
            orderId,
          },
          userId,
        );
      }
    }
  }

  if (toStatus === 'DELIVERED') {
    for (const item of items) {
      if (!item.inventorySkuId || !item.warehouseId) continue;
      const qty = Number(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;

      const occurredAt = order.deliveredAt ?? eventTime(item, new Date());

      if (order.orderKind === 'EXTERNAL') {
        await inv.recordMovement({
          warehouseId: item.warehouseId,
          skuId: item.inventorySkuId,
          quantity: -qty,
          unit: item.unit,
          movementType: 'OUTBOUND_DELIVERY',
          occurredAt,
          orderId,
          orderItemId: item.id,
          createdBy: userId,
        });
        await inv.releaseReservationByOrderItem(item.id);
      } else if (order.orderKind === 'INTERNAL_TRANSFER' && transfer) {
        await inv.recordMovement({
          warehouseId: transfer.sourceWarehouseId,
          skuId: item.inventorySkuId,
          quantity: -qty,
          unit: item.unit,
          movementType: 'TRANSFER_OUT',
          occurredAt,
          orderId,
          orderItemId: item.id,
          createdBy: userId,
        });
        await inv.recordMovement({
          warehouseId: transfer.destinationWarehouseId,
          skuId: item.inventorySkuId,
          quantity: qty,
          unit: item.unit,
          movementType: 'TRANSFER_IN',
          occurredAt,
          orderId,
          orderItemId: item.id,
          createdBy: userId,
        });
        await inv.releaseReservationByOrderItem(item.id);
      }
    }
  }

  if (toStatus === 'CANCELLED') {
    await inv.releaseReservationsByOrder(orderId);
    const { inventoryReplenishmentPlans: plans } = await import('../../db/schema');
    await db
      .update(plans)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(eq(plans.orderId, orderId));
  }
}
