// ═══════════════════════════════════════════════════════════════════════
//  Comments Service — CRUD for polymorphic entity comments
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../db';
import { entityComments } from '../../db/schema';

export interface CommentRow {
  id: string;
  entityType: string;
  entityId: string;
  userId: string;
  userName: string;
  content: string;
  followUpDate: string | null;
  followUpCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Map a DB row to a CommentRow. */
function mapRow(r: typeof entityComments.$inferSelect): CommentRow {
  return {
    ...r,
    followUpDate: r.followUpDate ?? null,
    followUpCompleted: r.followUpCompleted,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** List comments for an entity, newest first. */
export async function listComments(
  entityType: string,
  entityId: string,
): Promise<CommentRow[]> {
  const rows = await db
    .select()
    .from(entityComments)
    .where(
      and(
        eq(entityComments.entityType, entityType),
        eq(entityComments.entityId, entityId),
      ),
    )
    .orderBy(desc(entityComments.createdAt));

  return rows.map(mapRow);
}

/** Create a new comment. */
export async function createComment(params: {
  entityType: string;
  entityId: string;
  userId: string;
  userName: string;
  content: string;
  followUpDate?: string | null;
}): Promise<CommentRow> {
  const [row] = await db
    .insert(entityComments)
    .values({
      entityType: params.entityType,
      entityId: params.entityId,
      userId: params.userId,
      userName: params.userName,
      content: params.content,
      followUpDate: params.followUpDate ?? null,
    })
    .returning();

  return mapRow(row);
}

/** Update a comment (content and/or followUpDate). Returns null if not found. */
export async function updateComment(
  commentId: string,
  content: string,
  followUpDate?: string | null,
): Promise<CommentRow | null> {
  const existing = await getComment(commentId);
  if (!existing) return null;

  const updates: Record<string, unknown> = { content, updatedAt: new Date() };
  if (followUpDate !== undefined) {
    updates.followUpDate = followUpDate;
    if (!followUpDate) {
      updates.followUpCompleted = false;
    } else if (followUpDate !== existing.followUpDate) {
      // Re-open the follow-up only when the selected date actually changed.
      updates.followUpCompleted = false;
    }
  }

  const [row] = await db
    .update(entityComments)
    .set(updates)
    .where(eq(entityComments.id, commentId))
    .returning();

  return row ? mapRow(row) : null;
}

/** Delete a comment. Returns the deleted row or null. */
export async function deleteComment(commentId: string): Promise<CommentRow | null> {
  const [row] = await db
    .delete(entityComments)
    .where(eq(entityComments.id, commentId))
    .returning();

  return row ? mapRow(row) : null;
}

/** Get a single comment by ID. */
export async function getComment(commentId: string): Promise<CommentRow | null> {
  const [row] = await db
    .select()
    .from(entityComments)
    .where(eq(entityComments.id, commentId))
    .limit(1);

  return row ? mapRow(row) : null;
}

/** Mark a follow-up as completed. */
export async function completeFollowUp(commentId: string): Promise<CommentRow | null> {
  const [row] = await db
    .update(entityComments)
    .set({ followUpCompleted: true, updatedAt: new Date() })
    .where(eq(entityComments.id, commentId))
    .returning();

  return row ? mapRow(row) : null;
}
