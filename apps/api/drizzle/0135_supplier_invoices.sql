-- Supplier invoices: Moxie invoicing a SUPPLIER for commission the supplier funds.
--
-- ── Why a separate table, not a payer on `invoices` ────────────────────────
-- `invoices` is the customer receivable ledger: it is keyed only by `order_id`
-- and has NO party column, so every reader infers the payer from
-- `orders.client_id`:
--
--   dashboard.service.ts   collections widget
--   reports.service.ts     invoice ageing
--   company.service.ts     outstanding balance
--   quickbooks.service.ts  QuickBooks *Customer* (there is no vendor path)
--
-- Adding a nullable payer to `invoices` would mean auditing and correcting all
-- four, and would still leave one number series shared between money owed to us
-- and money owed by us. Instead the supplier side is its own table with its own
-- series: supplier receivables are invisible to the customer readers by
-- construction, not by a filter someone can forget. That is the whole point of
-- the split — a customer statement and a supplier statement must never be able
-- to contaminate each other.
--
-- ── What the invoice is ────────────────────────────────────────────────────
-- On a broker deal the supplier invoices the customer directly and Moxie's
-- revenue is its commission. Daniel (Moxie) confirmed 2026-09-29 that when the
-- negotiated rate is above the standing $3/MT it is funded by the SUPPLIER
-- ("Thor Marine paying the whole 19"). The supplier therefore owes Moxie that
-- commission, and Moxie needs to bill for it.
--
-- ── The snapshot is the document ───────────────────────────────────────────
-- `supplier_invoice_lines` stores the order, customer, vessel, place, product,
-- quantity, rate and amount as VALUES, captured once at issue. It deliberately
-- does NOT join back to `orders`/`order_items` to render. An issued invoice is a
-- frozen artifact: renaming a counterparty, editing a rate, or delivering the
-- order must not silently restate a document the supplier already holds. This
-- mirrors the `document_revisions` principle on the customer side, and it is why
-- the party names are denormalised text rather than foreign keys.

CREATE TYPE supplier_invoice_status AS ENUM (
  'DRAFT',
  'SENT',
  'OVERDUE',
  'PARTIALLY_PAID',
  'PAID',
  'VOID'
);

CREATE TABLE supplier_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- The party being billed. Kept as a real FK for querying; the NAME that
  -- prints on the document is snapshotted on the lines' parent below.
  supplier_id uuid NOT NULL REFERENCES counterparties(id),
  supplier_name text NOT NULL,
  -- Tenant-scoped, NOT globally unique. Numbers are allocated from a per-tenant
  -- sequence with a per-tenant template, so two tenants on the default template
  -- would both mint `SINV-2026-0001` and the second insert would fail on a global
  -- constraint. The uniqueness that matters is "unique within the books that
  -- issued it".
  invoice_number text NOT NULL,
  status supplier_invoice_status NOT NULL DEFAULT 'DRAFT',

  -- The commission period this statement covers.
  period_from date NOT NULL,
  period_to date NOT NULL,

  currency text NOT NULL,
  -- Total billed, and how much of it has come back. Both frozen/derived in
  -- cents so the document foots.
  amount numeric(14, 2) NOT NULL DEFAULT 0,
  amount_received numeric(14, 2) NOT NULL DEFAULT 0,
  due_date date NOT NULL,

  -- Who is issuing (Moxie) and where to remit. Resolved at issue and stored, so
  -- changing the default bank account later does not rewrite an issued invoice.
  invoicing_company_id uuid REFERENCES counterparties(id),
  invoicing_company_name text,
  bank_account_id uuid REFERENCES bank_accounts(id),
  -- Structured, NOT a delimited string. The PDF resolved remittance fields by
  -- position in a newline-joined blob, so a missing bank name or SWIFT code
  -- shifted every field and printed the wrong one against the wrong label.
  bank_details jsonb,

  note text,
  issued_at timestamp with time zone,
  voided_at timestamp with time zone,

  -- Idempotency key: `<tenant>:supplier-invoice:<from>:<to>:<supplierId>`.
  -- The partial unique index below is what makes "bill this period" safe to
  -- repeat — the same guarantee `orders.source_key` gives commission orders.
  source_key text,

  created_by uuid REFERENCES users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- A PLAIN unique index, not a partial one (`WHERE source_key IS NOT NULL`).
-- `ON CONFLICT` can only infer a partial index when the statement repeats the
-- predicate, and Drizzle's `onConflictDoNothing` drops `targetWhere`, emitting
-- `on conflict ("source_key")` — which fails against a partial index with
-- "no unique or exclusion constraint matching the ON CONFLICT specification"
-- (42P10). Postgres treats NULLs as distinct in a unique index anyway, so every
-- human-created invoice (source_key NULL) is unconstrained regardless and the
-- partial predicate buys nothing. Same reasoning as 0132_order_source_key.
CREATE UNIQUE INDEX supplier_invoices_source_key_unique
  ON supplier_invoices (source_key);

-- Replaces the global UNIQUE on invoice_number: see the column comment.
CREATE UNIQUE INDEX supplier_invoices_tenant_number_unique
  ON supplier_invoices (tenant_id, invoice_number);

CREATE INDEX supplier_invoices_tenant_supplier_idx
  ON supplier_invoices (tenant_id, supplier_id);

-- One row per commissioned line, captured at issue. All descriptive fields are
-- TEXT on purpose (see the header note).
CREATE TABLE supplier_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  -- Kept for traceability only; ON DELETE SET NULL so pruning an old order can
  -- never delete or alter a billed line.
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  order_number text,
  customer_name text,
  vessel_name text,
  place_name text,
  product_type text,
  quantity numeric(14, 6),
  unit text,
  rate numeric(14, 7),
  amount numeric(14, 2) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX supplier_invoice_lines_invoice_idx
  ON supplier_invoice_lines (supplier_invoice_id);

-- Its own number series. Sharing `invoice_number_sequences` would interleave the
-- customer and supplier series, so a gap or a duplicate in one would look like a
-- problem in the other.
CREATE TABLE supplier_invoice_number_sequences (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Money received FROM a supplier settles a supplier invoice. The existing
-- `supplier_payments.invoice_id` points at `invoices` (the customer ledger) and
-- is never written today; that column is left alone and this is the link that
-- actually means "this receipt settles this supplier invoice".
ALTER TABLE supplier_payments
  ADD COLUMN supplier_invoice_id uuid REFERENCES supplier_invoices(id) ON DELETE SET NULL;

CREATE INDEX supplier_payments_supplier_invoice_idx
  ON supplier_payments (supplier_invoice_id);
