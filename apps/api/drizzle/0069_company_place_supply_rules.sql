CREATE TABLE company_place_supply_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
  country_iso text NOT NULL,
  place_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  contact_id uuid REFERENCES company_contacts(id) ON DELETE SET NULL,
  products jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  is_active boolean NOT NULL DEFAULT true,
  added_by_id uuid REFERENCES users(id),
  added_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX company_place_supply_rules_company_country_active_idx ON company_place_supply_rules(company_id, country_iso, is_active);
--> statement-breakpoint
CREATE INDEX company_place_supply_rules_country_active_idx ON company_place_supply_rules(country_iso, is_active);
--> statement-breakpoint
ALTER TABLE port_suppliers ADD COLUMN coverage_rule_id uuid REFERENCES company_place_supply_rules(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE port_suppliers ADD COLUMN coverage_source text NOT NULL DEFAULT 'manual';
--> statement-breakpoint
WITH ranked AS (
  SELECT
    ps.id,
    ps.place_id,
    ps.company_id,
    ps.contact_id,
    ps.note,
    ps.updated_at,
    ps.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY ps.place_id, ps.company_id
      ORDER BY ps.updated_at DESC NULLS LAST, ps.created_at DESC NULLS LAST, ps.id DESC
    ) AS rn
  FROM port_suppliers ps
),
merged AS (
  SELECT
    winner.id,
    winner.place_id,
    winner.company_id,
    (
      SELECT COALESCE(jsonb_agg(products.prod ORDER BY products.prod), '[]'::jsonb)
      FROM (
        SELECT DISTINCT prod
        FROM port_suppliers ps2
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(ps2.products, '[]'::jsonb)) AS prod
        WHERE ps2.place_id = winner.place_id
          AND ps2.company_id = winner.company_id
      ) AS products
    ) AS merged_products,
    COALESCE(
      winner.contact_id,
      (
        SELECT ps2.contact_id
        FROM port_suppliers ps2
        WHERE ps2.place_id = winner.place_id
          AND ps2.company_id = winner.company_id
          AND ps2.contact_id IS NOT NULL
        ORDER BY ps2.updated_at DESC NULLS LAST, ps2.created_at DESC NULLS LAST, ps2.id DESC
        LIMIT 1
      )
    ) AS merged_contact_id,
    COALESCE(
      NULLIF(BTRIM(winner.note), ''),
      (
        SELECT ps2.note
        FROM port_suppliers ps2
        WHERE ps2.place_id = winner.place_id
          AND ps2.company_id = winner.company_id
          AND NULLIF(BTRIM(ps2.note), '') IS NOT NULL
        ORDER BY ps2.updated_at DESC NULLS LAST, ps2.created_at DESC NULLS LAST, ps2.id DESC
        LIMIT 1
      )
    ) AS merged_note
  FROM ranked winner
  WHERE winner.rn = 1
)
UPDATE port_suppliers ps
SET
  products = merged.merged_products,
  contact_id = merged.merged_contact_id,
  note = merged.merged_note
FROM merged
WHERE ps.id = merged.id;
--> statement-breakpoint
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY place_id, company_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM port_suppliers
)
DELETE FROM port_suppliers ps
USING ranked
WHERE ps.id = ranked.id
  AND ranked.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX port_suppliers_place_company_unique_idx ON port_suppliers(place_id, company_id);
--> statement-breakpoint
CREATE INDEX port_suppliers_coverage_rule_id_idx ON port_suppliers(coverage_rule_id);