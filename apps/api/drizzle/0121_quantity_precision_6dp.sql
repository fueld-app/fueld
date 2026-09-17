-- Increase quantity decimal precision from 3 to 6 decimal places.
-- Traders need sub-milligram precision on bunker quantities (e.g. 134.53292 MT)
-- to match nomination numbers exactly. The old numeric(12,3) silently rounded
-- 134.53292 → 134.533 on every autosave, so any field change that triggered
-- a save (including supplier credit days) appeared to "change the qty".

-- order_items
ALTER TABLE order_items ALTER COLUMN quantity TYPE numeric(14, 6);
ALTER TABLE order_items ALTER COLUMN quantity_min TYPE numeric(14, 6);
ALTER TABLE order_items ALTER COLUMN quantity_max TYPE numeric(14, 6);
ALTER TABLE order_items ALTER COLUMN delivered_quantity TYPE numeric(14, 6);

-- inventory_movements
ALTER TABLE inventory_movements ALTER COLUMN quantity TYPE numeric(14, 6);

-- inventory_reservations
ALTER TABLE inventory_reservations ALTER COLUMN quantity TYPE numeric(14, 6);

-- inventory_replenishment_plans
ALTER TABLE inventory_replenishment_plans ALTER COLUMN quantity TYPE numeric(14, 6);