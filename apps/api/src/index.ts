import { Elysia } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors';
import type { ApiResponse } from '@fueld/types';

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
          { name: 'Orders', description: 'Bunker order management' },
        ],
      },
    }),
  )
  .use(
    cors({
      origin: process.env['CORS_ORIGIN'] || 'http://localhost:4200',
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
  .listen(PORT);

console.log(
  `🛢️  Fueld API is running at http://${app.server?.hostname}:${app.server?.port}`,
);
console.log(
  `📖 Swagger docs at http://${app.server?.hostname}:${app.server?.port}/swagger`,
);

export type App = typeof app;
