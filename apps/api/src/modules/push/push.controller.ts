import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import type { ApiResponse } from '@fueld/types';
import { db } from '../../db';
import { users } from '../../db/schema';
import { eq } from 'drizzle-orm';
import {
  getVapidPublicKey,
  removeSubscription,
  sendTestNotification,
  upsertSubscription,
} from './push.service';

export const pushController = new Elysia({ prefix: '/push' })
  .get(
    '/public-key',
    () => {
      const publicKey = getVapidPublicKey();
      if (!publicKey) {
        return { success: false, data: null, message: 'VAPID public key not configured' };
      }
      return { success: true, data: { publicKey } } satisfies ApiResponse<{ publicKey: string }>;
    },
    {
      detail: { tags: ['Push'], summary: 'Get VAPID public key' },
    },
  )
  .use(authGuard)
  .post(
    '/subscribe',
    async ({ body, auth }) => {
      const user = await db.query.users.findFirst({
        where: eq(users.id, auth.sub),
        columns: { tenantId: true },
      });

      if (!user?.tenantId) {
        return { success: false, data: null, message: 'User tenant not found' };
      }

      await upsertSubscription(user.tenantId, auth.sub, body);
      return { success: true, data: null } satisfies ApiResponse<null>;
    },
    {
      body: t.Object({
        endpoint: t.String(),
        expirationTime: t.Optional(t.Nullable(t.Number())),
        keys: t.Object({
          p256dh: t.String(),
          auth: t.String(),
        }),
      }),
      detail: { tags: ['Push'], summary: 'Save or update a push subscription' },
    },
  )
  .post(
    '/unsubscribe',
    async ({ body, auth }) => {
      await removeSubscription(auth.sub, body.endpoint);
      return { success: true, data: null } satisfies ApiResponse<null>;
    },
    {
      body: t.Object({
        endpoint: t.String(),
      }),
      detail: { tags: ['Push'], summary: 'Remove a push subscription' },
    },
  )
  .post(
    '/test',
    async ({ auth }) => {
      const sent = await sendTestNotification(auth.sub);
      return { success: true, data: { sent } } satisfies ApiResponse<{ sent: number }>;
    },
    {
      detail: { tags: ['Push'], summary: 'Send a test push notification to current user' },
    },
  );
