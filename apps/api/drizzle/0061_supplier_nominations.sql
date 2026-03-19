CREATE TABLE supplier_nominations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES company_contacts(id) ON DELETE SET NULL,
  email text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'SENT',
  response_token_hash text,
  response_token_expires_at timestamptz,
  opened_at timestamptz,
  responded_at timestamptz,
  delivery_completed_confirmed boolean NOT NULL DEFAULT false,
  delivery_completed_at timestamptz,
  supplier_reference text,
  supplier_comment text,
  sent_by_user_id uuid REFERENCES users(id),
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX supplier_nominations_order_id_idx ON supplier_nominations(order_id);
--> statement-breakpoint
CREATE INDEX supplier_nominations_token_hash_idx ON supplier_nominations(response_token_hash);
--> statement-breakpoint
CREATE INDEX supplier_nominations_status_idx ON supplier_nominations(status);
--> statement-breakpoint
CREATE TABLE supplier_nomination_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_nomination_id uuid NOT NULL REFERENCES supplier_nominations(id) ON DELETE CASCADE,
  order_attachment_id uuid NOT NULL REFERENCES order_attachments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX supplier_nomination_attachments_nomination_id_idx ON supplier_nomination_attachments(supplier_nomination_id);
--> statement-breakpoint
CREATE INDEX supplier_nomination_attachments_attachment_id_idx ON supplier_nomination_attachments(order_attachment_id);