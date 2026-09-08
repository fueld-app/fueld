-- Refresh-token rotation grace window:
-- Keep the previous refresh token hash (plus rotation timestamp) so that a
-- concurrent refresh using the just-rotated-away token is honoured for a
-- short grace window instead of revoking the session (multi-tab / parallel
-- request race → silent logout).
ALTER TABLE users ADD COLUMN IF NOT EXISTS previous_refresh_token text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS previous_refresh_token_at timestamptz;