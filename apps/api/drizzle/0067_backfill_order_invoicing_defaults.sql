WITH default_own_company AS (
  SELECT DISTINCT ON (c.tenant_id)
    c.tenant_id,
    c.id AS counterparty_id
  FROM counterparties c
  WHERE c.is_own_company = true
  ORDER BY c.tenant_id, c.name ASC, c.id ASC
),
default_bank_account AS (
  SELECT DISTINCT ON (ba.counterparty_id)
    ba.counterparty_id,
    ba.id AS bank_account_id
  FROM bank_accounts ba
  ORDER BY ba.counterparty_id, ba.is_default DESC, ba.label ASC, ba.id ASC
),
order_backfill AS (
  SELECT
    o.id,
    COALESCE(o.invoicing_company_id, doc.counterparty_id) AS resolved_invoicing_company_id,
    CASE
      WHEN existing_ba.id IS NOT NULL THEN o.bank_account_id
      ELSE fallback_ba.bank_account_id
    END AS resolved_bank_account_id
  FROM orders o
  JOIN default_own_company doc
    ON doc.tenant_id = o.tenant_id
  LEFT JOIN bank_accounts existing_ba
    ON existing_ba.id = o.bank_account_id
    AND existing_ba.counterparty_id = COALESCE(o.invoicing_company_id, doc.counterparty_id)
  LEFT JOIN default_bank_account fallback_ba
    ON fallback_ba.counterparty_id = COALESCE(o.invoicing_company_id, doc.counterparty_id)
  WHERE
    o.invoicing_company_id IS NULL
    OR o.bank_account_id IS NULL
    OR existing_ba.id IS NULL
)
UPDATE orders o
SET
  invoicing_company_id = order_backfill.resolved_invoicing_company_id,
  bank_account_id = order_backfill.resolved_bank_account_id,
  updated_at = now()
FROM order_backfill
WHERE o.id = order_backfill.id;