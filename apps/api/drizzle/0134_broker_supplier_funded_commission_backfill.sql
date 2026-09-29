-- Broker deals: move the negotiated commission from the customer side to the
-- supplier side.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- Moxie brokers bunker deals: the supplier invoices the customer directly and
-- Moxie's revenue is its commission. The model shipped with a single per-line
-- commission rate that was only ever understood as "what the customer pays".
--
-- Daniel (Moxie) clarified on 2026-09-29, for order 20260916-000132:
--
--   "Her er aftalt 19/mt - men de kommer fra supplier og ikke fra kunden"
--   (agreed at 19/MT - but they come from the supplier and not the customer)
--   followed by: "Thor Marine paying the whole 19"
--
-- So on these deals the negotiated commission is funded by the SUPPLIER and the
-- customer pays none of it. `commission_per_unit` now means the CUSTOMER-side
-- rate only, and the supplier side is the new `supplier_commission_per_unit`
-- (added in 0133). Lines written before 0133 therefore record a supplier-funded
-- rate in the customer column, which would have Moxie bill the customer for
-- commission the supplier is paying.
--
-- ── The rule, and the assumption it encodes ────────────────────────────────
-- Moxie's standing rate is exactly 3.00/MT and it is the tenant default, so a
-- line carrying anything OTHER than 3 is a negotiated rate — and every such
-- line on Moxie's books is supplier-funded. Verified against production before
-- writing this: 6 such lines, minimum rate 15.00, and NONE of them delivered or
-- invoiced, so no customer has been billed from them and there is no issued
-- invoice to unwind. (Zero commission orders exist at all: `orders.source_key`
-- is empty, so Create Commission Orders has never been run.)
--
-- ⚠️ This is a business assumption, not a derivable fact. If a future deal has
-- a genuine customer-side rate other than 3, this rule would mis-classify it —
-- which is why the operator guide now documents the three cases explicitly
-- (customer pays all / split / supplier pays all) and tells the trader to set
-- the customer rate to 0 for a supplier-funded line going forward. That is the
-- forward fix; this migration is the one-off correction of the rows written
-- before the column existed.
--
-- ── Safety ─────────────────────────────────────────────────────────────────
-- * Idempotent: `supplier_commission_per_unit IS NULL` means a second run (or a
--   row a trader has already filled in by hand) is left untouched.
-- * Only broker-deal lines, which only Moxie has enabled.
-- * Lines at exactly 3, and lines with no rate (NULL, which resolves to the
--   tenant default of 3), are untouched — that includes 236 lines, 191 of them
--   already delivered or invoiced, whose customer billing is correct as it
--   stands.
-- * Rollback — the pre-change values, captured from production before running:
--
--     update order_items set commission_per_unit = '76.0000000' where id = 'affe971b-ffd3-4bf2-ba2a-f45a076a91ac';  -- 20260815-000038 LSMGO
--     update order_items set commission_per_unit = '24.0000000' where id = '3dc6c894-2035-46ba-a89d-4c8526c77beb';  -- 20260915-000129 VLSFO
--     update order_items set commission_per_unit = '15.0000000' where id = '3288f092-6a06-4d31-86b9-d1a684c91631';  -- 20260915-000129 LSMGO
--     update order_items set commission_per_unit = '86.4200000' where id = '91698d66-da76-466b-aa35-c9a58a42577d';  -- 20260916-000130 LSMGO
--     update order_items set commission_per_unit = '19.0000000' where id = 'a90042fa-4cff-4f70-bd4f-8a92cb0c381c';  -- 20260916-000132 LSMGO
--     update order_items set commission_per_unit = '55.5000000' where id = '2d881930-b6ab-43f5-a7a7-934f05258d3c';  -- 20260917-000133 LSMGO
--
--     -- and, to undo this migration's other half:
--     update order_items set supplier_commission_per_unit = NULL
--     where id in ('affe971b-ffd3-4bf2-ba2a-f45a076a91ac','3dc6c894-2035-46ba-a89d-4c8526c77beb',
--                  '3288f092-6a06-4d31-86b9-d1a684c91631','91698d66-da76-466b-aa35-c9a58a42577d',
--                  'a90042fa-4cff-4f70-bd4f-8a92cb0c381c','2d881930-b6ab-43f5-a7a7-934f05258d3c');
--
-- ── Note on `commission_per_mt` (the ORDER-level rate) ─────────────────────
-- Deliberately NOT rewritten. That column stays 3.00 on every broker deal, so
-- the customer-side fallback still resolves to the standing rate and the
-- customer report still bills 3/MT wherever the per-line rate is absent. Moving
-- it would silently change the customer's number on the ~236 lines that are
-- correct today. Per-line rates take precedence over it, so setting the six
-- lines to 0 above is sufficient to stop the customer being billed.

UPDATE order_items i
SET supplier_commission_per_unit = i.commission_per_unit,
    commission_per_unit = 0
FROM orders o
WHERE o.id = i.order_id
  AND o.is_broker_deal
  AND i.commission_per_unit IS NOT NULL
  AND i.commission_per_unit <> 3
  AND i.supplier_commission_per_unit IS NULL;
