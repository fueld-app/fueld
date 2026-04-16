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

interface PushControllerDeps {
  authPlugin?: Elysia<any, any, any, any, any, any, any>;
  getVapidPublicKey?: typeof getVapidPublicKey;
  upsertSubscription?: typeof upsertSubscription;
  removeSubscription?: typeof removeSubscription;
  sendTestNotification?: typeof sendTestNotification;
}

interface PushAuthContext {
  sub: string;
  userId: string;
  tenantId: string;
  email: string;
  role: string;
}

export function createPushController(deps: PushControllerDeps = {}) {
  const {
    authPlugin = authGuard,
    getVapidPublicKey: getVapidPublicKeyFn = getVapidPublicKey,
    upsertSubscription: upsertSubscriptionFn = upsertSubscription,
    removeSubscription: removeSubscriptionFn = removeSubscription,
    sendTestNotification: sendTestNotificationFn = sendTestNotification,
  } = deps;

  return new Elysia({ prefix: '/push' })
    .get(
      '/public-key',
      async () => {
        const publicKey = await getVapidPublicKeyFn();
        if (!publicKey) {
          return { success: false, data: null, message: 'VAPID public key not configured' };
        }
        return { success: true, data: { publicKey } } satisfies ApiResponse<{ publicKey: string }>;
      },
      {
        detail: { tags: ['Push'], summary: 'Get VAPID public key' },
      },
    )
    .use(authPlugin)
    .post(
      '/subscribe',
      async (context) => {
        const { body } = context;
        const auth = (context as typeof context & { auth: PushAuthContext }).auth;

        try {
          const user = await db.query.users.findFirst({
            where: eq(users.id, auth.sub),
            columns: { tenantId: true },
          });

          if (!user?.tenantId) {
            return { success: false, data: null, message: 'User tenant not found' };
          }

          await upsertSubscriptionFn(user.tenantId, auth.sub, body);
          return { success: true, data: null } satisfies ApiResponse<null>;
        } catch (err) {
          console.error('[Push] Subscribe failed:', err);
          return { success: false, data: null, message: 'Failed to save push subscription' } satisfies ApiResponse<null>;
        }
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
      async (context) => {
        const { body } = context;
        const auth = (context as typeof context & { auth: PushAuthContext }).auth;

        try {
          await removeSubscriptionFn(auth.sub, body.endpoint);
          return { success: true, data: null } satisfies ApiResponse<null>;
        } catch (err) {
          console.error('[Push] Unsubscribe failed:', err);
          return { success: false, data: null, message: 'Failed to remove push subscription' } satisfies ApiResponse<null>;
        }
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
      async (context) => {
        const auth = (context as typeof context & { auth: PushAuthContext }).auth;

        try {
          const user = await db.query.users.findFirst({
            where: eq(users.id, auth.sub),
            columns: { tenantId: true },
          });

          if (!user?.tenantId) {
            return { success: false, data: { sent: 0 }, message: 'User tenant not found' };
          }

          const sent = await sendTestNotificationFn(auth.sub, user.tenantId);
          return { success: true, data: { sent } } satisfies ApiResponse<{ sent: number }>;
        } catch (err) {
          console.error('[Push] Test notification failed:', err);
          return { success: false, data: { sent: 0 }, message: 'Failed to send push test notification' } satisfies ApiResponse<{ sent: number }>;
        }
      },
      {
        detail: { tags: ['Push'], summary: 'Send a test push notification to current user' },
      },
    );
}

export const pushController = createPushController();
