import { Elysia, t } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors';
import type { ApiResponse } from '@fueld/types';
import { authController } from './modules/auth';
import { documentsController } from './modules/documents/documents.controller';
import { dashboardController } from './modules/dashboard/dashboard.controller';
import { lloydsController } from './modules/lloyds';
import { companiesController } from './modules/companies/companies.controller';
import { vesselsController } from './modules/vessels/vessels.controller';
import { creditController } from './modules/credit/credit.controller';
import { adminController, inviteController } from './modules/admin/admin.controller';
import { settingsController } from './modules/admin/settings.controller';
import { securityController } from './modules/admin/security.controller';
import { activityController, adminActivityController } from './modules/activity/activity.controller';
import { ordersController } from './modules/orders/orders.controller';
import { commentsController } from './modules/comments/comments.controller';
import { logFromRequest, startPruneJob } from './modules/activity/activity.service';
import {
  addSession,
  removeSession,
  updatePresence,
  subscribeAdmin,
  unsubscribeAdmin,
  getAllSessionDtos,
  logCopyEvent,
  logPrintEvent,
  logScreenshotEvent,
  onEntityView,
  sendToSocket,
  extractClientIp,
} from './modules/activity/session-tracker';
import { getNearbyVessels, getNearbyVesselPositions, syncPlaceFromSeasearcher } from './modules/lloyds/lli.service';
import { syncVesselFromSeasearcher } from './modules/vessels/vessel.service';
import { syncCompanyFromSeasearcher } from './modules/companies/company.service';
import { startPricePolling, getLatestPricePayload } from './modules/prices/price.service';
import { jwtAccessPlugin } from './modules/auth/jwt.setup';
import { db } from './db';
import { users } from './db/schema';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { pushController } from './modules/push/push.controller';

// ─── Run pending database migrations on startup ─────────────────────
const MIGRATIONS_DIR = process.env['MIGRATIONS_DIR'] || './drizzle';
try {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  console.log('✅ Database migrations applied');
} catch (e: any) {
  const msg = e?.message ?? String(e);
  // These are all benign — schema already exists from db:push or prior run
  if (
    msg.includes('already been applied') ||
    msg.includes('already exists') ||
    msg.includes('relation "__drizzle_migrations"') ||
    msg.includes('Failed query: CREATE TYPE') ||
    msg.includes('Failed query: CREATE TABLE')
  ) {
    console.log('ℹ️  Migrations already up to date');
  } else {
    console.error('⚠️  Migration warning:', msg);
  }
}

const PORT = Number(process.env['PORT']) || 3000;

const app = new Elysia()
  .use(
    swagger({
      documentation: {
        info: {
          title: 'Fueld API',
          version: '0.0.1',
          description: 'Bunker Trading SaaS — REST API',
        },
        tags: [
          { name: 'Health', description: 'Health-check endpoints' },
          { name: 'Auth', description: 'Authentication & 2FA' },
          { name: 'Orders', description: 'Bunker order management' },
          { name: 'Documents', description: 'Invoice PDF generation & email' },
          { name: 'Dashboard', description: 'Collections, pipeline & team stats' },
          { name: 'Lloyd\'s', description: 'Lloyd\'s List Intelligence vessel, port & company lookup' },
          { name: 'Push', description: 'Push notification subscriptions' },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
        },
      },
    }),
  )
  .use(
    cors({
      origin: process.env['CORS_ORIGIN'] || /localhost/,
    }),
  )
  .get(
    '/health',
    (): ApiResponse<{ status: string; uptime: number }> => ({
      success: true,
      data: {
        status: 'ok',
        uptime: process.uptime(),
      },
    }),
    {
      detail: { tags: ['Health'], summary: 'Health check' },
    },
  )

  // ─── Global activity logging middleware ─────────────────────────────
  .onAfterResponse({ as: 'global' }, ({ request, set, body }) => {
    const status = typeof set.status === 'number' ? set.status : 200;
    logFromRequest(request, status, body);
  })

  .use(authController)
  .use(documentsController)
  .use(dashboardController)
  .use(lloydsController)
  .use(companiesController)
  .use(vesselsController)
  .use(creditController)
  .use(adminController)
  .use(settingsController)
  .use(inviteController)
  .use(activityController)
  .use(adminActivityController)
  .use(ordersController)
  .use(commentsController)
  .use(securityController)
  .use(pushController)

  // ─── Static file serving for uploads ───────────────────────────────
  .get('/uploads/avatars/:filename', async ({ params, set }) => {
    const { join } = await import('path');
    const path = join(import.meta.dir, '../uploads/avatars', params.filename);
    const file = Bun.file(path);
    if (!(await file.exists())) {
      set.status = 404;
      return 'Not found';
    }
    set.headers['content-type'] = file.type;
    set.headers['cache-control'] = 'public, max-age=3600';
    return file;
  })
  .get('/uploads/logos/:filename', async ({ params, set }) => {
    const { join } = await import('path');
    const path = join(import.meta.dir, '../uploads/logos', params.filename);
    const file = Bun.file(path);
    if (!(await file.exists())) {
      set.status = 404;
      return 'Not found';
    }
    set.headers['content-type'] = file.type;
    set.headers['cache-control'] = 'public, max-age=3600';
    return file;
  })

  // ─── Authenticated WebSocket — persistent session ──────────────────
  // Client connects with ?token=<JWT> query parameter.
  // The JWT is verified on upgrade; connection is rejected if invalid.
  // All app-level push messages flow through this single socket.
  .use(jwtAccessPlugin)
  .ws('/ws', {
    query: t.Object({
      token: t.String(),
    }),

    async open(ws) {
      const token = ws.data.query.token;

      try {
        const raw = await ws.data.jwtAccess.verify(token);
        if (!raw || !raw['sub'] || raw['pending2fa']) {
          console.log('[WS] Connection rejected: invalid token');
          ws.send(JSON.stringify({ type: 'auth-error', message: 'Invalid or expired token' }));
          ws.close();
          return;
        }

        // Generate a unique socket ID
        const socketId = crypto.randomUUID();

        // Store auth info on the websocket data for use in message handler
        (ws.data as any).auth = {
          sub: raw['sub'] as string,
          email: raw['email'] as string,
          role: raw['role'] as string,
        };
        (ws.data as any).socketId = socketId;

        // Track this session — look up user name from DB if not in JWT
        let userName = (raw['name'] as string) ?? null;
        if (!userName) {
          const dbUser = await db.query.users.findFirst({
            where: eq(users.id, raw['sub'] as string),
            columns: { name: true },
          });
          userName = dbUser?.name ?? (raw['email'] as string);
        }
        const request = (ws as any).data?.request as Request | undefined;
        const ip =
          (request ? extractClientIp(request) : null)
          ?? (ws as any).raw?.remoteAddress
          ?? (ws as any).remoteAddress
          ?? null;
        addSession(socketId, ws, {
          userId: raw['sub'] as string,
          email: raw['email'] as string,
          name: userName,
          role: raw['role'] as string,
          ip,
          userAgent: null, // Will be set with first presence message
        });

        console.log(`[WS] Authenticated connection from ${raw['email']} (${socketId})`);
        ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket authenticated' }));

        // Send cached commodity prices after a short delay to allow
        // the frontend components to set up their subscriptions first
        setTimeout(() => {
          try {
            const payload = getLatestPricePayload();
            if (payload.prices.length > 0 || payload.fxRates) {
              ws.send(JSON.stringify({ type: 'prices', data: payload }));
            }
          } catch { /* ws may have closed */ }
        }, 500);
      } catch (err) {
        console.log('[WS] Connection rejected: token verification failed');
        ws.send(JSON.stringify({ type: 'auth-error', message: 'Token verification failed' }));
        ws.close();
      }
    },

    async message(ws, message) {
      // Ensure authenticated
      const auth = (ws.data as any).auth;
      if (!auth) {
        ws.send(JSON.stringify({ type: 'auth-error', message: 'Not authenticated' }));
        return;
      }

      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;

        switch (data.type) {
          case 'presence': {
            // Client sends current URL, timezone, platform, pageTitle, language
            const socketId = (ws.data as any).socketId;
            if (socketId) {
              updatePresence(socketId, {
                currentUrl: data.url ?? null,
                timezone: data.timezone ?? null,
                platform: data.platform ?? null,
                pageTitle: data.pageTitle ?? null,
                language: data.language ?? null,
              });
            }
            break;
          }

          case 'admin:subscribe-sessions': {
            const socketId = (ws.data as any).socketId;
            if (auth.role === 'ADMIN' && socketId) {
              subscribeAdmin(socketId);
            }
            break;
          }

          case 'admin:unsubscribe-sessions': {
            const socketId = (ws.data as any).socketId;
            if (socketId) {
              unsubscribeAdmin(socketId);
            }
            break;
          }

          case 'copy-event': {
            const socketId = (ws.data as any).socketId;
            if (socketId) {
              logCopyEvent(socketId, {
                text: String(data.text ?? '').slice(0, 500),
                sourceUrl: data.sourceUrl ?? null,
                pageTitle: data.pageTitle ?? null,
              });
            }
            break;
          }

          case 'print-event': {
            const socketId = (ws.data as any).socketId;
            if (socketId) {
              logPrintEvent(socketId, {
                sourceUrl: data.sourceUrl ?? null,
                pageTitle: data.pageTitle ?? null,
              });
            }
            break;
          }

          case 'screenshot-event': {
            const socketId = (ws.data as any).socketId;
            if (socketId) {
              logScreenshotEvent(socketId, {
                sourceUrl: data.sourceUrl ?? null,
                pageTitle: data.pageTitle ?? null,
              });
            }
            break;
          }

          case 'nearby-vessels': {
            if (!data.placeId) break;
            console.log(`[WS] Fetching nearby vessels for place ${data.placeId}…`);
            try {
              const vessels = await getNearbyVessels(String(data.placeId));
              ws.send(JSON.stringify({ type: 'nearby-vessels', data: vessels }));
              console.log(`[WS] Sent ${vessels.length} nearby vessels`);
            } catch (err: any) {
              console.warn(`[WS] Nearby vessels failed for ${data.placeId}:`, err.message);
              ws.send(JSON.stringify({ type: 'nearby-vessels', data: [] }));
            }
            break;
          }

          case 'vessel-positions': {
            if (!data.placeId) break;
            try {
              const positions = await getNearbyVesselPositions(String(data.placeId));
              ws.send(JSON.stringify({ type: 'vessel-positions', data: positions }));
            } catch (err: any) {
              console.warn(`[WS] Vessel positions failed for ${data.placeId}:`, err.message);
            }
            break;
          }

          case 'sync-place': {
            if (!data.placeId) break;
            console.log(`[WS] Syncing place ${data.placeId} from Seasearcher…`);
            const updated = await syncPlaceFromSeasearcher(String(data.placeId));
            if (updated) {
              ws.send(JSON.stringify({ type: 'place-synced', data: updated }));
              console.log(`[WS] Place ${data.placeId} synced successfully`);
            } else {
              ws.send(JSON.stringify({ type: 'sync-error', message: 'Place not found or no Seasearcher ID' }));
            }
            break;
          }

          case 'get-prices': {
            const payload = getLatestPricePayload();
            if (payload.prices.length > 0 || payload.fxRates) {
              ws.send(JSON.stringify({ type: 'prices', data: payload }));
            }
            break;
          }

          case 'ping': {
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
          }

          default:
            ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${data.type}` }));
        }
      } catch (err) {
        console.error('[WS] Error:', err);
        ws.send(JSON.stringify({ type: 'error', message: 'Failed to process request' }));
      }
    },

    close(ws) {
      const auth = (ws.data as any).auth;
      const socketId = (ws.data as any).socketId;
      if (socketId) {
        removeSession(socketId);
      }
      console.log(`[WS] Client disconnected${auth ? ` (${auth.email})` : ''}`);
    },
  })

  .listen(PORT);

console.log(
  `🛢️  Fueld API is running at http://${app.server?.hostname}:${app.server?.port}`,
);
console.log(
  `📖 Swagger docs at http://${app.server?.hostname}:${app.server?.port}/swagger`,
);

// Start background activity log pruning
startPruneJob();

// Start commodity price polling (Yahoo Finance)
startPricePolling();

// ─── Auto-sync when users view entity detail pages ───────────────────
// When a user navigates to a vessel/company detail page, the backend
// automatically syncs from Seasearcher and pushes the fresh data back
// over WebSocket — no separate HTTP sync call needed from the frontend.
onEntityView(async (socketId, entityType, entityId) => {
  try {
    if (entityType === 'Vessel') {
      const synced = await syncVesselFromSeasearcher(entityId);
      if (synced) {
        sendToSocket(socketId, { type: 'vessel-synced', data: synced });
      }
    } else if (entityType === 'Company') {
      const synced = await syncCompanyFromSeasearcher(entityId);
      if (synced) {
        sendToSocket(socketId, { type: 'company-synced', data: synced });
      }
    }
  } catch (err: any) {
    console.warn(`[Auto-sync] ${entityType} ${entityId} failed:`, err.message);
  }
});

export type App = typeof app;
