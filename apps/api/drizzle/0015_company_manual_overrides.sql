ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS manual_overrides jsonb DEFAULT '[]';
