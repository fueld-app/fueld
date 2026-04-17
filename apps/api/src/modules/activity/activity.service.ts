// ═══════════════════════════════════════════════════════════════════════
//  Activity Service — Persistent activity logging & querying
//
//  Logs ALL user activity (reads + writes) with client metadata.
//  Supports configurable retention period with hourly auto-pruning.
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, asc, desc, sql, lt, gte, lte, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { activityLogs, tenants, users } from '../../db/schema';
import { lookupIp } from './geoip';
import { extractClientIp } from '../../utils/client-ip';

// ─── Constants ───────────────────────────────────────────────────────

const DEFAULT_RETENTION_DAYS = 90;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// ─── Route → Entity Mapping ─────────────────────────────────────────

const UUID_RE = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';

const ROUTE_PATTERNS: Array<[RegExp, string]> = [
  [new RegExp(`^/companies/local/(${UUID_RE})`), 'company'],
  [new RegExp(`^/companies/(${UUID_RE})`), 'company'],
  [/^\/companies/, 'company'],
  [new RegExp(`^/vessels/(${UUID_RE})`), 'vessel'],
  [/^\/vessels/, 'vessel'],
  [new RegExp(`^/lloyds/places/local/(${UUID_RE})`), 'place'],
  [new RegExp(`^/lloyds/places/suppliers/(${UUID_RE})`), 'port_supplier'],
  [new RegExp(`^/lloyds/places/(${UUID_RE})`), 'place'],
  [/^\/lloyds\/places/, 'place'],
  [new RegExp(`^/trading/orders/(${UUID_RE})`), 'order'],
  [new RegExp(`^/orders/(${UUID_RE})`), 'order'],
  [/^\/orders/, 'order'],
  [new RegExp(`^/credit/(${UUID_RE})`), 'credit_line'],
  [/^\/credit/, 'credit_line'],
  [new RegExp(`^/admin/settings/teams/(${UUID_RE})`), 'team'],
  [new RegExp(`^/admin/settings/company-groups/(${UUID_RE})`), 'company_group'],
  [/^\/admin\/settings\/integrations/, 'integration'],
  [new RegExp(`^/admin/users/(${UUID_RE})`), 'user'],
  [/^\/admin/, 'admin'],
  [/^\/dashboard/, 'dashboard'],
  [/^\/auth\/login/, 'auth'],
  [/^\/auth\/logout/, 'auth'],
  [/^\/auth\/register/, 'auth'],
  [/^\/auth\/verify-2fa/, 'auth'],
  [/^\/lloyds/, 'lloyds'],
];

const SKIP_PATHS = new Set([
  '/health',
  '/admin/activity',
  '/admin/sessions',
]);

const AUTO_LOG_SKIP_PATTERNS: Array<{ method: string; pattern: RegExp }> = [
  { method: 'PUT', pattern: /^\/orders\/[^/]+$/ },
  { method: 'PUT', pattern: /^\/orders\/[^/]+\/items$/ },
  { method: 'PUT', pattern: /^\/trading\/orders\/[^/]+$/ },
  { method: 'PUT', pattern: /^\/trading\/orders\/[^/]+\/items$/ },
  { method: 'PATCH', pattern: /^\/companies\/local\/[^/]+$/ },
  { method: 'PATCH', pattern: /^\/companies\/local\/[^/]+\/types$/ },
  { method: 'PATCH', pattern: /^\/companies\/local\/[^/]+\/segments$/ },
  { method: 'PATCH', pattern: /^\/companies\/local\/[^/]+\/responsible-user$/ },
  { method: 'PATCH', pattern: /^\/vessels\/local\/[^/]+$/ },
  { method: 'PUT', pattern: /^\/lloyds\/places\/local\/[^/]+$/ },
  { method: 'PUT', pattern: /^\/lloyds\/places\/local\/[^/]+\/order-remark$/ },
];

function shouldSkip(path: string): boolean {
  if (SKIP_PATHS.has(path)) return true;
  if (path.startsWith('/swagger')) return true;
  if (path.startsWith('/auth/refresh')) return true;
  if (path.endsWith('/sync')) return true; // Auto-syncs are not user actions
  if (path.endsWith('/responsible-user')) return true; // Manually logged in controller
  if (path.includes('/suppliers')) return true; // Manually logged in controller
  if (path === '/ws') return true;
  return false;
}

function shouldSkipAutoLog(method: string, path: string): boolean {
  if (shouldSkip(path)) return true;

  return AUTO_LOG_SKIP_PATTERNS.some((entry) => entry.method === method && entry.pattern.test(path));
}

function parseRoute(
  method: string,
  path: string,
): { action: string; entityType: string | null; entityId: string | null } {
  const action =
    method === 'GET'
      ? 'VIEW'
      : method === 'POST'
        ? 'CREATE'
        : method === 'PUT' || method === 'PATCH'
          ? 'UPDATE'
          : method === 'DELETE'
            ? 'DELETE'
            : 'OTHER';

  for (const [regex, entityType] of ROUTE_PATTERNS) {
    const match = path.match(regex);
    if (match) {
      return { action, entityType, entityId: match[1] ?? null };
    }
  }

  return { action, entityType: null, entityId: null };
}

// ─── JWT Decode (no verification, just payload extraction) ───────────

function decodeJwtPayload(
  token: string,
): { sub?: string; email?: string; role?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    );
    return payload;
  } catch {
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function parsePlatform(ua: string | null): string | null {
  if (!ua) return null;
  let browser = 'Unknown';
  if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('OPR/')) browser = 'Opera';
  else if (ua.includes('Chrome/')) browser = 'Chrome';
  else if (ua.includes('Safari/')) browser = 'Safari';

  let os = 'Unknown';
  if (ua.includes('Macintosh') || ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('iPhone')) os = 'iOS';
  else if (ua.includes('iPad')) os = 'iPadOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('Linux')) os = 'Linux';

  return `${browser} / ${os}`;
}

// ─── Logging ─────────────────────────────────────────────────────────

export interface LogActivityParams {
  userId: string;
  tenantId?: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  entityName?: string | null;
  httpMethod?: string | null;
  httpPath?: string | null;
  pageTitle?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  timezone?: string | null;
  language?: string | null;
  country?: string | null;
  city?: string | null;
  metadata?: unknown;
  requestBody?: unknown;
}

/** Insert an activity log entry (fire-and-forget). */
export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    let tenantId = params.tenantId;
    if (!tenantId) {
      const tenant = await db.query.tenants.findFirst();
      if (!tenant) return;
      tenantId = tenant.id;
    }

    await db.insert(activityLogs).values({
      tenantId,
      userId: params.userId,
      action: params.action,
      entityType: params.entityType ?? 'unknown',
      entityId: params.entityId,
      entityName: params.entityName ?? null,
      httpMethod: params.httpMethod ?? null,
      httpPath: params.httpPath ?? null,
      pageTitle: params.pageTitle ?? null,
      clientIp: params.clientIp ?? null,
      userAgent: params.userAgent ?? null,
      platform: parsePlatform(params.userAgent ?? null),
      timezone: params.timezone ?? null,
      language: params.language ?? null,
      country: params.country ?? null,
      city: params.city ?? null,
      metadata: params.metadata ?? params.requestBody ?? null,
    });
  } catch (err) {
    console.error('[Activity] Failed to log activity:', err);
  }
}

/**
 * Auto-log from an HTTP request context.
 * Called from the global onAfterResponse hook.
 */
export async function logFromRequest(request: Request, statusCode: number, requestBody?: unknown): Promise<void> {
  // Skip errors
  if (statusCode >= 400) return;

  // Only log mutations (POST, PUT, PATCH, DELETE) — page views are tracked via WS presence
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;

  const url = new URL(request.url);
  const path = url.pathname;

  // Skip non-interesting paths
  if (shouldSkipAutoLog(request.method, path)) return;

  // Extract user from JWT
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return; // Skip anonymous requests

  const payload = decodeJwtPayload(authHeader.slice(7));
  if (!payload?.sub) return;

  // Parse route
  const { action, entityType, entityId } = parseRoute(request.method, path);
  if (!entityType) return; // Skip unmapped routes

  const ip = extractClientIp(request);
  const userAgent = request.headers.get('user-agent') ?? null;
  const acceptLanguage = request.headers.get('accept-language');
  const language = acceptLanguage?.split(',')[0]?.split(';')[0]?.trim() ?? null;
  const geo = await lookupIp(ip);

  // Fire-and-forget
  logActivity({
    userId: payload.sub,
    action,
    entityType,
    entityId,
    httpMethod: request.method,
    httpPath: path,
    clientIp: ip,
    userAgent,
    language,
    country: geo.country,
    city: geo.city,
    requestBody: requestBody ?? null,
  }).catch(() => {});
}

// ─── Querying ────────────────────────────────────────────────────────

export interface ActivityQuery {
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ActivityLogRow {
  id: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  entityName: string | null;
  httpMethod: string | null;
  httpPath: string | null;
  pageTitle: string | null;
  clientIp: string | null;
  userAgent: string | null;
  platform: string | null;
  timezone: string | null;
  language: string | null;
  country: string | null;
  city: string | null;
  metadata: unknown;
  createdAt: string;
}

/** Query activity logs with optional filters. */
export async function queryActivity(
  query: ActivityQuery,
): Promise<{ items: ActivityLogRow[]; total: number }> {
  const conditions = [];

  if (query.entityType) {
    conditions.push(eq(activityLogs.entityType, query.entityType));
  }
  if (query.entityId) {
    conditions.push(eq(activityLogs.entityId, query.entityId));
  }
  if (query.userId) {
    conditions.push(eq(activityLogs.userId, query.userId));
  }
  if (query.action) {
    conditions.push(eq(activityLogs.action, query.action));
  }
  if (query.dateFrom) {
    conditions.push(gte(activityLogs.createdAt, new Date(query.dateFrom)));
  }
  if (query.dateTo) {
    // End of day
    const to = new Date(query.dateTo);
    to.setDate(to.getDate() + 1);
    conditions.push(lte(activityLogs.createdAt, to));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = Math.min(query.limit ?? 50, 200);
  const offset = query.offset ?? 0;

  // Sortable columns
  const sortMap: Record<string, any> = {
    createdAt: activityLogs.createdAt,
    user: users.name,
    action: activityLogs.action,
    entityType: activityLogs.entityType,
    platform: activityLogs.platform,
    clientIp: activityLogs.clientIp,
  };
  const sortCol = sortMap[query.sortBy ?? ''] ?? activityLogs.createdAt;
  const defaultDir = query.sortBy ? 'asc' : 'desc';
  const sortFn = (query.sortDir ?? defaultDir) === 'desc' ? desc : asc;

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: activityLogs.id,
        userId: activityLogs.userId,
        userName: users.name,
        userEmail: users.email,
        action: activityLogs.action,
        entityType: activityLogs.entityType,
        entityId: activityLogs.entityId,
        entityName: activityLogs.entityName,
        httpMethod: activityLogs.httpMethod,
        httpPath: activityLogs.httpPath,
        pageTitle: activityLogs.pageTitle,
        clientIp: activityLogs.clientIp,
        userAgent: activityLogs.userAgent,
        platform: activityLogs.platform,
        timezone: activityLogs.timezone,
        language: activityLogs.language,
        country: activityLogs.country,
        city: activityLogs.city,
        metadata: activityLogs.metadata,
        createdAt: activityLogs.createdAt,
      })
      .from(activityLogs)
      .leftJoin(users, eq(activityLogs.userId, users.id))
      .where(where)
      .orderBy(sortFn(sortCol))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(activityLogs)
      .where(where),
  ]);

  return {
    items: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
    total: countResult[0]?.count ?? 0,
  };
}

/** Get most recent UPDATE or CREATE activity for an entity. */
export async function getLastEditedInfo(
  entityType: string,
  entityId: string,
): Promise<ActivityLogRow | null> {
  const rows = await db
    .select({
      id: activityLogs.id,
      userId: activityLogs.userId,
      userName: users.name,
      userEmail: users.email,
      action: activityLogs.action,
      entityType: activityLogs.entityType,
      entityId: activityLogs.entityId,
      entityName: activityLogs.entityName,
      httpMethod: activityLogs.httpMethod,
      httpPath: activityLogs.httpPath,
      pageTitle: activityLogs.pageTitle,
      clientIp: activityLogs.clientIp,
      userAgent: activityLogs.userAgent,
      platform: activityLogs.platform,
      timezone: activityLogs.timezone,
      language: activityLogs.language,
      country: activityLogs.country,
      city: activityLogs.city,
      metadata: activityLogs.metadata,
      createdAt: activityLogs.createdAt,
    })
    .from(activityLogs)
    .leftJoin(users, eq(activityLogs.userId, users.id))
    .where(
      and(
        eq(activityLogs.entityType, entityType),
        eq(activityLogs.entityId, entityId),
        inArray(activityLogs.action, ['UPDATE', 'CREATE']),
      ),
    )
    .orderBy(desc(activityLogs.createdAt))
    .limit(1);

  if (!rows.length) return null;
  return { ...rows[0], createdAt: rows[0].createdAt.toISOString() };
}

// ─── Retention / Pruning ─────────────────────────────────────────────

/** Get the configured retention days for the tenant. */
export async function getRetentionDays(): Promise<number> {
  try {
    const tenant = await db.query.tenants.findFirst();
    const settings = (tenant as any)?.settings as
      | { activityRetentionDays?: number }
      | null
      | undefined;
    return settings?.activityRetentionDays ?? DEFAULT_RETENTION_DAYS;
  } catch {
    return DEFAULT_RETENTION_DAYS;
  }
}

/** Set the retention days for activity logs. */
export async function setRetentionDays(days: number): Promise<void> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const currentSettings = ((tenant as any).settings as Record<string, unknown>) ?? {};
  await db
    .update(tenants)
    .set({ settings: { ...currentSettings, activityRetentionDays: days } as any })
    .where(eq(tenants.id, tenant.id));
}

/** Delete activity logs older than the retention period. */
async function pruneOldLogs(): Promise<number> {
  const days = await getRetentionDays();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const result = await db
    .delete(activityLogs)
    .where(lt(activityLogs.createdAt, cutoff));

  const count = (result as any)?.rowCount ?? (result as any)?.count ?? 0;
  if (count > 0) {
    console.log(`[Activity] Pruned ${count} logs older than ${days} days`);
  }
  return count;
}

// ─── Start background pruning ────────────────────────────────────────

let pruneInterval: ReturnType<typeof setInterval> | null = null;

export function startPruneJob(): void {
  if (pruneInterval) return;
  // Run immediately on startup, then every hour
  pruneOldLogs().catch((err) =>
    console.error('[Activity] Initial prune failed:', err),
  );
  pruneInterval = setInterval(() => {
    pruneOldLogs().catch((err) =>
      console.error('[Activity] Prune job failed:', err),
    );
  }, PRUNE_INTERVAL_MS);
  console.log('[Activity] Background prune job started (every 1h)');
}
