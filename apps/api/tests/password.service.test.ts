import { describe, expect, test } from 'bun:test';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.service';

describe('password.service', () => {
  test('hashPassword produces an Argon2id hash and verify succeeds', async () => {
    const plain = 'CorrectHorseBatteryStaple!123';
    const hash = await hashPassword(plain);

    expect(hash.length).toBeGreaterThan(20);
    expect(hash.startsWith('$argon2id$')).toBe(true);

    const ok = await verifyPassword(plain, hash);
    expect(ok).toBe(true);
  });

  test('verifyPassword returns false for wrong password', async () => {
    const hash = await hashPassword('right-password');
    const ok = await verifyPassword('wrong-password', hash);
    expect(ok).toBe(false);
  });

  test('same password creates different hashes because of random salt', async () => {
    const plain = 'same-input';
    const hashA = await hashPassword(plain);
    const hashB = await hashPassword(plain);

    expect(hashA).not.toBe(hashB);
    expect(await verifyPassword(plain, hashA)).toBe(true);
    expect(await verifyPassword(plain, hashB)).toBe(true);
  });
});
