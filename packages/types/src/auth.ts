// ─── Auth-specific type contracts ────────────────────────────────────

/** The shape of the JWT payload used across the platform. */
export interface JwtTokenPayload {
  sub: string;
  email: string;
  role: string;
  /** Present and set to 'true' when 2FA verification is still pending. */
  pending2fa?: string;
}

/** Auth method used for login. */
export type AuthMethod = 'password' | 'o365';
