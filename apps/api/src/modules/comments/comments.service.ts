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
  createdAt: string;
  updatedAt: string;
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

  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Create a new comment. */
export async function createComment(params: {
  entityType: string;
  entityId: string;
  userId: string;
  userName: string;
  content: string;
}): Promise<CommentRow> {
  const [row] = await db
    .insert(entityComments)
    .values({
      entityType: params.entityType,
      entityId: params.entityId,
      userId: params.userId,
      userName: params.userName,
      content: params.content,
    })
    .returning();

  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Update a comment (only content). Returns null if not found. */
export async function updateComment(
  commentId: string,
  content: string,
): Promise<CommentRow | null> {
  const [row] = await db
    .update(entityComments)
    .set({ content, updatedAt: new Date() })
    .where(eq(entityComments.id, commentId))
    .returning();

  if (!row) return null;
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Delete a comment. Returns the deleted row or null. */
export async function deleteComment(commentId: string): Promise<CommentRow | null> {
  const [row] = await db
    .delete(entityComments)
    .where(eq(entityComments.id, commentId))
    .returning();

  if (!row) return null;
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Get a single comment by ID. */
export async function getComment(commentId: string): Promise<CommentRow | null> {
  const [row] = await db
    .select()
    .from(entityComments)
    .where(eq(entityComments.id, commentId))
    .limit(1);

  if (!row) return null;
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
