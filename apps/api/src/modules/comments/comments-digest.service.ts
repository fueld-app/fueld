//  Comments Digest Service — Daily email with comments + activity rundown
//
//  Sends a daily email to team members with all comments and activity log
//  entries from the last 24 hours, filtered by team membership.

import { and, eq, gte, desc, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  entityComments,
  activityLogs,
  orders,
  users,
  userTeams,
  tenants,
  type TenantSettings,
} from '../../db/schema';
import { Role } from '@fueld/types';
import { sendNotificationEmail } from '../../lib/email';

interface DigestEntry {
  entityType: string;
  entityId: string;
  entityName: string;
  orderNumber: string | null;
  timestamp: string;
  userName: string;
  type: 'comment' | 'activity';
  content: string;
  action: string | null;
}

const ALL_ROLES = [
  Role.Admin,
  Role.Trader,
  Role.Teamlead,
  Role.OperationsManager,
  Role.Finance,
  Role.CreditManager,
  Role.Light,
];

/**
 * Run due comments digests for all tenants.
 * Called hourly by the scheduled job.
 */
export async function runDueCommentsDigests(now = new Date()): Promise<void> {
  const hourUtc = now.getUTCHours();
  const todayKey = now.toISOString().slice(0, 10);

  const allTenants = await db
    .select({ id: tenants.id, name: tenants.name, settings: tenants.settings })
    .from(tenants);

  for (const tenant of allTenants) {
    const settings = (tenant.settings ?? {}) as TenantSettings;
    const digest = settings.commentsDigest;
    if (!digest?.enabled) continue;
    if (Math.round(digest.hourUtc ?? 10) !== hourUtc) continue;

    // Check if already sent today (store lastSentAt in the settings)
    const lastSentKey = (digest as any).lastSentAt ?? '';
    if (lastSentKey.slice(0, 10) === todayKey) continue;

    try {
      await sendCommentsDigestForTenant(tenant.id, tenant.name, digest);
      // Update lastSentAt
      const updatedSettings = {
        ...settings,
        commentsDigest: { ...digest, lastSentAt: now.toISOString() },
      };
      await db
        .update(tenants)
        .set({ settings: updatedSettings, updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));
    } catch (err) {
      console.error(`[CommentsDigest] Failed for tenant ${tenant.id}:`, err);
    }
  }
}

/**
 * Build and send the comments digest email to all team members of a tenant.
 */
async function sendCommentsDigestForTenant(
  tenantId: string,
  tenantName: string,
  settings: NonNullable<TenantSettings['commentsDigest']>,
): Promise<void> {
  const includeActivityLog = settings.includeActivityLog ?? true;
  const recipientRoles = settings.recipientRoles?.length ? settings.recipientRoles : ALL_ROLES.map(String);
  const extraEmails = settings.extraEmails ?? [];

  // Get all active users in the recipient roles
  const recipientUsers = await db
    .select({ id: users.id, email: users.email, name: users.name, primaryTeamId: users.primaryTeamId })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));

  const eligibleUsers = recipientUsers.filter((u) => {
    const role = (u as any).role;
    return !role || recipientRoles.includes(String(role));
  });

  const recipientEmails = Array.from(new Set([
    ...eligibleUsers.map((u) => u.email),
    ...extraEmails,
  ].filter(Boolean)));

  if (recipientEmails.length === 0) return;

  // Build digest entries — query comments and activity logs for the last 24h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const entries = await buildDigestEntries(tenantId, since, includeActivityLog);

  if (entries.length === 0) return; // Don't send empty digest

  // Build HTML email
  const html = buildCommentsDigestHtml(tenantName, entries, since);
  const nowDate = new Date();
  const dateStr = nowDate.toISOString().slice(0, 10);
  const subject = `${tenantName} — Daily Activity Rundown for ${dateStr}`;

  await sendNotificationEmail(recipientEmails, subject, html, {
    textContent: buildCommentsDigestText(tenantName, entries, since),
  });
}

/**
 * Query comments and activity logs for the last 24h, grouped by entity.
 */
async function buildDigestEntries(
  tenantId: string,
  since: Date,
  includeActivityLog: boolean,
): Promise<DigestEntry[]> {
  const entries: DigestEntry[] = [];

  // 1. Query comments on orders for this tenant
  const orderComments = await db
    .select({
      commentId: entityComments.id,
      entityType: entityComments.entityType,
      entityId: entityComments.entityId,
      userId: entityComments.userId,
      userName: entityComments.userName,
      content: entityComments.content,
      createdAt: entityComments.createdAt,
      orderNumber: orders.orderNumber,
      orderStatus: orders.status,
    })
    .from(entityComments)
    .innerJoin(orders, eq(entityComments.entityId, orders.id))
    .where(
      and(
        eq(orders.tenantId, tenantId),
        eq(entityComments.entityType, 'order'),
        gte(entityComments.createdAt, since),
      ),
    )
    .orderBy(desc(entityComments.createdAt));

  for (const c of orderComments) {
    entries.push({
      entityType: 'order',
      entityId: c.entityId,
      entityName: c.orderNumber ?? c.entityId.slice(0, 8),
      orderNumber: c.orderNumber,
      timestamp: c.createdAt.toISOString(),
      userName: c.userName,
      type: 'comment',
      content: c.content,
      action: null,
    });
  }

  // 2. Query activity logs for status changes and updates on orders
  if (includeActivityLog) {
    const activityEntries = await db
      .select({
        id: activityLogs.id,
        userId: activityLogs.userId,
        action: activityLogs.action,
        entityType: activityLogs.entityType,
        entityId: activityLogs.entityId,
        entityName: activityLogs.entityName,
        metadata: activityLogs.metadata,
        createdAt: activityLogs.createdAt,
        orderNumber: orders.orderNumber,
      })
      .from(activityLogs)
      .innerJoin(orders, eq(activityLogs.entityId, orders.id))
      .where(
        and(
          eq(activityLogs.tenantId, tenantId),
          eq(activityLogs.entityType, 'order'),
          inArray(activityLogs.action, ['UPDATE', 'CREATE', 'DELETE']),
          gte(activityLogs.createdAt, since),
        ),
      )
      .orderBy(desc(activityLogs.createdAt))
      .limit(200); // cap to avoid huge emails

    // Get user names for activity logs
    const userIds = Array.from(new Set(activityEntries.map((a) => a.userId).filter(Boolean))) as string[];
    const userNames = new Map<string, string>();
    if (userIds.length > 0) {
      const userRows = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, userIds));
      for (const u of userRows) {
        userNames.set(u.id, u.name);
      }
    }

    for (const a of activityEntries) {
      // Skip VIEW actions — only include meaningful changes
      if (a.action === 'VIEW') continue;

      const meta = a.metadata as any;
      let description = a.action;
      if (meta?.field) {
        description = `${a.action}: ${meta.field}`;
        if (meta.oldValue !== undefined && meta.newValue !== undefined) {
          description += ` (${meta.oldValue} → ${meta.newValue})`;
        }
      } else if (a.action === 'CREATE') {
        description = 'Order created';
      }

      entries.push({
        entityType: 'order',
        entityId: a.entityId ?? '',
        entityName: a.orderNumber ?? a.entityName ?? a.entityId?.slice(0, 8) ?? '',
        orderNumber: a.orderNumber,
        timestamp: a.createdAt.toISOString(),
        userName: a.userId ? (userNames.get(a.userId) ?? 'Unknown') : 'System',
        type: 'activity',
        content: description,
        action: a.action,
      });
    }
  }

  // Sort by timestamp descending (newest first)
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return entries;
}

/**
 * Build HTML email for the comments digest.
 */
function buildCommentsDigestHtml(
  tenantName: string,
  entries: DigestEntry[],
  since: Date,
): string {
  // Group by order
  const byOrder = new Map<string, { orderNumber: string; entries: DigestEntry[] }>();
  for (const entry of entries) {
    const key = entry.entityId;
    const existing = byOrder.get(key);
    if (existing) {
      existing.entries.push(entry);
    } else {
      byOrder.set(key, { orderNumber: entry.orderNumber ?? entry.entityName, entries: [entry] });
    }
  }

  const orderSections = Array.from(byOrder.entries())
    .map(([orderId, data]) => {
      const rows = data.entries
        .map((e) => {
          const time = new Date(e.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
          const icon = e.type === 'comment' ? '💬' : '⚙️';
          const actionLabel = e.action ? `<span style="color:#6b7280;font-size:11px;">${e.action}</span> ` : '';
          return `<tr><td style="padding:4px 0;width:60px;vertical-align:top;color:#9ca3af;font-size:12px;">${time}</td><td style="padding:4px 0;vertical-align:top;">${icon} ${actionLabel}<strong>${escHtml(e.userName)}</strong>: ${escHtml(e.content)}</td></tr>`;
        })
        .join('');

      return `
        <div style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <div style="background:#f9fafb;padding:8px 12px;border-bottom:1px solid #e5e7eb;">
            <strong style="color:#111827;">${escHtml(data.orderNumber)}</strong>
            <span style="color:#6b7280;font-size:12px;margin-left:8px;">${data.entries.length} update${data.entries.length === 1 ? '' : 's'}</span>
          </div>
          <div style="padding:8px 12px;">
            <table style="width:100%;font-size:13px;color:#374151;">${rows}</table>
          </div>
        </div>
      `;
    })
    .join('');

  const dateStr = since.toISOString().slice(0, 10);

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;max-width:640px;">
      <h2 style="margin:0 0 8px;">${escHtml(tenantName)} — Daily Activity Rundown</h2>
      <p style="margin:0 0 20px;color:#6b7280;font-size:13px;">
        ${entries.length} update${entries.length === 1 ? '' : 's'} across ${byOrder.size} order${byOrder.size === 1 ? '' : 's'} since ${dateStr}
      </p>
      ${orderSections || '<p style="color:#6b7280;">No activity in the last 24 hours.</p>'}
      <p style="margin-top:24px;color:#9ca3af;font-size:11px;">
        This is an automated daily digest. Generated at ${new Date().toUTCString()}.
      </p>
    </div>
  `;
}

/**
 * Build plain text version for email clients that don't render HTML.
 */
function buildCommentsDigestText(
  tenantName: string,
  entries: DigestEntry[],
  since: Date,
): string {
  const lines: string[] = [
    `${tenantName} — Daily Activity Rundown`,
    `${entries.length} updates since ${since.toISOString().slice(0, 10)}`,
    '',
  ];

  for (const e of entries) {
    const time = new Date(e.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    const prefix = e.type === 'comment' ? '[COMMENT]' : `[${e.action ?? 'UPDATE'}]`;
    lines.push(`[${e.orderNumber ?? e.entityName}] ${time} ${prefix} ${e.userName}: ${e.content}`);
  }

  return lines.join('\n');
}

/**
 * Preview the comments digest HTML (for admin settings preview button).
 */
export async function previewCommentsDigest(tenantId: string): Promise<{ html: string; entryCount: number; orderCount: number }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const entries = await buildDigestEntries(tenantId, since, true);

  // Get tenant name
  const [tenant] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const html = buildCommentsDigestHtml(tenant?.name ?? 'Tenant', entries, since);
  const orderCount = new Set(entries.map((e) => e.entityId)).size;

  return { html, entryCount: entries.length, orderCount };
}

/**
 * Get comments digest settings for the current tenant.
 */
export async function getCommentsDigestSettings(): Promise<{
  enabled: boolean;
  hourUtc: number;
  recipientRoles: string[];
  extraEmails: string[];
  includeActivityLog: boolean;
  entityTypes: string[];
}> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as TenantSettings;
  const d = settings.commentsDigest;
  return {
    enabled: d?.enabled ?? false,
    hourUtc: d?.hourUtc ?? 10,
    recipientRoles: d?.recipientRoles ?? ALL_ROLES.map(String),
    extraEmails: d?.extraEmails ?? [],
    includeActivityLog: d?.includeActivityLog ?? true,
    entityTypes: d?.entityTypes ?? [],
  };
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}