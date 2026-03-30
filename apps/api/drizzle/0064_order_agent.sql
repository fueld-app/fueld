ALTER TABLE orders ADD COLUMN agent_id uuid REFERENCES counterparties(id);
ALTER TABLE orders ADD COLUMN agent_contact_id uuid REFERENCES company_contacts(id) ON DELETE SET NULL;