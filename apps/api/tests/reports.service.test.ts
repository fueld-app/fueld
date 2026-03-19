import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { activityLogs, teams, tenants, users, orders } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';
import { Role } from '@fueld/types';

type ReportsModule = typeof import('../src/modules/reports/reports.service');

let reportsModule: ReportsModule;
let sentMails: Array<Record<string, unknown>> = [];

async function loadOrdersService() {
  return import('../src/modules/orders/orders.service');
}

beforeAll(async () => {
  mock.module('nodemailer', () => ({
    default: {
      createTransport: () => ({
        sendMail: async (payload: Record<string, unknown>) => {
          sentMails.push(payload);
        },
      }),
    },
  }));

  reportsModule = await import('../src/modules/reports/reports.service');
});

afterAll(() => {
  mock.restore();
});

beforeEach(async () => {
  await truncateAll();
  sentMails = [];
  process.env.SMTP_HOST = 'smtp.test.local';
  process.env.SMTP_PORT = '2525';
  process.env.SMTP_USER = 'smtp-user';
  process.env.SMTP_PASS = 'smtp-pass';
  process.env.SMTP_FROM = 'reports@fueld.test';
  process.env.SMTP_SECURE = 'false';
});

describe('reports.service', () => {
  test('limits team lead reports to their team scope', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createOrder, saveOrderItems } = await loadOrdersService();

    const [teamA] = await db.insert(teams).values({ tenantId: tenant.id, name: 'Alpha' }).returning();
    const [teamB] = await db.insert(teams).values({ tenantId: tenant.id, name: 'Beta' }).returning();

    await db.update(users).set({ role: Role.Teamlead, teamId: teamA.id, updatedAt: new Date() }).where(eq(users.id, user.id));

    const [teammate] = await db.insert(users).values({
      tenantId: tenant.id,
      email: 'teammate@fueld.test',
      name: 'Teammate',
      role: Role.Trader,
      teamId: teamA.id,
    }).returning();

    const [outsider] = await db.insert(users).values({
      tenantId: tenant.id,
      email: 'outsider@fueld.test',
      name: 'Outsider',
      role: Role.Trader,
      teamId: teamB.id,
    }).returning();

    const ownOrder = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id });
    const teamOrder = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: teammate.id });
    const outsideOrder = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: outsider.id });

    await saveOrderItems(ownOrder.id, [{ productType: 'VLSFO', quantity: '10', unit: 'MT', salesPrice: '100', costPrice: '80' }]);
    await saveOrderItems(teamOrder.id, [{ productType: 'LSMGO', quantity: '8', unit: 'MT', salesPrice: '120', costPrice: '90' }]);
    await saveOrderItems(outsideOrder.id, [{ productType: 'MGO', quantity: '6', unit: 'MT', salesPrice: '130', costPrice: '100' }]);

    await db.update(orders).set({ status: 'CONFIRMED', updatedAt: new Date() }).where(eq(orders.id, ownOrder.id));
    await db.update(orders).set({ status: 'CONFIRMED', updatedAt: new Date() }).where(eq(orders.id, teamOrder.id));
    await db.update(orders).set({ status: 'CONFIRMED', updatedAt: new Date() }).where(eq(orders.id, outsideOrder.id));

    const report = await reportsModule.getReleaseTwoReports(tenant.id, user.id, {});

    expect(report.access.scope).toBe('TEAM');
    expect(report.traderPerformance.rows.map((row) => row.traderId).sort()).toEqual([user.id, teammate.id].sort());
    expect(report.traderPerformance.rows.find((row) => row.traderId === outsider.id)).toBeUndefined();
  });

  test('updates saved views in tenant settings', async () => {
    const { tenant, user } = await seedBasics();
    const db = await getDb();

    await db.update(users).set({ role: Role.Admin, updatedAt: new Date() }).where(eq(users.id, user.id));

    const created = await reportsModule.createSavedReportView(tenant.id, user.id, 'Admin User', {
      name: 'Finance view',
      description: 'Original',
      filters: { traderId: user.id },
    });

    const updated = await reportsModule.updateSavedReportView(tenant.id, user.id, created[0]!.id, {
      name: 'Updated finance view',
      description: 'Adjusted',
      filters: { productType: 'VLSFO' },
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]?.name).toBe('Updated finance view');
    expect(updated[0]?.description).toBe('Adjusted');
    expect(updated[0]?.filters.productType).toBe('VLSFO');

    const tenantRow = await db.query.tenants.findFirst({ where: eq(tenants.id, tenant.id), columns: { settings: true } });
    expect(tenantRow?.settings?.reportsSettings?.savedViews?.[0]?.name).toBe('Updated finance view');

    const auditEntries = await db.select().from(activityLogs).where(eq(activityLogs.entityType, 'report_saved_view'));
    expect(auditEntries.map((entry) => entry.action).sort()).toEqual(['CREATE', 'UPDATE']);
  });

  test('sends attachment-only scheduled reports with CSV and XLSX attachments once per day', async () => {
    const { tenant, user, client, vessel, place } = await seedBasics();
    const db = await getDb();
    const { createOrder, saveOrderItems } = await loadOrdersService();

    await db.update(users).set({ role: Role.Admin, updatedAt: new Date() }).where(eq(users.id, user.id));

    const order = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id });
    await saveOrderItems(order.id, [{ productType: 'VLSFO', quantity: '10', unit: 'MT', salesPrice: '100', costPrice: '80' }]);
    await db.update(orders).set({ status: 'CONFIRMED', updatedAt: new Date() }).where(eq(orders.id, order.id));

    const schedules = await reportsModule.createReportSchedule(tenant.id, user.id, {
      name: 'Daily summary',
      reportType: 'SUMMARY',
      deliveryMode: 'CSV_XLSX',
      bodyMode: 'ATTACHMENT_ONLY',
      hourUtc: 10,
      recipientRoles: [Role.Admin],
      extraEmails: ['ops@fueld.test'],
      filters: {},
    });

    expect(schedules[0]?.deliveryMode).toBe('CSV_XLSX');
    expect(schedules[0]?.bodyMode).toBe('ATTACHMENT_ONLY');

    await reportsModule.runDueReportSchedules(new Date('2026-03-19T10:00:00.000Z'));
    expect(sentMails).toHaveLength(1);

    const attachments = (sentMails[0]?.attachments as Array<{ filename: string }> | undefined) ?? [];
    expect(attachments).toHaveLength(2);
    expect(attachments.some((attachment) => attachment.filename.endsWith('.csv'))).toBe(true);
    expect(attachments.some((attachment) => attachment.filename.endsWith('.xlsx'))).toBe(true);
    expect(sentMails[0]?.text).toBe('Your scheduled Fueld report is attached.');

    await reportsModule.runDueReportSchedules(new Date('2026-03-19T10:30:00.000Z'));
    expect(sentMails).toHaveLength(1);
  });

  test('logs audit rows for schedule lifecycle changes', async () => {
    const { tenant, user } = await seedBasics();
    const db = await getDb();

    await db.update(users).set({ role: Role.Admin, updatedAt: new Date() }).where(eq(users.id, user.id));

    const created = await reportsModule.createReportSchedule(tenant.id, user.id, {
      name: 'Ops summary',
      reportType: 'SUMMARY',
      deliveryMode: 'HTML',
      bodyMode: 'HTML_SUMMARY',
      hourUtc: 9,
      recipientRoles: [Role.Admin],
      filters: {},
    });

    await reportsModule.updateReportSchedule(tenant.id, user.id, created[0]!.id, {
      name: 'Ops summary updated',
      reportType: 'MARGIN_ANALYSIS',
      deliveryMode: 'XLSX',
      bodyMode: 'ATTACHMENT_ONLY',
      hourUtc: 11,
      recipientRoles: [Role.Admin, Role.Finance],
      extraEmails: ['ops@fueld.test'],
      filters: {},
      isActive: false,
    });

    await reportsModule.deleteReportSchedule(tenant.id, user.id, created[0]!.id);

    const auditEntries = await db.select().from(activityLogs).where(eq(activityLogs.entityType, 'report_schedule'));
    expect(auditEntries.map((entry) => entry.action).sort()).toEqual(['CREATE', 'DELETE', 'UPDATE']);
  });
});