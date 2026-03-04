-- Store encrypted Microsoft refresh tokens per user for server-side
-- Graph API access (Authorization Code Flow with confidential client).
ALTER TABLE "users"
  ADD COLUMN "microsoft_refresh_token" text,
  ADD COLUMN "microsoft_refresh_token_iv" text,
  ADD COLUMN "microsoft_refresh_token_auth_tag" text;
