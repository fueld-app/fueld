import { afterEach, describe, expect, test } from 'bun:test';
import { assertCredentialsEncryptionConfig, decrypt, encrypt } from '../src/lib/crypto';

const ORIGINAL_ENV = {
  CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY,
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: process.env.NODE_ENV,
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

  if (ORIGINAL_ENV.NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
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

  test('requires the key even when DATABASE_URL is present but no key is set', () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/fueld_test';

    expect(() => encrypt('fallback-secret')).toThrow(/CREDENTIALS_ENCRYPTION_KEY must be set/);
  });

  test('throws when the key is missing and DATABASE_URL is absent too', () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    delete process.env.DATABASE_URL;

    expect(() => encrypt('x')).toThrow(/CREDENTIALS_ENCRYPTION_KEY must be set/);
  });

  test('decrypt fails with tampered authTag', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'unit-test-key';

    const payload = encrypt('hello');
    const tamperedTag = `${payload.authTag.slice(0, -1)}${payload.authTag.endsWith('0') ? '1' : '0'}`;

    expect(() => decrypt(payload.encrypted, payload.iv, tamperedTag)).toThrow();
  });

  // Regression: the guard used to be gated on NODE_ENV === 'production', which
  // no deployed instance set — so it never fired and the app silently used a
  // DATABASE_URL-derived key. Riviera Marine ran that way until 2026-09-23 and
  // ended up with a credential it could not decrypt.
  test('requires the explicit key even when NODE_ENV is unset', () => {
    delete process.env.NODE_ENV;
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/fueld_test';

    expect(() => assertCredentialsEncryptionConfig()).toThrow(/CREDENTIALS_ENCRYPTION_KEY must be set/);
  });

  test('requires the explicit key regardless of NODE_ENV value', () => {
    for (const env of ['production', 'test', 'development', '']) {
      process.env.NODE_ENV = env;
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
      process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/fueld_test';
      expect(() => assertCredentialsEncryptionConfig()).toThrow(/CREDENTIALS_ENCRYPTION_KEY must be set/);
    }
  });

  test('no longer falls back to a DATABASE_URL-derived key', () => {
    delete process.env.NODE_ENV;
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/fueld_test';

    expect(() => encrypt('x')).toThrow(/CREDENTIALS_ENCRYPTION_KEY must be set/);
  });
});
