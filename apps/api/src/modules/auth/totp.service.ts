import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

const ISSUER = 'Fueld';

// ─── TOTP 2FA Service ────────────────────────────────────────────────

/**
 * Generate a new TOTP secret and return the secret + provisioning URI.
 */
export function generateTotpSecret(email: string): {
  secret: string;
  uri: string;
} {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: new OTPAuth.Secret({ size: 20 }),
  });

  return {
    secret: totp.secret.base32,
    uri: totp.toString(),
  };
}

/**
 * Verify a TOTP token against a stored base32 secret.
 * Allows a ±1 window (30 s drift tolerance).
 */
export function verifyTotpToken(
  token: string,
  secret: string,
): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  // delta === null means invalid; otherwise it's the window offset
  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}

/**
 * Generate a QR-code data URL from a TOTP provisioning URI.
 */
export async function generateQrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri);
}
