-- ════════════════════════════════════════════════════════════════════
--  0071_inventory_physical_ops
--
--  Adds inventory management for physical operations:
--    • OPERATIONSMANAGER role
--    • physical_ops_enabled flag on counterparties
--    • order_kind enum + column on orders
--    • inventory_sku_id, warehouse_id, planned_inventory_at on order_items
--    • inventory_skus, warehouses, inventory_movements,
--      inventory_reservations, inventory_replenishment_plans
--    • order_transfers (1:1 with internal-transfer orders)
--    • order_transfer_sides (per-side commercial/finance state)
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Role enum ────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'role' AND e.enumlabel = 'OPERATIONSMANAGER'
  ) THEN
    ALTER TYPE "role" ADD VALUE 'OPERATIONSMANAGER';
  END IF;
END$$;

-- ── 2. New enums ────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "order_kind" AS ENUM ('EXTERNAL', 'INTERNAL_TRANSFER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "warehouse_type" AS ENUM ('VESSEL', 'TERMINAL', 'SHORE_TANK', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "inventory_movement_type" AS ENUM (
    'INBOUND_DELIVERY',
    'OUTBOUND_DELIVERY',
    'TRANSFER_OUT',
    'TRANSFER_IN',
    'ADJUSTMENT',
    'OPENING_BALANCE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "replenishment_status" AS ENUM ('PLANNED', 'LINKED', 'COMPLETED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "transfer_side_status" AS ENUM ('DRAFT', 'FINALIZED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "transfer_side_kind" AS ENUM ('SOURCE_SELL', 'DESTINATION_BUY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── 3. Counterparties: physical_ops_enabled flag ────────────────────
ALTER TABLE counterparties
  ADD COLUMN IF NOT EXISTS physical_ops_enabled boolean NOT NULL DEFAULT false;

-- ── 4. Orders: order_kind ───────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_kind "order_kind" NOT NULL DEFAULT 'EXTERNAL';

-- ── 5. Order items: inventory linkage ───────────────────────────────
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS inventory_sku_id uuid,
  ADD COLUMN IF NOT EXISTS warehouse_id uuid,
  ADD COLUMN IF NOT EXISTS planned_inventory_at timestamptz;

-- ── 6. Inventory SKUs ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_type product_type NOT NULL,
  grade text,
  display_name text NOT NULL,
  base_unit text NOT NULL DEFAULT 'MT',
  inventory_tracked boolean NOT NULL DEFAULT true,
  allowed_units jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_skus_tenant_product_grade_idx
  ON inventory_skus (tenant_id, product_type, grade);

-- ── 7. Warehouses ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_company_id uuid NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
  name text NOT NULL,
  type warehouse_type NOT NULL DEFAULT 'VESSEL',
  vessel_id uuid REFERENCES vessels(id) ON DELETE SET NULL,
  place_id uuid REFERENCES places(id) ON DELETE SET NULL,
  inventory_enabled boolean NOT NULL DEFAULT false,
  allow_manual_replenishment boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS warehouses_owner_active_idx
  ON warehouses (owner_company_id, active);
CREATE INDEX IF NOT EXISTS warehouses_vessel_idx
  ON warehouses (vessel_id);

-- Wire order_items inventory FKs (after warehouses + inventory_skus exist).
ALTER TABLE order_items
  ADD CONSTRAINT order_items_inventory_sku_id_fk
    FOREIGN KEY (inventory_sku_id) REFERENCES inventory_skus(id) ON DELETE SET NULL;
ALTER TABLE order_items
  ADD CONSTRAINT order_items_warehouse_id_fk
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL;

-- ── 8. Inventory movements (immutable ledger) ───────────────────────
CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES inventory_skus(id) ON DELETE RESTRICT,
  quantity numeric(14, 3) NOT NULL,
  unit text NOT NULL DEFAULT 'MT',
  movement_type inventory_movement_type NOT NULL,
  occurred_at timestamptz NOT NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  order_item_id uuid REFERENCES order_items(id) ON DELETE SET NULL,
  replenishment_plan_id uuid,
  note text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_movements_warehouse_sku_occurred_idx
  ON inventory_movements (warehouse_id, sku_id, occurred_at);
CREATE INDEX IF NOT EXISTS inventory_movements_order_item_idx
  ON inventory_movements (order_item_id);

-- ── 9. Inventory reservations ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES inventory_skus(id) ON DELETE RESTRICT,
  quantity numeric(14, 3) NOT NULL,
  unit text NOT NULL DEFAULT 'MT',
  reserved_for timestamptz NOT NULL,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  direction text NOT NULL DEFAULT 'OUTBOUND',
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_reservations_order_item_idx
  ON inventory_reservations (order_item_id);
CREATE INDEX IF NOT EXISTS inventory_reservations_warehouse_sku_idx
  ON inventory_reservations (warehouse_id, sku_id);

-- ── 10. Replenishment plans ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_replenishment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES inventory_skus(id) ON DELETE RESTRICT,
  quantity numeric(14, 3) NOT NULL,
  unit text NOT NULL DEFAULT 'MT',
  expected_at timestamptz NOT NULL,
  status replenishment_status NOT NULL DEFAULT 'PLANNED',
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  note text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_replenishment_warehouse_sku_status_idx
  ON inventory_replenishment_plans (warehouse_id, sku_id, status);

-- Wire inventory_movements.replenishment_plan_id FK now that the table exists.
ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_replenishment_plan_id_fk
    FOREIGN KEY (replenishment_plan_id) REFERENCES inventory_replenishment_plans(id)
    ON DELETE SET NULL;

-- ── 11. Order transfers (1:1 with INTERNAL_TRANSFER orders) ─────────
CREATE TABLE IF NOT EXISTS order_transfers (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  source_company_id uuid NOT NULL REFERENCES counterparties(id),
  destination_company_id uuid NOT NULL REFERENCES counterparties(id),
  source_warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  destination_warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  planned_arrival_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── 12. Order transfer sides (per-side commercial/finance state) ────
CREATE TABLE IF NOT EXISTS order_transfer_sides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind transfer_side_kind NOT NULL,
  status transfer_side_status NOT NULL DEFAULT 'DRAFT',
  company_id uuid NOT NULL REFERENCES counterparties(id),
  invoicing_company_id uuid REFERENCES counterparties(id),
  bank_account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  payment_term_type payment_term_type,
  credit_days integer,
  currency text NOT NULL DEFAULT 'USD',
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  finalized_at timestamptz,
  finalized_by uuid REFERENCES users(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS order_transfer_sides_order_kind_idx
  ON order_transfer_sides (order_id, kind);
