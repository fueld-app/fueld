CREATE TYPE platts_report_status AS ENUM ('UPLOADED', 'PARSING', 'READY', 'FAILED', 'SUPERSEDED');
CREATE TYPE platts_report_family AS ENUM ('EUROPEAN_MARKETSCAN');
CREATE TYPE platts_section_type AS ENUM ('TRADES', 'BIDS', 'OFFERS', 'WITHDRAWALS', 'COMMENTARY', 'OTHER');

CREATE TABLE platts_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  family platts_report_family NOT NULL DEFAULT 'EUROPEAN_MARKETSCAN',
  publication_date date NOT NULL,
  title text NOT NULL,
  source_file_name text NOT NULL,
  source_file_path text NOT NULL,
  source_mime_type text NOT NULL DEFAULT 'application/pdf',
  source_file_size integer NOT NULL,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status platts_report_status NOT NULL DEFAULT 'UPLOADED',
  parser_version text,
  parse_error text,
  commentary jsonb DEFAULT '[]'::jsonb,
  is_canonical boolean NOT NULL DEFAULT false,
  superseded_by_report_id uuid,
  parsed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE platts_reports
  ADD CONSTRAINT platts_reports_superseded_by_fk
  FOREIGN KEY (superseded_by_report_id) REFERENCES platts_reports(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX platts_reports_one_canonical_per_day_idx
  ON platts_reports (tenant_id, family, publication_date)
  WHERE is_canonical = true;

CREATE INDEX platts_reports_lookup_idx
  ON platts_reports (tenant_id, family, publication_date DESC, created_at DESC);

CREATE TABLE platts_report_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES platts_reports(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  type platts_section_type NOT NULL DEFAULT 'OTHER',
  heading text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX platts_report_sections_report_idx
  ON platts_report_sections (report_id, sort_order);

CREATE TABLE platts_report_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES platts_reports(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES platts_report_sections(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  raw_text text NOT NULL,
  entry_kind text,
  market_region text,
  market_basis text,
  instrument text,
  product text,
  window_label text,
  company text,
  counterparty text,
  action text,
  price_raw text,
  price_value double precision,
  price_unit text,
  quantity_raw text,
  quantity_value double precision,
  quantity_unit text,
  timestamp_text text,
  confidence double precision,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX platts_report_entries_report_idx
  ON platts_report_entries (report_id, section_id, sort_order);

CREATE INDEX platts_report_entries_lookup_idx
  ON platts_report_entries (company, action, product, instrument);

CREATE TABLE platts_report_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES platts_reports(id) ON DELETE CASCADE,
  import_mode text NOT NULL DEFAULT 'single',
  import_batch_id text,
  sha256_hex text NOT NULL,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX platts_report_imports_report_idx
  ON platts_report_imports (report_id, created_at DESC);