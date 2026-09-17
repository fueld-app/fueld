-- Kantox Dynamic Hedging integration — hedge entry ledger.
--
-- One row per exposure entry pushed to (or intended for) Kantox. Two-leg
-- netting flow: one SELL entry per sales order (SO) + one BUY entry per
-- purchase order (PO) per deal, netted per value-date bucket by Kantox.
-- LEG column discriminates SO vs PO legs, so multiple INITIAL rows per
-- order are valid (the unique index is (tenant_id, order_id, leg) —
-- NOT per order alone; panel finding, 2026-09-17).
--
-- Cancellations = new row with negative amount, kind CANCEL, same
-- value_date as the original (Kantox nets per value-date bucket —
-- verified live in preprod 2026-09-17; dateless entries form their own
-- bucket and do NOT net against dated ones).
--
-- Rollback:
--   DROP TABLE IF EXISTS kantox_hedge_entries;
--   DROP TYPE IF EXISTS kantox_hedge_entry_status;
--   DROP TYPE IF EXISTS kantox_hedge_entry_kind;
--   DROP TYPE IF EXISTS kantox_hedge_direction;

DO $$ BEGIN
  CREATE TYPE kantox_hedge_entry_status AS ENUM (
    'PENDING_SEND', 'SENDING', 'SENT', 'HEDGED', 'CLOSED', 'FAILED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE kantox_hedge_entry_kind AS ENUM ('INITIAL', 'AMEND', 'CANCEL', 'REISSUE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE kantox_hedge_direction AS ENUM ('BUY', 'SELL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS kantox_hedge_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  order_item_id uuid REFERENCES order_items(id) ON DELETE SET NULL,
  order_supplier_id uuid REFERENCES order_suppliers(id) ON DELETE SET NULL,
  -- 'SO' (sales leg, SELL direction) or 'PO' (purchase leg, BUY direction);
  -- single-margin fallback flow uses 'SO' rows only.
  leg text NOT NULL DEFAULT 'SO',
  direction kantox_hedge_direction NOT NULL,
  amount numeric(14, 2) NOT NULL,
  -- gross exposure before marginHedgePercent scaling (audit basis)
  amount_basis numeric(14, 2),
  currency text NOT NULL DEFAULT 'USD',
  counter_currency text NOT NULL DEFAULT 'EUR',
  value_date date,
  entry_ref text NOT NULL,
  kantox_entry_id text,           -- Kantox `reference` (E-XXX)
  kantox_position_ref text,       -- Kantox `positionRef` (PS-XXX)
  kind kantox_hedge_entry_kind NOT NULL DEFAULT 'INITIAL',
  status kantox_hedge_entry_status NOT NULL DEFAULT 'PENDING_SEND',
  -- running total already cancelled for the parent entry — close logic
  -- sends only the delta (verified against live amountAfterCancellations)
  cancelled_amount numeric(14, 2) NOT NULL DEFAULT 0,
  entry_rate numeric(14, 8),
  entry_rate_pair text,           -- e.g. 'EURUSD' — mandatory when entry_rate set
  hedged_rate numeric(14, 8),     -- per-entry rate, null until Kantox executes
  execution_rate numeric(14, 8),
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kantox_hedge_entries_tenant_idx ON kantox_hedge_entries (tenant_id);
CREATE INDEX IF NOT EXISTS kantox_hedge_entries_order_idx ON kantox_hedge_entries (order_id);
CREATE INDEX IF NOT EXISTS kantox_hedge_entries_status_idx ON kantox_hedge_entries (tenant_id, status);

-- One INITIAL row per order+leg. AMEND/CANCEL/REISSUE are legitimately
-- multi-row. (entryRef scheme: {orderNumber}#{S|P{n}}[#A{n}|#C{n}|#R{n}] —
-- verified live in preprod: dedup on external_ref is ON, suffix refs net fine.)
CREATE UNIQUE INDEX IF NOT EXISTS kantox_hedge_entries_initial_uniq
  ON kantox_hedge_entries (tenant_id, order_id, leg) WHERE kind = 'INITIAL';