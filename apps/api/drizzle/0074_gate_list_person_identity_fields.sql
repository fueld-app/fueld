ALTER TABLE port_gate_list_personnel
  ADD COLUMN IF NOT EXISTS driver_license_state text,
  ADD COLUMN IF NOT EXISTS driver_license_number text,
  ADD COLUMN IF NOT EXISTS twic_holder boolean NOT NULL DEFAULT false;