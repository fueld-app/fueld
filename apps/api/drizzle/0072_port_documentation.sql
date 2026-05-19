-- ════════════════════════════════════════════════════════════════════
--  0072_port_documentation
--
--  Adds persistence for Port Documentation:
--    • gate list personnel managed by admins
--    • versioned static document assets (e.g. Flange Worksheet)
--    • order-level generated/included port document records
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS port_gate_list_personnel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  place_id uuid REFERENCES places(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  role_title text NOT NULL,
  company text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  deactivated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS port_gate_list_personnel_tenant_active_idx
  ON port_gate_list_personnel (tenant_id, active);
CREATE INDEX IF NOT EXISTS port_gate_list_personnel_place_idx
  ON port_gate_list_personnel (place_id);

CREATE TABLE IF NOT EXISTS port_document_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_kind text NOT NULL,
  display_name text NOT NULL,
  original_file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text NOT NULL,
  file_size integer NOT NULL,
  sha256_hex text NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS port_document_assets_tenant_kind_idx
  ON port_document_assets (tenant_id, document_kind, is_current);

CREATE TABLE IF NOT EXISTS order_port_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  document_kind text NOT NULL,
  source_type text NOT NULL DEFAULT 'GENERATED',
  status text NOT NULL DEFAULT 'ACTIVE',
  asset_id uuid REFERENCES port_document_assets(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text NOT NULL,
  file_size integer NOT NULL,
  sha256_hex text NOT NULL,
  input_snapshot_json jsonb,
  data_snapshot_json jsonb,
  generated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  generated_at timestamptz,
  included_by uuid REFERENCES users(id) ON DELETE SET NULL,
  included_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_port_documents_order_idx
  ON order_port_documents (order_id, document_kind, status);
CREATE INDEX IF NOT EXISTS order_port_documents_asset_idx
  ON order_port_documents (asset_id);