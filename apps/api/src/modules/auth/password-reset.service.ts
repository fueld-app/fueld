import { createHash } from 'crypto';
import { and, eq, isNull, gt } from 'drizzle-orm';
import { db } from '../../db';
import { passwordResetTokens, users } from '../../db/schema';
import { hashPassword } from './password.service';

function generateResetToken(): string {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createPasswordResetForUser(params: {
  userId: string;
  requestedBy: string | null;
  expiresInMinutes?: number;
}): Promise<{ userId: string; email: string; name: string; token: string; expiresAt: Date }> {
  const record = await db.query.users.findFirst({ where: eq(users.id, params.userId) });
  if (!record) throw new Error('User not found');

  const token = generateResetToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + (params.expiresInMinutes ?? 60) * 60_000);

  await db.insert(passwordResetTokens).values({
    userId: record.id,
    tokenHash,
    requestedBy: params.requestedBy,
    expiresAt,
  });

  return {
    userId: record.id,
    email: record.email,
    name: record.name,
    token,
    expiresAt,
  };
}

export async function resetPasswordWithToken(params: {
  token: string;
  newPassword: string;
}): Promise<{ userId: string }>
{
  const token = params.token.trim();
  if (!token) throw new Error('Invalid password reset token');

  const now = new Date();
  const tokenHash = hashToken(token);

  const row = await db.query.passwordResetTokens.findFirst({
    where: and(
      eq(passwordResetTokens.tokenHash, tokenHash),
      isNull(passwordResetTokens.usedAt),
      gt(passwordResetTokens.expiresAt, now),
    ),
  });

  if (!row) throw new Error('Invalid or expired password reset token');

  const passwordHash = await hashPassword(params.newPassword);

  // Update password and revoke refresh token.
  await db
    .update(users)
    .set({ passwordHash, refreshToken: null, updatedAt: new Date() })
    .where(eq(users.id, row.userId));

  // Mark token as used.
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, row.id));

  return { userId: row.userId };
}
