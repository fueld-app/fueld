import { beforeEach, describe, expect, it } from 'bun:test';
import { eq, and, isNull } from 'drizzle-orm';
import { createHash } from 'crypto';
import { passwordResetTokens, users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { hashPassword } from '../src/modules/auth/password.service';
import { loginE2E, requestJson } from './helpers/e2e';

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

describe('admin password reset e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('allows admin to send reset link and user can reset password with token (single-use)', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    // Promote seeded user to admin and login.
    await db.update(users).set({ role: 'ADMIN', updatedAt: new Date() }).where(eq(users.id, seeded.user.id));
    const adminLogin = await loginE2E(seeded.user.email, seeded.password);
    const adminToken = adminLogin.accessToken;

    const targetEmail = 'reset-target@test.local';
    const oldPassword = 'OldPassw0rd!';
    const newPassword = 'NewPassw0rd!';

    const [target] = await db
      .insert(users)
      .values({
        tenantId: seeded.tenant.id,
        email: targetEmail,
        name: 'Reset Target',
        role: 'TRADER',
        passwordHash: await hashPassword(oldPassword),
      })
      .returning();

    const send = await requestJson(`/admin/users/${target!.id}/send-password-reset`, {
      method: 'POST',
      token: adminToken,
    });

    expect(send.status).toBe(200);
    expect(send.data?.success).toBe(true);
    expect(String(send.data?.data?.resetLink ?? '')).toContain('reset-password');

    const resetLink = String(send.data?.data?.resetLink);
    const url = new URL(resetLink);
    const token = url.searchParams.get('token');
    expect(token).toBeTruthy();

    // Reset password using public endpoint.
    const complete = await requestJson('/auth/password-reset', {
      method: 'POST',
      body: { token, password: newPassword },
    });

    expect(complete.status).toBe(200);
    expect(complete.data?.success).toBe(true);

    // Old password should fail, new password should succeed.
    const oldLogin = await loginE2E(targetEmail, oldPassword);
    expect(oldLogin.data?.success).toBe(false);

    const newLogin = await loginE2E(targetEmail, newPassword);
    expect(newLogin.data?.success).toBe(true);

    // Token should be single-use.
    const repeat = await requestJson('/auth/password-reset', {
      method: 'POST',
      body: { token, password: 'AnotherPassw0rd!' },
    });
    expect(repeat.status).toBe(200);
    expect(repeat.data?.success).toBe(false);
    expect(String(repeat.data?.message ?? '')).toContain('expired');
  });

  it('rejects expired reset tokens', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    await db.update(users).set({ role: 'ADMIN', updatedAt: new Date() }).where(eq(users.id, seeded.user.id));
    const adminLogin = await loginE2E(seeded.user.email, seeded.password);
    const adminToken = adminLogin.accessToken;

    const [target] = await db
      .insert(users)
      .values({
        tenantId: seeded.tenant.id,
        email: 'expired-reset@test.local',
        name: 'Expired Reset',
        role: 'TRADER',
        passwordHash: await hashPassword('OldPassw0rd!'),
      })
      .returning();

    const send = await requestJson(`/admin/users/${target!.id}/send-password-reset`, {
      method: 'POST',
      token: adminToken,
    });

    const resetLink = String(send.data?.data?.resetLink);
    const url = new URL(resetLink);
    const token = url.searchParams.get('token')!;
    const tokenHash = sha256Hex(token);

    // Force expiry in DB.
    await db
      .update(passwordResetTokens)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(and(eq(passwordResetTokens.userId, target!.id), eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt)));

    const complete = await requestJson('/auth/password-reset', {
      method: 'POST',
      body: { token, password: 'NewPassw0rd!' },
    });

    expect(complete.status).toBe(200);
    expect(complete.data?.success).toBe(false);
    expect(String(complete.data?.message ?? '')).toContain('expired');
  });
});
