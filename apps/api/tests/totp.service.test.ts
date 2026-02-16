import { describe, expect, test } from 'bun:test';
import * as OTPAuth from 'otpauth';
import { generateQrDataUrl, generateTotpSecret, verifyTotpToken } from '../src/modules/auth/totp.service';

describe('totp.service', () => {
  test('generateTotpSecret returns base32 secret and otpauth uri', () => {
    const email = 'user@example.com';
    const result = generateTotpSecret(email);

    expect(result.secret.length).toBeGreaterThanOrEqual(32);
    expect(result.uri.startsWith('otpauth://totp/')).toBe(true);
    expect(result.uri).toContain(encodeURIComponent(email));
    expect(result.uri).toContain('issuer=Fueld');
  });

  test('verifyTotpToken accepts valid token', () => {
    const { secret } = generateTotpSecret('valid@example.com');

    const totp = new OTPAuth.TOTP({
      issuer: 'Fueld',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    const token = totp.generate();
    expect(verifyTotpToken(token, secret)).toBe(true);
  });

  test('verifyTotpToken rejects invalid token', () => {
    const { secret } = generateTotpSecret('invalid@example.com');
    expect(verifyTotpToken('000000', secret)).toBe(false);
  });

  test('generateQrDataUrl returns PNG data URI', async () => {
    const { uri } = generateTotpSecret('qr@example.com');
    const dataUrl = await generateQrDataUrl(uri);

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(dataUrl.length).toBeGreaterThan(100);
  });
});
