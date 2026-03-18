ALTER TABLE "order_items"
  ADD COLUMN "cost_platts_entry_id" uuid,
  ADD COLUMN "sales_platts_entry_id" uuid;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_cost_platts_entry_id_platts_report_entries_id_fk"
    FOREIGN KEY ("cost_platts_entry_id")
    REFERENCES "platts_report_entries"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_sales_platts_entry_id_platts_report_entries_id_fk"
    FOREIGN KEY ("sales_platts_entry_id")
    REFERENCES "platts_report_entries"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX IF NOT EXISTS "order_items_cost_platts_entry_id_idx"
  ON "order_items" ("cost_platts_entry_id");

CREATE INDEX IF NOT EXISTS "order_items_sales_platts_entry_id_idx"
  ON "order_items" ("sales_platts_entry_id");