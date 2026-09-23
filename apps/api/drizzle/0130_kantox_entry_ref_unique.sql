-- An entry ref identifies an entry at Kantox, for EVERY kind — not just INITIAL.
--
-- The INITIAL fence keys on (tenant, order, leg, ref) WHERE kind='INITIAL'. A
-- lifecycle close derives its ref from the parent (`...C1`, `...C2`) by counting
-- the children already on file, which is read from a snapshot: two closes racing
-- on one parent can both pick the same sequence, and Kantox rejects a repeated
-- ref at SEND time — after the row already exists, so the failure lands in the
-- retry loop instead of being prevented here.
--
-- Uniqueness per (order, ref) is the invariant the platform actually enforces, so
-- state it in the database and let the second insert fail fast.
--
-- Existing rows: every ref on file is unique per order (the #S<n> suffix and the
-- C<n>/A<n>/R<n> suffixes are per parent), so this cannot fail on live data.
DROP INDEX IF EXISTS kantox_hedge_entries_ref_uniq;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS kantox_hedge_entries_ref_uniq
  ON kantox_hedge_entries (tenant_id, order_id, entry_ref);
