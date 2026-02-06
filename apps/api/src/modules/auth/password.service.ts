// ─── Password Hashing (Bun.password — Argon2id) ─────────────────────

/**
 * Hash a plaintext password using Argon2id via Bun's built-in API.
 * This is significantly faster than bcrypt and resistant to both
 * side-channel and GPU attacks.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return Bun.password.hash(plaintext, {
    algorithm: 'argon2id',
    memoryCost: 65_536, // 64 MB
    timeCost: 3,
  });
}

/**
 * Verify a plaintext password against an Argon2id hash.
 */
export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  return Bun.password.verify(plaintext, hash);
}
