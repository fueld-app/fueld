// ═══════════════════════════════════════════════════════════════════════
//  AES-256-GCM encryption for integration credentials
//
//  In production, CREDENTIALS_ENCRYPTION_KEY must be set explicitly so
//  encrypted credentials survive VPS/database moves and backup restores.
//  In non-production environments, DATABASE_URL remains an allowed fallback.
// ═══════════════════════════════════════════════════════════════════════

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM

export function isProductionRuntime(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

/**
 * The credentials key must be present, always.
 *
 * This deliberately does NOT gate on NODE_ENV. It used to
 * (`isProductionRuntime() && !key`), and every deployed instance is a
 * production deployment — but none of them set NODE_ENV, so the check never
 * fired and the app silently fell through to the DATABASE_URL-derived key.
 * That fallback ties every stored credential to the database URL, so a
 * restore, migration or URL rotation quietly breaks SMTP, Microsoft 365,
 * Kantox, LLM and banking credentials at once. Riviera Marine ran that way
 * until 2026-09-23, and one credential (Kantox) ended up encrypted under a
 * key that could not be reproduced.
 *
 * Requiring the key unconditionally is the property we actually want, and it
 * cannot be defeated by an env var a deployment forgot to set.
 */
export function assertCredentialsEncryptionConfig(): void {
  if (!process.env['CREDENTIALS_ENCRYPTION_KEY']) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY must be set. Integration credentials are encrypted at rest with it; '
      + 'running without one derives the key from DATABASE_URL, which breaks every stored credential on '
      + 'any database restore or move. Generate one with: openssl rand -hex 32',
    );
  }
}

function getKey(): Buffer {
  assertCredentialsEncryptionConfig();
  // SHA-256 to guarantee 32 bytes regardless of input length
  return createHash('sha256').update(process.env['CREDENTIALS_ENCRYPTION_KEY']!).digest();
}

export function encrypt(plaintext: string): { encrypted: string; iv: string; authTag: string } {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag,
  };
}

export function decrypt(encrypted: string, ivHex: string, authTagHex: string): string {
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
