import { Elysia, t } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors';
import type { ApiResponse } from '@fueld/types';
import { authController } from './modules/auth';
import { documentsController } from './modules/documents/documents.controller';
import { dashboardController } from './modules/dashboard/dashboard.controller';
import { lloydsController } from './modules/lloyds';
import { getNearbyVessels, syncPlaceFromSeasearcher } from './modules/lloyds/lli.service';
import { jwtAccessPlugin } from './modules/auth/jwt.setup';

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
  .use(authController)
  .use(documentsController)
  .use(dashboardController)
  .use(lloydsController)

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

        // Store auth info on the websocket data for use in message handler
        (ws.data as any).auth = {
          sub: raw['sub'] as string,
          email: raw['email'] as string,
          role: raw['role'] as string,
        };

        console.log(`[WS] Authenticated connection from ${raw['email']}`);
        ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket authenticated' }));
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
          case 'nearby-vessels': {
            if (!data.placeId) break;
            console.log(`[WS] Fetching nearby vessels for place ${data.placeId}…`);
            const vessels = await getNearbyVessels(String(data.placeId));
            ws.send(JSON.stringify({ type: 'nearby-vessels', data: vessels }));
            console.log(`[WS] Sent ${vessels.length} nearby vessels`);
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

export type App = typeof app;
