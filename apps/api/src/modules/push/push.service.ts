import webpush from 'web-push';
import { db } from '../../db';
import { integrationCredentials, pushSubscriptions } from '../../db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { decrypt } from '../../lib/crypto';

interface SubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  expirationTime?: number | null;
  keys: SubscriptionKeys;
}

interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

async function getTenantId(): Promise<string> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');
  return tenant.id;
}

async function loadVapidConfig(tenantId: string): Promise<VapidConfig | null> {
  const rows = await db
    .select({
      key: integrationCredentials.key,
      encryptedValue: integrationCredentials.encryptedValue,
      iv: integrationCredentials.iv,
      authTag: integrationCredentials.authTag,
    })
    .from(integrationCredentials)
    .where(and(
      eq(integrationCredentials.tenantId, tenantId),
      eq(integrationCredentials.provider, 'PUSH'),
    ));

  if (!rows.length) return null;

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.key, decrypt(row.encryptedValue, row.iv, row.authTag));
  }

  const publicKey = map.get('publicKey') ?? '';
  const privateKey = map.get('privateKey') ?? '';
  const subject = map.get('subject') ?? 'mailto:support@fueld.app';
  if (!publicKey || !privateKey) return null;

  return { publicKey, privateKey, subject };
}

async function ensureVapidConfigured(tenantId: string): Promise<VapidConfig | null> {
  const config = await loadVapidConfig(tenantId);
  if (!config) return null;
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return config;
}

export async function getVapidPublicKey(): Promise<string | null> {
  const tenantId = await getTenantId();
  const config = await loadVapidConfig(tenantId);
  return config?.publicKey ?? null;
}

export async function upsertSubscription(
  tenantId: string,
  userId: string,
  input: PushSubscriptionInput,
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({
      tenantId,
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      expirationTime: input.expirationTime ? new Date(input.expirationTime) : null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        tenantId,
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        expirationTime: input.expirationTime ? new Date(input.expirationTime) : null,
        updatedAt: new Date(),
      },
    });
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function sendTestNotification(userId: string, tenantId: string): Promise<number> {
  const config = await ensureVapidConfigured(tenantId);
  if (!config) return 0;

  const subs = await db.query.pushSubscriptions.findMany({
    where: eq(pushSubscriptions.userId, userId),
  });

  let sent = 0;
  for (const sub of subs) {
    const payload = JSON.stringify({
      title: 'Fueld',
      body: 'Push notifications are enabled.',
    });

    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        payload,
      );
      sent++;
    } catch (err: any) {
      const status = err?.statusCode ?? err?.status;
      if (status === 404 || status === 410) {
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, sub.endpoint));
      }
    }
  }

  return sent;
}

/**
 * Send a push notification to all subscriptions for a list of user IDs.
 * Used for role-based or targeted notifications (e.g., credit applications).
 */
export async function sendNotificationToUsers(
  userIds: string[],
  notification: { title: string; body: string; url?: string },
): Promise<number> {
  if (!userIds.length) return 0;
  const tenantId = await getTenantId();
  const config = await ensureVapidConfigured(tenantId);
  if (!config) return 0;

  const subs = await db.query.pushSubscriptions.findMany({
    where: inArray(pushSubscriptions.userId, userIds),
  });

  let sent = 0;
  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    data: { url: notification.url },
  });

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
      );
      sent++;
    } catch (err: any) {
      const status = err?.statusCode ?? err?.status;
      if (status === 404 || status === 410) {
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, sub.endpoint));
      }
    }
  }

  return sent;
}
