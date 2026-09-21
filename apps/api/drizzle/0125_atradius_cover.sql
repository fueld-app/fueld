-- Atradius insurance cover (Riviera Marine) — tenant-gated feature.
-- Monthly Excel upload from the Atradius platform replaces previous data.
CREATE TABLE atradius_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  file_name text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE atradius_buyers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  import_id uuid NOT NULL REFERENCES atradius_imports(id),
  buyer_number text NOT NULL,
  buyer_name text NOT NULL,
  cover_amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  status_raw text NOT NULL,
  status_normalized text NOT NULL,          -- APPROVED | PARTIAL | REISSUED | REDUCED | MODIFIED | REFUSED | CANCELLED | FUTURE_CANCEL | NO_INCREASE | UNKNOWN
  is_active boolean NOT NULL DEFAULT false,
  decision_date date,
  end_date date,
  matched_counterparty_id uuid REFERENCES counterparties(id),
  match_source text,                        -- EXACT | MAPPING | MANUAL | null
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_atradius_buyers_tenant_cp ON atradius_buyers (tenant_id, matched_counterparty_id);
CREATE INDEX idx_atradius_buyers_tenant_buyer ON atradius_buyers (tenant_id, buyer_number);
CREATE INDEX idx_atradius_imports_tenant ON atradius_imports (tenant_id, created_at);
