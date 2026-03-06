import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';
import { incomingRfqs } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

type RfqServiceModule = typeof import('../src/modules/rfq/rfq.service');
let rfqService: RfqServiceModule;

async function loadOrdersService() {
  return import('../src/modules/orders/orders.service');
}

const socketMessages: Array<{ userId: string; payload: Record<string, unknown> }> = [];

beforeAll(async () => {
  const originalModule = await import('../src/modules/activity/session-tracker');
  mock.module('../src/modules/activity/session-tracker', () => ({
    ...originalModule,
    sendToUserSockets: (userId: string, payload: Record<string, unknown>) => {
      socketMessages.push({ userId, payload });
    },
  }));

  rfqService = await import('../src/modules/rfq/rfq.service');
  mock.restore();
});

beforeEach(async () => {
  await truncateAll();
  socketMessages.length = 0;
});

describe('rfq.service', () => {
  it('saves an incoming RFQ, persists parsed fields, and notifies the user socket', async () => {
    const { tenant, user } = await seedBasics();
    const db = await getDb();

    const parsed = {
      vesselName: 'MT Test Vessel',
      imo: '9999999',
      port: 'Singapore',
      products: [
        { name: 'VLSFO', quantity: 500, unit: 'MT' },
        { name: 'LSMGO', quantity: 100, unit: 'MT' },
      ],
      eta: '2026-03-10T00:00:00.000Z',
      rawText: 'Please quote MT Test Vessel IMO 9999999 Singapore 500 MT VLSFO + 100 MT LSMGO',
      senderPhone: '+4512345678',
      senderName: 'Broker Bob',
      confidence: 0.91,
    };

    const id = await rfqService.saveIncomingRfq(user.id, tenant.id, parsed, 'manual');
    expect(id).toBeTruthy();

    const stored = await db.query.incomingRfqs.findFirst({
      where: eq(incomingRfqs.id, id),
    });
    expect(stored?.tenantId).toBe(tenant.id);
    expect(stored?.userId).toBe(user.id);
    expect(stored?.source).toBe('manual');
    expect(stored?.status).toBe('PENDING');
    expect(stored?.vesselName).toBe(parsed.vesselName);
    expect(stored?.imo).toBe(parsed.imo);
    expect(stored?.port).toBe(parsed.port);
    expect(stored?.senderPhone).toBe(parsed.senderPhone);
    expect(stored?.senderName).toBe(parsed.senderName);
    expect(Array.isArray(stored?.products)).toBe(true);
    expect(stored?.products?.length).toBe(2);

    expect(socketMessages.length).toBe(1);
    expect(socketMessages[0]?.userId).toBe(user.id);
    expect(socketMessages[0]?.payload.type).toBe('rfq:new');
    expect((socketMessages[0]?.payload.data as any)?.id).toBe(id);
    expect((socketMessages[0]?.payload.data as any)?.vesselName).toBe(parsed.vesselName);
  });

  it('lists pending RFQs only and orders them newest first', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createOrder } = await loadOrdersService();

    const firstId = await rfqService.saveIncomingRfq(user.id, tenant.id, {
      vesselName: 'Older Vessel',
      imo: null,
      port: 'Aarhus',
      products: [{ name: 'VLSFO', quantity: 100, unit: 'MT' }],
      eta: null,
      rawText: 'older rfq text message',
      senderPhone: '+4500000001',
      senderName: 'Old Sender',
      confidence: 0.7,
    });

    await db.update(incomingRfqs)
      .set({ createdAt: new Date('2026-03-01T00:00:00.000Z') })
      .where(eq(incomingRfqs.id, firstId));

    const secondId = await rfqService.saveIncomingRfq(user.id, tenant.id, {
      vesselName: 'Newer Vessel',
      imo: null,
      port: 'Rotterdam',
      products: [{ name: 'LSMGO', quantity: 200, unit: 'MT' }],
      eta: null,
      rawText: 'newer rfq text message',
      senderPhone: '+4500000002',
      senderName: 'New Sender',
      confidence: 0.8,
    });

    const acceptedOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    await db.update(incomingRfqs)
      .set({ status: 'ACCEPTED', orderId: acceptedOrder.id, updatedAt: new Date() })
      .where(eq(incomingRfqs.id, secondId));

    const pending = await rfqService.listPendingRfqs(user.id);
    expect(pending.length).toBe(1);
    expect(pending[0]?.id).toBe(firstId);

    const all = await rfqService.listAllRfqs(user.id);
    expect(all.length).toBe(2);
    expect(all[0]?.id).toBe(secondId);
    expect(all[1]?.id).toBe(firstId);
  });

  it('dismisses and accepts only RFQs owned by the current user', async () => {
    const seeded = await seedBasics();
    const db = await getDb();
    const { createOrder } = await loadOrdersService();
    const [otherUser] = await db.insert((await import('../src/db/schema')).users).values({
      tenantId: seeded.tenant.id,
      email: 'other-rfq@test.local',
      name: 'Other User',
      role: 'TRADER',
    }).returning();

    const acceptedOrder = await createOrder({
      tenantId: seeded.tenant.id,
      clientId: seeded.client.id,
      vesselId: seeded.vessel.id,
      placeId: seeded.place.id,
      salesRepId: seeded.user.id,
    });

    const dismissId = await rfqService.saveIncomingRfq(seeded.user.id, seeded.tenant.id, {
      vesselName: 'Dismiss Me',
      imo: null,
      port: null,
      products: [],
      eta: null,
      rawText: 'dismiss me rfq text',
      senderPhone: '+4500000010',
      senderName: null,
      confidence: 0.5,
    });

    const acceptId = await rfqService.saveIncomingRfq(seeded.user.id, seeded.tenant.id, {
      vesselName: 'Accept Me',
      imo: null,
      port: null,
      products: [],
      eta: null,
      rawText: 'accept me rfq text',
      senderPhone: '+4500000011',
      senderName: null,
      confidence: 0.6,
    });

    const dismissed = await rfqService.dismissRfq(dismissId, seeded.user.id);
    expect(dismissed).toBe(true);
    const afterDismiss = await db.query.incomingRfqs.findFirst({ where: eq(incomingRfqs.id, dismissId) });
    expect(afterDismiss).toBeUndefined();

    const accepted = await rfqService.acceptRfq(acceptId, seeded.user.id, acceptedOrder.id);
    expect(accepted).toBe(true);
    const afterAccept = await db.query.incomingRfqs.findFirst({ where: eq(incomingRfqs.id, acceptId) });
    expect(afterAccept?.status).toBe('ACCEPTED');
    expect(afterAccept?.orderId).toBe(acceptedOrder.id);

    const otherUserDismiss = await rfqService.dismissRfq(acceptId, otherUser.id);
    const otherUserAccept = await rfqService.acceptRfq(acceptId, otherUser.id, '00000000-0000-0000-0000-000000000001');
    expect(otherUserDismiss).toBe(false);
    expect(otherUserAccept).toBe(false);
  });

  it('returns the tenant id for an existing user and null for unknown users', async () => {
    const { tenant, user } = await seedBasics();

    await expect(rfqService.getUserTenantId(user.id)).resolves.toBe(tenant.id);
    await expect(rfqService.getUserTenantId('00000000-0000-0000-0000-000000000000')).resolves.toBeNull();
  });
});