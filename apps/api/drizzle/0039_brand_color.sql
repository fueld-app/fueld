-- Add brand_color column to counterparties (own companies)
-- Used as email header background color; defaults to white if not set
ALTER TABLE counterparties ADD COLUMN brand_color text;
