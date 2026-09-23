-- Link a lifecycle entry to the entry it closes/amends.
--
-- A CANCEL/AMEND advances its parent's `cancelled_amount`. Today that bump only
-- happens in pushLifecycleEntry's success path, so a close that lands FAILED and
-- is later pushed to SENT by the sync loop marks the child SENT while the parent
-- never advances — Kantox has closed the exposure, Fueld still shows it open. The
-- reverse skew (double-count) is possible if the bump path is re-entered.
--
-- The sync loop cannot fix this by itself because the child row does not record
-- which entry it belongs to; the parent id is only passed in memory at push time.
-- Storing it lets the bump happen wherever the child reaches SENT.
--
-- Nullable: every existing row predates the column, and INITIAL entries have no
-- parent. Nothing backfills — a historical child's parent is not recoverable from
-- the row, and guessing from the ref suffix would be worse than leaving it null.
ALTER TABLE kantox_hedge_entries ADD COLUMN IF NOT EXISTS parent_entry_id uuid;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kantox_hedge_entries_parent_entry_id_fkey'
      AND conrelid = 'kantox_hedge_entries'::regclass
  ) THEN
    ALTER TABLE kantox_hedge_entries
      ADD CONSTRAINT kantox_hedge_entries_parent_entry_id_fkey
      FOREIGN KEY (parent_entry_id) REFERENCES kantox_hedge_entries(id) ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS kantox_hedge_entries_parent_entry_idx
  ON kantox_hedge_entries (parent_entry_id);
