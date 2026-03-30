ALTER TYPE counterparty_type ADD VALUE IF NOT EXISTS 'BROKER';
ALTER TYPE counterparty_type ADD VALUE IF NOT EXISTS 'AGENT';

WITH normalized AS (
  SELECT
    id,
    CASE
      WHEN jsonb_typeof(COALESCE(settings -> 'companyTypes', 'null'::jsonb)) = 'array' THEN (
        SELECT to_jsonb(array_agg(value ORDER BY sort_order))
        FROM (
          SELECT value, MIN(sort_order) AS sort_order
          FROM (
            SELECT elem AS value, ord::int AS sort_order
            FROM jsonb_array_elements_text(settings -> 'companyTypes') WITH ORDINALITY AS existing(elem, ord)
            WHERE elem <> 'BARGE'

            UNION ALL

            SELECT 'BROKER' AS value, 1000 AS sort_order

            UNION ALL

            SELECT 'AGENT' AS value, 1001 AS sort_order
          ) merged
          GROUP BY value
        ) deduped
      )
      ELSE '["CLIENT", "SUPPLIER", "BROKER", "AGENT"]'::jsonb
    END AS company_types
  FROM tenants
)
UPDATE tenants AS t
SET
  settings = jsonb_set(COALESCE(t.settings, '{}'::jsonb), '{companyTypes}', normalized.company_types, true),
  updated_at = NOW()
FROM normalized
WHERE normalized.id = t.id;