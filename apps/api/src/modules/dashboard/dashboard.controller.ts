import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import { db } from '../../db';
import { tenants } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { getCollections, getTeamStats, getPipelineSummary, getLossAnalysis, getConversionMetrics, getFollowUps, parseDateBasis, getMonthlyHistory } from './dashboard.service';

// ═══════════════════════════════════════════════════════════════════════
//  Dashboard Controller
// ═══════════════════════════════════════════════════════════════════════

/** Returns true if the authenticated user is a LIGHT user (no price visibility). */
function isLightUser(role: string): boolean {
  return role === 'LIGHT';
}

export const dashboardController = new Elysia({ prefix: '/dashboard' })
  // ── Require authentication for all routes ──
  .use(authGuard)

  // ── GET /dashboard/monthly-history ──────────────────────────────
  .get(
    '/monthly-history',
    async ({ auth, query }) => {
      // LIGHT users must not see profit/turnover data
      if (isLightUser(auth.role)) {
        return { items: [] };
      }
      // Tenant-gated by the 'performance-history' view
      const [tenant] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1);
      const views = ((tenant?.settings as any)?.enabledViews ?? []) as string[];
      if (!views.includes('performance-history')) {
        return { items: [] };
      }
      const params = query as { fromYear?: string; toYear?: string };
      const items = await getMonthlyHistory(
        auth.tenantId,
        params.fromYear ? Number(params.fromYear) : undefined,
        params.toYear ? Number(params.toYear) : undefined,
      );
      return { items, count: items.length };
    },
    {
      query: t.Object({
        fromYear: t.Optional(t.String()),
        toYear: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Dashboard'],
        summary: 'Monthly trading profit + turnover series (historical performance chart)',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── GET /dashboard/collections ─────────────────────────────────────
  .get(
    '/collections',
    async ({ auth, query }) => {
      // LIGHT users must not see collections (financial data)
      if (isLightUser(auth.role)) {
        return { items: [], count: 0 };
      }
      const params = query as { from?: string; to?: string };
      const items = await getCollections(auth.tenantId, params.from, params.to);
      return { items, count: items.length };
    },
    {
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        userId: t.Optional(t.String()),
        dateBasis: t.Optional(t.String()),
      }),
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
      // LIGHT users must not see financial stats (revenue, profit, cost)
      if (isLightUser(auth.role)) {
        return { traders: [] };
      }
      const params = query as { from?: string; to?: string; dateBasis?: string };
      const stats = await getTeamStats(auth.tenantId, auth.userId, params.from, params.to, parseDateBasis(params.dateBasis));
      return { traders: stats };
    },
    {
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        userId: t.Optional(t.String()),
        dateBasis: t.Optional(t.String()),
      }),
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
      const params = query as { from?: string; to?: string; userId?: string; dateBasis?: string };
      const pipeline = await getPipelineSummary(auth.tenantId, params.from, params.to, params.userId, parseDateBasis(params.dateBasis));
      // LIGHT users see pipeline counts but NOT dollar values
      if (isLightUser(auth.role)) {
        return { stages: pipeline.map((s) => ({ ...s, totalValue: '0' })) };
      }
      return { stages: pipeline };
    },
    {
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        userId: t.Optional(t.String()),
        dateBasis: t.Optional(t.String()),
      }),
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
      const params = query as { from?: string; to?: string; userId?: string; dateBasis?: string };
      return getLossAnalysis(auth.tenantId, params.from, params.to, params.userId, parseDateBasis(params.dateBasis));
    },
    {
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        userId: t.Optional(t.String()),
        dateBasis: t.Optional(t.String()),
      }),
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
      const params = query as { from?: string; to?: string; userId?: string; dateBasis?: string };
      return getConversionMetrics(auth.tenantId, params.from, params.to, params.userId, parseDateBasis(params.dateBasis));
    },
    {
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        userId: t.Optional(t.String()),
        dateBasis: t.Optional(t.String()),
      }),
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
      const params = query as { userId?: string; to?: string };
      const items = await getFollowUps(auth.tenantId, params.userId, params.to);
      return { items };
    },
    {
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        userId: t.Optional(t.String()),
        dateBasis: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Dashboard'],
        summary: 'Get incomplete follow-ups',
        description: 'Returns incomplete comment follow-ups, optionally limited to a maximum follow-up date.',
        security: [{ bearerAuth: [] }],
      },
    },
  );