CREATE TABLE order_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES counterparties(id),
  contact_id uuid REFERENCES company_contacts(id) ON DELETE SET NULL,
  payment_term_type payment_term_type,
  credit_days integer,
  note text,
  sort_order integer NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX order_suppliers_order_id_idx ON order_suppliers(order_id);
--> statement-breakpoint
CREATE INDEX order_suppliers_company_id_idx ON order_suppliers(company_id);
--> statement-breakpoint
CREATE UNIQUE INDEX order_suppliers_one_primary_idx ON order_suppliers(order_id) WHERE is_primary = true;
--> statement-breakpoint
ALTER TABLE order_items ADD COLUMN order_supplier_id uuid REFERENCES order_suppliers(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX order_items_order_supplier_id_idx ON order_items(order_supplier_id);
--> statement-breakpoint
ALTER TABLE supplier_nominations ADD COLUMN order_supplier_id uuid REFERENCES order_suppliers(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX supplier_nominations_order_supplier_id_idx ON supplier_nominations(order_supplier_id);
--> statement-breakpoint
INSERT INTO order_suppliers (
  order_id,
  company_id,
  contact_id,
  payment_term_type,
  credit_days,
  note,
  sort_order,
  is_primary,
  delivered_at
)
SELECT
  o.id,
  o.supplier_id,
  o.supplier_contact_id,
  o.supplier_payment_term_type,
  o.supplier_credit_days,
  o.supplier_note,
  0,
  true,
  o.delivered_at
FROM orders o
WHERE o.supplier_id IS NOT NULL;
--> statement-breakpoint
UPDATE order_items oi
SET order_supplier_id = os.id
FROM order_suppliers os
WHERE os.order_id = oi.order_id
  AND os.is_primary = true
  AND oi.order_supplier_id IS NULL;
--> statement-breakpoint
UPDATE supplier_nominations sn
SET order_supplier_id = os.id
FROM order_suppliers os
WHERE sn.order_supplier_id IS NULL
  AND sn.order_id = os.order_id
  AND sn.supplier_id = os.company_id
  AND os.is_primary = true;