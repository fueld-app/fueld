ALTER TABLE orders ADD COLUMN broker_id uuid REFERENCES counterparties(id);
ALTER TABLE orders ADD COLUMN broker_contact_id uuid REFERENCES company_contacts(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN broker_gets_all boolean NOT NULL DEFAULT false;
