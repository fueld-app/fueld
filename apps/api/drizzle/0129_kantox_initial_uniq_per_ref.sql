-- One INITIAL hedge entry per (order, leg) becomes one per (order, leg, REF).
--
-- Split payment terms hedge one SELL entry per tranche (so the exposure is dated
-- per instalment). Every one of those entries carries leg='SO', so the old key
-- — (tenant_id, order_id, leg) WHERE kind='INITIAL' — rejects the second and
-- every later tranche. The insert path treats a duplicate key as "already
-- claimed" and returns BEFORE submitting, so those tranches would have gone
-- unhedged with only a console line to show for it.
--
-- The ref is unique per entry by construction (the #S<n> suffix, or the base
-- ref for a single-entry order), so including it in the key restores the
-- intent — catching an accidental double-push of the SAME entry — without
-- forbidding the additional tranches.
--
-- Existing rows: all pre-split orders have exactly one INITIAL entry per leg, so
-- they cannot violate the widened key.
DROP INDEX IF EXISTS kantox_hedge_entries_initial_uniq;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS kantox_hedge_entries_initial_uniq
  ON kantox_hedge_entries (tenant_id, order_id, leg, entry_ref)
  WHERE kind = 'INITIAL';
