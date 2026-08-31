-- Bunker Booking sent indicator (Moxie request).
-- Tracks whether a Bunker Booking email has been sent for an order:
--   NULL  = not sent (red)
--   set   = sent (green)
-- Set automatically when a BUNKER_BOOKING email is sent from the order,
-- or manually via the toggle endpoint (for bookings sent outside Fueld).

ALTER TABLE orders ADD COLUMN bunker_booking_sent_at timestamp with time zone;

--> statement-breakpoint

-- Backfill: orders that already have a BUNKER_BOOKING email in the log
-- get the timestamp of their most recent successful send.
UPDATE orders o
SET bunker_booking_sent_at = (
  SELECT MAX(el.created_at)
  FROM email_log el
  WHERE el.order_id = o.id
    AND el.document_type = 'BUNKER_BOOKING'
    AND el.status = 'SENT'
)
WHERE EXISTS (
  SELECT 1 FROM email_log el
  WHERE el.order_id = o.id
    AND el.document_type = 'BUNKER_BOOKING'
    AND el.status = 'SENT'
);