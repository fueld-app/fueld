#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  Invoice divergence report — frozen invoices vs the orders behind them.
#
#  What it finds:
#    1. AMOUNT   — a live invoice whose frozen amount differs from the order's
#                  current billable lines.
#    2. DUE DATE — a live invoice whose frozen due date differs from what the
#                  order's current delivery anchor + credit days would give.
#
#  Why: an issued invoice is frozen (amount, due date and number are written once
#  and the PDF is a stored revision served byte-for-byte), but the ORDER stays
#  editable. Any figure derived from the order then disagrees with the document
#  the customer holds — silently. The only comparison in the codebase
#  (`InvoiceLinesChangedError`) runs on the FIRST render and is bypassed
#  forever after by the frozen early-return, so nothing has ever detected this.
#
#  Read-only. Run against any instance:
#     bash scripts/check-invoice-divergence.sh <host>
#  e.g.
#     bash scripts/check-invoice-divergence.sh 31.70.94.96   # moxie
#
#  Exit code 0 always — this is a report, not a gate.
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

HOST="${1:?usage: check-invoice-divergence.sh <vps-host>}"
APP_DIR="${APP_DIR:-/opt/fueld}"

SQL=$(cat <<'SQL'
\pset border 2
\echo '== AMOUNT: live invoice vs current billable lines =='
SELECT o.order_number,
       i.invoice_number,
       i.amount                     AS invoice_amount,
       round(sum(coalesce(it.delivered_quantity, it.quantity) * it.sales_price)::numeric, 2) AS lines_now,
       round((sum(coalesce(it.delivered_quantity, it.quantity) * it.sales_price)
              - i.amount::numeric), 2) AS delta,
       i.created_at::date           AS issued,
       max(it.updated_at)::date     AS line_edited
  FROM orders o
  JOIN invoices i ON i.order_id = o.id
  JOIN order_items it ON it.order_id = o.id
 WHERE i.status <> 'VOID'
   AND coalesce(it.hide_on_documents, false) = false
   AND it.product_type <> 'CREDIT_NOTE'
 GROUP BY o.order_number, i.invoice_number, i.amount, i.created_at
HAVING abs(sum(coalesce(it.delivered_quantity, it.quantity) * it.sales_price) - i.amount::numeric) > 0.005
 ORDER BY o.order_number;

\echo ''
\echo '== DUE DATE: live invoice vs current anchor + credit days =='
SELECT o.order_number,
       i.invoice_number,
       i.due_date                              AS invoice_due,
       (o.delivered_at::date + o.customer_credit_days) AS due_if_recomputed,
       o.delivered_at::date                    AS delivered_at,
       o.eta::date                             AS eta,
       o.customer_credit_days                  AS days
  FROM orders o
  JOIN invoices i ON i.order_id = o.id
 WHERE i.status <> 'VOID'
   AND o.delivered_at IS NOT NULL
   AND o.customer_credit_days IS NOT NULL
   AND (o.delivered_at::date + o.customer_credit_days) <> i.due_date
 ORDER BY o.order_number;

\echo ''
\echo '== TOTALS =='
SELECT count(*) FILTER (WHERE status <> 'VOID') AS live_invoices,
       round(sum(amount) FILTER (WHERE status <> 'VOID')::numeric, 2) AS live_receivable
  FROM invoices;
SQL
)

ssh -o BatchMode=yes "deploy@${HOST}" "cat > /tmp/divergence.sql" <<< "$SQL"
ssh -o BatchMode=yes "deploy@${HOST}" "set -a; . ${APP_DIR}/.env; set +a; psql \"\$DATABASE_URL\" -f /tmp/divergence.sql"
