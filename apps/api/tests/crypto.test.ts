import { afterEach, describe, expect, test } from 'bun:test';
import { decrypt, encrypt } from '../src/lib/crypto';

const ORIGINAL_ENV = {
  CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY,
  DATABASE_URL: process.env.DATABASE_URL,
};

afterEach(() => {
  if (ORIGINAL_ENV.CREDENTIALS_ENCRYPTION_KEY === undefined) {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  } else {
    process.env.CREDENTIALS_ENCRYPTION_KEY = ORIGINAL_ENV.CREDENTIALS_ENCRYPTION_KEY;
  }

  if (ORIGINAL_ENV.DATABASE_URL === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = ORIGINAL_ENV.DATABASE_URL;
  }
});

describe('crypto lib', () => {
  test('encrypt/decrypt roundtrip works with explicit key', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'unit-test-key';
    delete process.env.DATABASE_URL;

    const plaintext = 'sensitive-value-123';
    const payload = encrypt(plaintext);

    expect(payload.encrypted).not.toBe(plaintext);
    expect(payload.iv).toHaveLength(24);
    expect(payload.authTag).toHaveLength(32);

    const decrypted = decrypt(payload.encrypted, payload.iv, payload.authTag);
    expect(decrypted).toBe(plaintext);
  });

  test('fallback key derived from DATABASE_URL works', () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/fueld_test';

    const plaintext = 'fallback-secret';
    const payload = encrypt(plaintext);
    const decrypted = decrypt(payload.encrypted, payload.iv, payload.authTag);

    expect(decrypted).toBe(plaintext);
  });

  test('throws when both key sources are missing', () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    delete process.env.DATABASE_URL;

    expect(() => encrypt('x')).toThrow('CREDENTIALS_ENCRYPTION_KEY or DATABASE_URL must be set');
  });

  test('decrypt fails with tampered authTag', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'unit-test-key';

    const payload = encrypt('hello');
    const tamperedTag = `${payload.authTag.slice(0, -1)}${payload.authTag.endsWith('0') ? '1' : '0'}`;

    expect(() => decrypt(payload.encrypted, payload.iv, tamperedTag)).toThrow();
  });
});
