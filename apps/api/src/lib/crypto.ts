// ═══════════════════════════════════════════════════════════════════════
//  AES-256-GCM encryption for integration credentials
//
//  Encryption key is derived from CREDENTIALS_ENCRYPTION_KEY env var.
//  If not set, falls back to a deterministic key derived from DATABASE_URL
//  (acceptable for self-hosted single-tenant setups).
// ═══════════════════════════════════════════════════════════════════════

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM

function getKey(): Buffer {
  const explicit = process.env['CREDENTIALS_ENCRYPTION_KEY'];
  if (explicit) {
    // SHA-256 to guarantee 32 bytes regardless of input length
    return createHash('sha256').update(explicit).digest();
  }
  // Fallback: derive from DATABASE_URL
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) throw new Error('CREDENTIALS_ENCRYPTION_KEY or DATABASE_URL must be set');
  return createHash('sha256').update(`fueld-creds:${dbUrl}`).digest();
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
