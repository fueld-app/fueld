import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import {
  listUsers,
  inviteUser,
  listInvitations,
  updateUserRole,
  toggleUserActive,
  acceptInvitation,
  updateUserAllowedIps,
} from './admin.service';
import { disconnectUserSessions } from '../activity/session-tracker';
import type { ApiResponse } from '@fueld/types';

// ─── Admin Controller ────────────────────────────────────────────────
// All endpoints require ADMIN role.
// ─────────────────────────────────────────────────────────────────────

/** Middleware: reject non-admin users. */
function requireAdmin(auth: { role: string } | undefined) {
  if (!auth || auth.role !== 'ADMIN') {
    throw new Error('Admin access required');
  }
}

export const adminController = new Elysia({ prefix: '/admin' })
  .use(authGuard)

  // ── GET /admin/users ─────────────────────────────────────────────
  .get('/users', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await listUsers();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list users';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin'], summary: 'List all users', security: [{ bearerAuth: [] }] },
  })

  // ── GET /admin/invitations ───────────────────────────────────────
  .get('/invitations', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await listInvitations();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list invitations';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin'], summary: 'List all invitations', security: [{ bearerAuth: [] }] },
  })

  // ── POST /admin/users/invite ─────────────────────────────────────
  .post('/users/invite', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const invite = await inviteUser({
        email: body.email,
        name: body.name,
        role: body.role as 'ADMIN' | 'TRADER' | 'FINANCE' | 'TEAMLEAD',
        invitedBy: auth.sub,
      });

      // Build invite link — frontend will handle the /invite/:token route
      const baseUrl = process.env['APP_URL'] || 'http://localhost:4200';
      const inviteLink = `${baseUrl}/invite/${invite.token}`;

      return {
        success: true,
        data: { ...invite, inviteLink },
      } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to invite user';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      email: t.String({ format: 'email' }),
      name: t.String({ minLength: 1 }),
      role: t.String(),
    }),
    detail: { tags: ['Admin'], summary: 'Invite a new user via email', security: [{ bearerAuth: [] }] },
  })

  // ── PATCH /admin/users/:id/role ──────────────────────────────────
  .patch('/users/:id/role', async ({ auth, params, body }) => {
    try {
      requireAdmin(auth);

      // Prevent self-demotion
      if (params.id === auth.sub) {
        return {
          success: false,
          data: null,
          message: 'You cannot change your own role',
        } satisfies ApiResponse<null>;
      }

      const data = await updateUserRole(
        params.id,
        body.role as 'ADMIN' | 'TRADER' | 'FINANCE' | 'TEAMLEAD',
      );
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update role';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ role: t.String() }),
    detail: { tags: ['Admin'], summary: 'Update user role', security: [{ bearerAuth: [] }] },
  })

  // ── PATCH /admin/users/:id/active ────────────────────────────────
  .patch('/users/:id/active', async ({ auth, params, body }) => {
    try {
      requireAdmin(auth);

      // Prevent self-deactivation
      if (params.id === auth.sub) {
        return {
          success: false,
          data: null,
          message: 'You cannot deactivate yourself',
        } satisfies ApiResponse<null>;
      }

      const data = await toggleUserActive(params.id, body.isActive);

      // If deactivating, force-disconnect all their WebSocket sessions
      if (!body.isActive) {
        disconnectUserSessions(params.id, 'Your account has been deactivated');
      }

      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update user status';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ isActive: t.Boolean() }),
    detail: { tags: ['Admin'], summary: 'Activate/deactivate a user', security: [{ bearerAuth: [] }] },
  })

  // ── PATCH /admin/users/:id/allowed-ips ───────────────────────────
  .patch('/users/:id/allowed-ips', async ({ auth, params, body }) => {
    try {
      requireAdmin(auth);

      // Prevent locking yourself out
      if (params.id === auth.sub && body.allowedIps && body.allowedIps.length > 0) {
        return {
          success: false,
          data: null,
          message: 'You cannot set IP restrictions on your own account',
        } satisfies ApiResponse<null>;
      }

      // Validate IP formats
      if (body.allowedIps) {
        for (const ip of body.allowedIps) {
          if (!isValidIpOrCidr(ip)) {
            return {
              success: false,
              data: null,
              message: `Invalid IP address or CIDR: ${ip}`,
            } satisfies ApiResponse<null>;
          }
        }
      }

      const data = await updateUserAllowedIps(params.id, body.allowedIps);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update allowed IPs';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ allowedIps: t.Union([t.Array(t.String()), t.Null()]) }),
    detail: { tags: ['Admin'], summary: 'Set allowed IP addresses for a user', security: [{ bearerAuth: [] }] },
  });

/** Validate an IP address or CIDR notation */
function isValidIpOrCidr(value: string): boolean {
  const cidrParts = value.split('/');
  const ip = cidrParts[0]!;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (const p of parts) {
    const n = parseInt(p!, 10);
    if (isNaN(n) || n < 0 || n > 255) return false;
  }
  if (cidrParts.length === 2) {
    const prefix = parseInt(cidrParts[1]!, 10);
    if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;
  } else if (cidrParts.length > 2) {
    return false;
  }
  return true;
}

// ─── Public invitation acceptance endpoint ───────────────────────────
// This is separate since it doesn't require admin auth.

export const inviteController = new Elysia({ prefix: '/invite' })

  // ── GET /invite/:token — validate invitation ─────────────────────
  .get('/:token', async ({ params }) => {
    try {
      const { db } = await import('../../db');
      const { invitations } = await import('../../db/schema');
      const { eq } = await import('drizzle-orm');

      const invite = await db.query.invitations.findFirst({
        where: eq(invitations.token, params.token),
      });

      if (!invite) {
        return { success: false, data: null, message: 'Invalid invitation' } satisfies ApiResponse<null>;
      }
      if (invite.acceptedAt) {
        return { success: false, data: null, message: 'Invitation already used' } satisfies ApiResponse<null>;
      }
      if (invite.expiresAt < new Date()) {
        return { success: false, data: null, message: 'Invitation expired' } satisfies ApiResponse<null>;
      }

      return {
        success: true,
        data: {
          email: invite.email,
          name: invite.name,
          role: invite.role,
        },
      } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to validate invitation';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ token: t.String() }),
    detail: { tags: ['Invitations'], summary: 'Validate an invitation token' },
  })

  // ── POST /invite/:token/accept — complete signup ─────────────────
  .post('/:token/accept', async ({ params, body }) => {
    try {
      const { jwtAccessPlugin, jwtRefreshPlugin } = await import('../auth/jwt.setup');
      const { storeRefreshToken } = await import('../auth/auth.service');

      // Create a temporary Elysia instance to get JWT signing
      // Instead, we'll handle this directly
      const user = await acceptInvitation(params.token, body.password);

      return {
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            is2faEnabled: user.is2faEnabled,
          },
          message: 'Account created successfully. Please log in.',
        },
      } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to accept invitation';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ token: t.String() }),
    body: t.Object({
      password: t.String({ minLength: 8 }),
    }),
    detail: { tags: ['Invitations'], summary: 'Accept an invitation and create account' },
  });
