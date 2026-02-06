import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import { getCollections, getTeamStats, getPipelineSummary } from './dashboard.service';

// ═══════════════════════════════════════════════════════════════════════
//  Dashboard Controller
// ═══════════════════════════════════════════════════════════════════════

export const dashboardController = new Elysia({ prefix: '/dashboard' })
  // ── Require authentication for all routes ──
  .use(authGuard)

  // ── GET /dashboard/collections ─────────────────────────────────────
  .get(
    '/collections',
    async ({ store }) => {
      const auth = (store as Record<string, unknown>).auth as {
        userId: string;
        tenantId: string;
      };
      const items = await getCollections(auth.tenantId);
      return { items, count: items.length };
    },
    {
      detail: {
        tags: ['Dashboard'],
        summary: 'Get overdue invoices (collections)',
        description:
          'Returns all invoices past their due date that are not fully paid, ordered by most overdue first.',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── GET /dashboard/team-stats ──────────────────────────────────────
  .get(
    '/team-stats',
    async ({ store }) => {
      const auth = (store as Record<string, unknown>).auth as {
        userId: string;
        tenantId: string;
      };
      const stats = await getTeamStats(auth.tenantId, auth.userId);
      return { traders: stats };
    },
    {
      detail: {
        tags: ['Dashboard'],
        summary: 'Get trader profit & volume stats',
        description:
          'Returns profit, volume, and order count per trader. Respects vacation delegation logic.',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── GET /dashboard/pipeline ────────────────────────────────────────
  .get(
    '/pipeline',
    async ({ store }) => {
      const auth = (store as Record<string, unknown>).auth as {
        userId: string;
        tenantId: string;
      };
      const pipeline = await getPipelineSummary(auth.tenantId);
      return { stages: pipeline };
    },
    {
      detail: {
        tags: ['Dashboard'],
        summary: 'Get order pipeline summary',
        description: 'Returns count and total value grouped by order status.',
        security: [{ bearerAuth: [] }],
      },
    },
  );
