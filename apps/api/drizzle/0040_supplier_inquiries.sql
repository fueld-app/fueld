-- Migration: supplier_inquiries
-- Tracks outbound inquiry emails sent to suppliers per order

CREATE TABLE IF NOT EXISTS supplier_inquiries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    supplier_id     UUID NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
    contact_id      UUID REFERENCES company_contacts(id) ON DELETE SET NULL,
    email           TEXT NOT NULL,
    subject         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'SENT',  -- 'SENT' | 'QUOTED' | 'DECLINED' | 'NO_REPLY'
    sent_by_user_id UUID REFERENCES users(id),
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One inquiry per supplier per order
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_inquiries_order_supplier
    ON supplier_inquiries(order_id, supplier_id);

CREATE INDEX IF NOT EXISTS idx_supplier_inquiries_order
    ON supplier_inquiries(order_id);
