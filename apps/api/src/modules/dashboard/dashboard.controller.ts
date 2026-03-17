import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import { getCollections, getTeamStats, getPipelineSummary, getLossAnalysis, getConversionMetrics, getFollowUps } from './dashboard.service';

// ═══════════════════════════════════════════════════════════════════════
//  Dashboard Controller
// ═══════════════════════════════════════════════════════════════════════

export const dashboardController = new Elysia({ prefix: '/dashboard' })
  // ── Require authentication for all routes ──
  .use(authGuard)

  // ── GET /dashboard/collections ─────────────────────────────────────
  .get(
    '/collections',
    async ({ auth, query }) => {
      const params = query as { from?: string; to?: string };
      const items = await getCollections(auth.tenantId, params.from, params.to);
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
    async ({ auth, query }) => {
      const params = query as { from?: string; to?: string };
      const stats = await getTeamStats(auth.tenantId, auth.userId, params.from, params.to);
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
    async ({ auth, query }) => {
      const params = query as { from?: string; to?: string; userId?: string };
      const pipeline = await getPipelineSummary(auth.tenantId, params.from, params.to, params.userId);
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
  )

  // ── GET /dashboard/loss-analysis ───────────────────────────────────
  .get(
    '/loss-analysis',
    async ({ auth, query }) => {
      const params = query as { from?: string; to?: string; userId?: string };
      return getLossAnalysis(auth.tenantId, params.from, params.to, params.userId);
    },
    {
      detail: {
        tags: ['Dashboard'],
        summary: 'Get cancel-reason breakdown',
        description: 'Returns cancelled orders grouped by loss reason with counts and percentages.',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── GET /dashboard/conversion ──────────────────────────────────────
  .get(
    '/conversion',
    async ({ auth, query }) => {
      const params = query as { from?: string; to?: string; userId?: string };
      return getConversionMetrics(auth.tenantId, params.from, params.to, params.userId);
    },
    {
      detail: {
        tags: ['Dashboard'],
        summary: 'Get conversion metrics',
        description: 'Returns win rate, total won/lost, and average days to close for orders in the period.',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── GET /dashboard/follow-ups ──────────────────────────────────────
  .get(
    '/follow-ups',
    async ({ auth, query }) => {
      const params = query as { userId?: string };
      const items = await getFollowUps(auth.tenantId, params.userId);
      return { items };
    },
    {
      detail: {
        tags: ['Dashboard'],
        summary: 'Get due/overdue follow-ups',
        description: 'Returns all comment follow-ups that are due today or overdue and not yet completed.',
        security: [{ bearerAuth: [] }],
      },
    },
  );
