-- Risk Monitoring — enums, tables, indexes

-- Enums
DO $$ BEGIN
  CREATE TYPE risk_provider_class AS ENUM ('WATCHLIST', 'MARITIME_CONTEXT', 'BUSINESS_DISTRESS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE risk_check_status AS ENUM ('CLEAR', 'HIT', 'ERROR', 'NO_COVERAGE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE risk_hit_severity AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE risk_override_status AS ENUM ('PENDING', 'APPROVED', 'EXPIRED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- Add Companies House number to counterparties
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS companies_house_number TEXT;
--> statement-breakpoint

-- Risk Checks — one row per provider check per company
CREATE TABLE IF NOT EXISTS risk_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  counterparty_id UUID NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
  provider_class  risk_provider_class NOT NULL,
  provider_name   TEXT NOT NULL,
  status          risk_check_status NOT NULL,
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_response    JSONB,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_risk_checks_tenant ON risk_checks(tenant_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_risk_checks_counterparty ON risk_checks(counterparty_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_risk_checks_status ON risk_checks(status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_risk_checks_checked_at ON risk_checks(checked_at);
--> statement-breakpoint

-- Risk Hits — individual signals found during a check
CREATE TABLE IF NOT EXISTS risk_hits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_check_id     UUID NOT NULL REFERENCES risk_checks(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  counterparty_id   UUID NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
  provider_class    risk_provider_class NOT NULL,
  severity          risk_hit_severity NOT NULL,
  signal_type       TEXT NOT NULL,
  title             TEXT NOT NULL,
  detail            TEXT,
  source_url        TEXT,
  match_score       DOUBLE PRECISION,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  resolved_at       TIMESTAMPTZ,
  resolved_by_user_id UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_risk_hits_counterparty ON risk_hits(counterparty_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_risk_hits_active ON risk_hits(is_active) WHERE is_active = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_risk_hits_signal_type ON risk_hits(signal_type);
--> statement-breakpoint

-- Risk Overrides — time-limited credit un-freeze
CREATE TABLE IF NOT EXISTS risk_overrides (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  counterparty_id       UUID NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
  status                risk_override_status NOT NULL DEFAULT 'PENDING',
  reason                TEXT NOT NULL,
  expires_at            TIMESTAMPTZ NOT NULL,
  requested_by_user_id  UUID NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_risk_overrides_counterparty ON risk_overrides(counterparty_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_risk_overrides_status ON risk_overrides(status);
--> statement-breakpoint

-- Risk Override Approvals — 2-person approval workflow
CREATE TABLE IF NOT EXISTS risk_override_approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  override_id UUID NOT NULL REFERENCES risk_overrides(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  decision    TEXT NOT NULL,
  comment     TEXT,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_risk_override_approvals_override ON risk_override_approvals(override_id);
