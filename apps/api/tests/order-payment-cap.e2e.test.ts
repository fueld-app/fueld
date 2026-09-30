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

  it('refuses a payment in a currency other than the order\'s', async () => {
    const seeded = await seedAuthBasics();
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const orderId = await orderWithLine(token, seeded);

    /**
     * The payable is in the order's currency and there is no FX rate here, so a
     * foreign payment cannot be compared against it. It used to be subtracted as
     * though the amounts were the same denomination, and the refusal message stated
     * the wrong currency.
     */
    const eur = await requestJson(`/orders/${orderId}/payments`, {
      method: 'POST', token, body: { amount: '3000', currency: 'EUR' },
    });
    expect(eur.status).toBe(400);
    expect(String(eur.data?.message)).toContain('USD');

    const db = await getDb();
    const rows = await db.select().from(customerPayments).where(eq(customerPayments.orderId, orderId));
    expect(rows.length).toBe(0);
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
    // Kept as the SUM-LEVEL check: written directly to the table (bypassing the
    // route guard) a foreign-currency row must still not reduce the USD balance.
    const db = await getDb();
    await db.insert(customerPayments).values({
      tenantId: seeded.tenant.id, customerId: seeded.client.id, orderId,
      amount: '3000.00', currency: 'EUR', receivedAt: new Date(),
    });

    const view = await requestJson(`/orders/${orderId}`, { token });
    expect(view.data?.data?.amountDue).toBe('10000.00');

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
