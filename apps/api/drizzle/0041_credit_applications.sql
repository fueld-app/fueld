-- Credit Application workflow (trader → credit manager approval)

-- Enums
DO $$ BEGIN
  CREATE TYPE credit_application_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE credit_application_review_decision AS ENUM ('APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Credit Applications table
CREATE TABLE IF NOT EXISTS credit_applications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  type          credit_line_type NOT NULL,
  counterparty_id UUID NOT NULL REFERENCES counterparties(id),
  order_id      UUID REFERENCES orders(id) ON DELETE SET NULL,
  credit_line_id UUID REFERENCES credit_lines(id) ON DELETE SET NULL,
  requested_amount NUMERIC(14, 2) NOT NULL,
  requested_currency TEXT NOT NULL DEFAULT 'USD',
  requested_days INTEGER,
  reason        TEXT,
  status        credit_application_status NOT NULL DEFAULT 'PENDING',
  requested_by_user_id UUID NOT NULL REFERENCES users(id),
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_credit_applications_tenant   ON credit_applications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_credit_applications_status   ON credit_applications(status);
CREATE INDEX IF NOT EXISTS idx_credit_applications_counterparty ON credit_applications(counterparty_id);
CREATE INDEX IF NOT EXISTS idx_credit_applications_requested_by ON credit_applications(requested_by_user_id);

-- Credit Application Reviews table
CREATE TABLE IF NOT EXISTS credit_application_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES credit_applications(id) ON DELETE CASCADE,
  reviewer_user_id UUID NOT NULL REFERENCES users(id),
  decision        credit_application_review_decision NOT NULL,
  comment         TEXT,
  decided_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_app_reviews_application ON credit_application_reviews(application_id);
CREATE INDEX IF NOT EXISTS idx_credit_app_reviews_reviewer ON credit_application_reviews(reviewer_user_id);
