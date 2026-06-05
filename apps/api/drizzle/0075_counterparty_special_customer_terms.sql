-- ════════════════════════════════════════════════════════════════════
--  0075_counterparty_special_customer_terms
--
--  Adds per-customer terms override for order confirmations.
--  When a counterparty (customer) has special_customer_terms set,
--  it takes precedence over the invoicing company's default customerTerms
--  but is still overridden by order-level termsAndConditions.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE counterparties
  ADD COLUMN IF NOT EXISTS special_customer_terms text;
