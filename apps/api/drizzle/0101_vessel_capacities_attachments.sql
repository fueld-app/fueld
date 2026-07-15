-- Vessel capacities (per-product) and vessel attachments

CREATE TABLE vessel_capacities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL,
  capacity NUMERIC(12, 3),
  unit TEXT NOT NULL DEFAULT 'MT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(vessel_id, product_type)
);

CREATE TABLE vessel_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);