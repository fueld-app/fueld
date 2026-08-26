-- Per-user Enable Banking credentials for self-service onboarding
-- Each user gets their own Enable Banking account and app

CREATE TABLE IF NOT EXISTS enable_banking_user_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  eb_user_id text NOT NULL,
  eb_email text NOT NULL,
  id_token_encrypted text NOT NULL,
  id_token_iv text NOT NULL,
  id_token_auth_tag text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  refresh_token_iv text NOT NULL,
  refresh_token_auth_tag text NOT NULL,
  app_id text NOT NULL,
  private_key_encrypted text NOT NULL,
  private_key_iv text NOT NULL,
  private_key_auth_tag text NOT NULL,
  certificate_pem text NOT NULL,
  environment text NOT NULL DEFAULT 'production',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_eb_user_creds_tenant ON enable_banking_user_credentials(tenant_id);
CREATE INDEX IF NOT EXISTS idx_eb_user_creds_user ON enable_banking_user_credentials(user_id);

-- Pending auth states for email-link sign-in flow
CREATE TABLE IF NOT EXISTS enable_banking_auth_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eb_auth_pending_user ON enable_banking_auth_pending(user_id);

-- Add user_id to bank_connections so we know which user's credentials to use for syncing
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id);