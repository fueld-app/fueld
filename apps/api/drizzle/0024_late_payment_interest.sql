-- Add late payment interest rate column to counterparties (for own companies)
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS late_payment_interest text;
