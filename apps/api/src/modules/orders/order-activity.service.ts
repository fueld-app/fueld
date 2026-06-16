// ═══════════════════════════════════════════════════════════════════════
//  Order Activity Service — activity log queries for orders
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../db';

export async function getOrderActivity(orderId: string) {
  const { activityLogs, users } = await import('../../db/schema');

  const logs = await db
    .select({
      id: activityLogs.id,
      userId: activityLogs.userId,
      userName: users.name,
      action: activityLogs.action,
      entityType: activityLogs.entityType,
      entityId: activityLogs.entityId,
      entityName: activityLogs.entityName,
      metadata: activityLogs.metadata,
      createdAt: activityLogs.createdAt,
    })
    .from(activityLogs)
    .leftJoin(users, eq(activityLogs.userId, users.id))
    .where(
      and(
        eq(activityLogs.entityType, 'order'),
        eq(activityLogs.entityId, orderId),
      ),
    )
    .orderBy(desc(activityLogs.createdAt))
    .limit(50);

  return logs.map((l) => ({
    id: l.id,
    userId: l.userId,
    userName: l.userName,
    action: l.action,
    entityType: l.entityType,
    entityId: l.entityId,
    entityName: l.entityName,
    metadata: l.metadata,
    createdAt: l.createdAt.toISOString(),
  }));
}
