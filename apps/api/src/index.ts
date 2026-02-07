import { Elysia, t } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors';
import type { ApiResponse } from '@fueld/types';
import { authController } from './modules/auth';
import { documentsController } from './modules/documents/documents.controller';
import { dashboardController } from './modules/dashboard/dashboard.controller';
import { lloydsController } from './modules/lloyds';
import { getNearbyVessels } from './modules/lloyds/lli.service';

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

  // ─── WebSocket: nearby vessels push ────────────────────────────────
  .ws('/ws/nearby-vessels', {
    body: t.String(),
    open(ws) {
      console.log('[WS] Client connected to nearby-vessels');
    },
    async message(ws, message) {
      try {
        const data = JSON.parse(message);
        if (data.placeId) {
          console.log(`[WS] Fetching nearby vessels for place ${data.placeId}…`);
          const vessels = await getNearbyVessels(String(data.placeId));
          ws.send(JSON.stringify({ type: 'nearby-vessels', data: vessels }));
          console.log(`[WS] Sent ${vessels.length} nearby vessels`);
        }
      } catch (err) {
        console.error('[WS] Error:', err);
        ws.send(JSON.stringify({ type: 'error', message: 'Failed to fetch nearby vessels' }));
      }
    },
    close(ws) {
      console.log('[WS] Client disconnected from nearby-vessels');
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
