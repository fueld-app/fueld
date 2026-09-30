/**
 * Credit usage is measured on the DELIVERED quantity, the same basis the customer
 * is billed on.
 *
 * Reported by a customer as "we clear the invoice as paid, but it does not credit
 * the value back to the client's credit line". Part of the cause: this calculation
 * summed `salesPrice x quantity` (ORDERED) while the invoice, the profit column and
 * the payment cap all use the delivered quantity — so the exposure held and the
 * amount owed were computed from different numbers and could never agree, and a
 * part-delivered order held more credit than the customer owed. Verified live on an
 * order with 151,844.30 ordered against 151,836.09 delivered.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';
import { creditLineCounterparties, creditLines, orderItems, orders } from '../src/db/schema';

describe('credit used amount basis', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('counts the delivered quantity, not the ordered one', async () => {
    const seeded = await seedAuthBasics();
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const db = await getDb();

    const [line] = await db.insert(creditLines).values({
      tenantId: seeded.tenant.id, type: 'CUSTOMER', creditAmount: '100000.00', currency: 'USD',
    }).returning();
    await db.insert(creditLineCounterparties).values({
      creditLineId: line!.id, counterpartyId: seeded.client.id,
    });

    const created = await requestJson('/orders', {
      method: 'POST', token,
      body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id },
    });
    const orderId = created.data?.data?.id as string;

    // 100 MT ordered at 100 = 10,000 ordered; 60 MT delivered = 6,000.
    await requestJson(`/orders/${orderId}/items`, {
      method: 'PUT', token,
      body: {
        items: [{
          productType: 'VLSFO', quantity: '100', unit: 'MT',
          costPrice: '90', costCurrency: 'USD', salesPrice: '100', salesCurrency: 'USD',
        }],
      },
    });
    await requestJson(`/orders/${orderId}/status`, { method: 'PUT', token, body: { status: 'CONFIRMED' } });
    await db.update(orderItems).set({ deliveredQuantity: '60' }).where(eq(orderItems.orderId, orderId));
    await db.update(orders).set({ customerPaymentTermType: 'CREDIT' }).where(eq(orders.id, orderId));

    const res = await requestJson(`/credit/lines?counterpartyId=${seeded.client.id}&type=CUSTOMER`, { token });
    // 60 delivered x 100 = 6,000 used. The ordered basis would have said 10,000.
    const row = (res.data?.data?.items ?? [])[0];
    expect(row?.usedAmount).toBe('6000.00');
    expect(row?.availableAmount).toBe('94000.00');
  });

  it('releases credit when a payment is recorded, up to the delivered basis', async () => {
    const seeded = await seedAuthBasics();
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const db = await getDb();

    const [line] = await db.insert(creditLines).values({
      tenantId: seeded.tenant.id, type: 'CUSTOMER', creditAmount: '100000.00', currency: 'USD',
    }).returning();
    await db.insert(creditLineCounterparties).values({
      creditLineId: line!.id, counterpartyId: seeded.client.id,
    });

    const created = await requestJson('/orders', {
      method: 'POST', token,
      body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id },
    });
    const orderId = created.data?.data?.id as string;
    await requestJson(`/orders/${orderId}/items`, {
      method: 'PUT', token,
      body: {
        items: [{
          productType: 'VLSFO', quantity: '100', unit: 'MT',
          costPrice: '90', costCurrency: 'USD', salesPrice: '100', salesCurrency: 'USD',
        }],
      },
    });
    await requestJson(`/orders/${orderId}/status`, { method: 'PUT', token, body: { status: 'CONFIRMED' } });
    await db.update(orderItems).set({ deliveredQuantity: '60' }).where(eq(orderItems.orderId, orderId));
    await db.update(orders).set({ customerPaymentTermType: 'CREDIT' }).where(eq(orders.id, orderId));

    // Pay the full delivered amount — the cap allows exactly this.
    const pay = await requestJson(`/orders/${orderId}/payments`, {
      method: 'POST', token, body: { amount: '6000', currency: 'USD' },
    });
    expect(pay.status).toBe(200);

    // Credit is fully released only when the order leaves the active set or the
    // payment covers it; here the payment covers the delivered basis exactly.
    const res = await requestJson(`/credit/lines?counterpartyId=${seeded.client.id}&type=CUSTOMER`, { token });
    const row = (res.data?.data?.items ?? [])[0];
    expect(row?.usedAmount).toBe('0.00');
  });
});
