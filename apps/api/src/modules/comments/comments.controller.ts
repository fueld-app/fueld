// ═══════════════════════════════════════════════════════════════════════
//  Comments Controller — REST endpoints for entity comments
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import {
  listComments,
  createComment,
  updateComment,
  deleteComment,
  getComment,
} from './comments.service';
import { resolveOrderId } from '../orders/orders.service';
import { db } from '../../db';
import { users } from '../../db/schema';
import { eq } from 'drizzle-orm';
import type { ApiResponse } from '@fueld/types';

/** Resolve entityId to a UUID when entityType is order (supports order numbers). */
async function resolveEntityId(entityType: string, entityId: string): Promise<string> {
  if (entityType.toLowerCase() === 'order') {
    return (await resolveOrderId(entityId)) ?? entityId;
  }
  return entityId;
}

export const commentsController = new Elysia({ prefix: '/comments' })
  .use(authGuard)

  /** GET /comments/:entityType/:entityId — list comments for an entity */
  .get(
    '/:entityType/:entityId',
    async ({ params }): Promise<ApiResponse<any>> => {
      const entityType = params.entityType.toLowerCase();
      const entityId = await resolveEntityId(entityType, params.entityId);
      const comments = await listComments(entityType, entityId);
      return { success: true, data: comments };
    },
    {
      params: t.Object({
        entityType: t.String(),
        entityId: t.String(),
      }),
    },
  )

  /** POST /comments/:entityType/:entityId — create a comment */
  .post(
    '/:entityType/:entityId',
    async ({ params, body, auth }): Promise<ApiResponse<any>> => {
      const entityType = params.entityType.toLowerCase();
      const entityId = await resolveEntityId(entityType, params.entityId);

      // Look up user name
      const [u] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, auth.sub))
        .limit(1);

      const comment = await createComment({
        entityType,
        entityId,
        userId: auth.sub,
        userName: u?.name ?? auth.email,
        content: body.content,
      });

      return { success: true, data: comment };
    },
    {
      params: t.Object({
        entityType: t.String(),
        entityId: t.String(),
      }),
      body: t.Object({
        content: t.String({ minLength: 1 }),
      }),
    },
  )

  /** PUT /comments/:commentId — update own comment */
  .put(
    '/:commentId',
    async ({ params, body, auth, set }): Promise<ApiResponse<any>> => {
      // Verify ownership
      const existing = await getComment(params.commentId);
      if (!existing) {
        set.status = 404;
        return { success: false, data: null, message: 'Comment not found' };
      }
      if (existing.userId !== auth.sub) {
        set.status = 403;
        return { success: false, data: null, message: 'You can only edit your own comments' };
      }

      const updated = await updateComment(params.commentId, body.content);
      return { success: true, data: updated };
    },
    {
      params: t.Object({ commentId: t.String() }),
      body: t.Object({
        content: t.String({ minLength: 1 }),
      }),
    },
  )

  /** DELETE /comments/:commentId — delete own comment */
  .delete(
    '/:commentId',
    async ({ params, auth, set }): Promise<ApiResponse<any>> => {
      const existing = await getComment(params.commentId);
      if (!existing) {
        set.status = 404;
        return { success: false, data: null, message: 'Comment not found' };
      }
      if (existing.userId !== auth.sub) {
        set.status = 403;
        return { success: false, data: null, message: 'You can only delete your own comments' };
      }

      await deleteComment(params.commentId);
      return { success: true, data: { id: params.commentId } };
    },
    {
      params: t.Object({ commentId: t.String() }),
    },
  );
