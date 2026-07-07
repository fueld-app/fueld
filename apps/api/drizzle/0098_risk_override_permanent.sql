-- Allow permanent risk overrides (no expiry)
-- expiresAt NULL = permanent override (never expires)
ALTER TABLE risk_overrides ALTER COLUMN expires_at DROP NOT NULL;