-- Enable Banking integration: bank connections, account balances, and transactions
-- Per-tenant, role-based access (ADMIN + FINANCE)

CREATE TABLE IF NOT EXISTS bank_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  aspsp_name text NOT NULL,
  aspsp_country text NOT NULL DEFAULT 'FR',
  session_id text,
  session_data jsonb,
  status text NOT NULL DEFAULT 'active',
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_account_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  iban text,
  account_name text,
  balance numeric(14, 2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  balance_type text,
  synced_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  transaction_id text NOT NULL,
  booking_date date,
  amount numeric(14, 2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  credit_debit_indicator text,
  debtor_name text,
  debtor_account_iban text,
  debtor_account_bban text,
  debtor_agent text,
  debtor_organisation_id text,
  creditor_name text,
  creditor_account_iban text,
  creditor_account_bban text,
  creditor_agent text,
  creditor_organisation_id text,
  remittance_info text,
  remittance_info_structured text,
  payment_reference text,
  bank_transaction_code text,
  bank_transaction_code_description text,
  balance_after_amount numeric(14, 2),
  balance_after_currency text,
  entry_reference text,
  reference_number text,
  reference_number_schema text,
  exchange_rate text,
  merchant_category_code text,
  note text,
  status text,
  transaction_date date,
  additional_info text,
  resource_id text,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(connection_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_bank_connections_tenant ON bank_connections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bank_account_balances_tenant ON bank_account_balances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_date ON bank_transactions(tenant_id, booking_date DESC);