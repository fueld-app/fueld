/**
 * Invoice register — every issued customer invoice, paid and unpaid.
 *
 * ── Why this is not the ageing report ───────────────────────────────────────
 * `buildInvoiceAgingReport` deliberately shows only invoices with something still
 * owed: an invoice with nothing outstanding is not collectible and does not belong
 * in an ageing view. That leaves a paid invoice with nowhere to be looked up,
 * which is exactly the question it exists to answer — "have we sent that bill,
 * and what is it called?". Trading → Invoiced Orders lists ORDERS (and shows
 * their statuses), so it does not answer it either.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 * Read-only and tenant-scoped. Gated per tenant by `invoiceRegister` so it only
 * appears where it was asked for; the gate lives in the controller, and this
 * service assumes it has been checked, like the other report builders.
 *
 * VOID invoices are listed, flagged as voided, because a correction trail that
 * hides the superseded document is how "which one do I send?" becomes
 * unanswerable. DRAFT is excluded — a draft is not an issued invoice.
 */
import { and, asc, desc, eq, gte, lte, ne } from 'drizzle-orm';
import { db } from '../../db';
import { counterparties, invoices, orders, users, vessels } from '../../db/schema';
import { deriveInvoiceDisplayStatus, SETTLEMENT_EPSILON } from '../orders/invoice.service';
import type { InvoiceRegisterRowDto, InvoiceRegisterDto } from '@fueld/types';

const money = (value: number): string => (Math.round(value * 100) / 100).toFixed(2);

function ageBucket(dueDate: string, today: string): { label: string; daysOverdue: number } {
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(due)) return { label: 'CURRENT', daysOverdue: 0 };
  const daysOverdue = Math.floor((now - due) / 86_400_000);
  if (daysOverdue <= 0) return { label: 'CURRENT', daysOverdue };
  if (daysOverdue <= 30) return { label: '1-30', daysOverdue };
  if (daysOverdue <= 60) return { label: '31-60', daysOverdue };
  if (daysOverdue <= 90) return { label: '61-90', daysOverdue };
  return { label: '90+', daysOverdue };
}

export interface InvoiceRegisterFilters {
  from?: string;
  to?: string;
  /** 'ALL' | 'OPEN' | 'PAID' | 'VOID' */
  status?: string;
  clientId?: string;
  /** Free-text match on invoice number, order number, client or vessel. */
  q?: string;
}

export async function getInvoiceRegister(
  tenantId: string,
  filters: InvoiceRegisterFilters = {},
): Promise<InvoiceRegisterDto> {
  const today = new Date().toISOString().slice(0, 10);
  const conditions = [
    eq(orders.tenantId, tenantId),
    // Issued invoices only. A DRAFT has never been handed to anyone.
    ne(invoices.status, 'DRAFT'),
  ];
  if (filters.from) conditions.push(gte(invoices.dueDate, filters.from));
  if (filters.to) conditions.push(lte(invoices.dueDate, filters.to));
  if (filters.clientId) conditions.push(eq(orders.clientId, filters.clientId));

  const rows = await db
    .select({
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceStatus: invoices.status,
      dueDate: invoices.dueDate,
      amount: invoices.amount,
      amountPaid: invoices.amountPaid,
      issuedAt: invoices.createdAt,
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      clientName: counterparties.name,
      clientId: orders.clientId,
      vesselName: vessels.name,
      traderName: users.name,
      trancheLabel: invoices.trancheLabel,
    })
    .from(invoices)
    .innerJoin(orders, eq(invoices.orderId, orders.id))
    .innerJoin(counterparties, eq(orders.clientId, counterparties.id))
    .innerJoin(vessels, eq(orders.vesselId, vessels.id))
    .leftJoin(users, eq(orders.salesRepId, users.id))
    .where(and(...conditions))
    .orderBy(desc(invoices.createdAt), asc(invoices.invoiceNumber));

  const search = filters.q?.trim().toLowerCase();
  const wanted = (filters.status ?? 'ALL').toUpperCase();

  const mapped: InvoiceRegisterRowDto[] = rows.map((row) => {
    const amount = parseFloat(row.amount ?? '0') || 0;
    const amountPaid = parseFloat(row.amountPaid ?? '0') || 0;
    const outstanding = Math.max(0, amount - amountPaid);
    const bucket = ageBucket(row.dueDate, today);
    // A VOID invoice keeps its display status: the money is no longer owed, and
    // labelling it by its due date would put a cancelled document in an ageing
    // bucket that collections might act on.
    const isVoid = row.invoiceStatus === 'VOID';
    const status = isVoid
      ? 'VOID'
      : deriveInvoiceDisplayStatus(
          { status: row.invoiceStatus, amount: row.amount, amountPaid: row.amountPaid },
          bucket.daysOverdue,
        );

    return {
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoiceNumber,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      clientId: row.clientId,
      clientName: row.clientName,
      vesselName: row.vesselName,
      traderName: row.traderName ?? null,
      issuedAt: row.issuedAt.toISOString(),
      dueDate: row.dueDate,
      amount: money(amount),
      amountPaid: money(amountPaid),
      // A VOID invoice owes nothing. Reporting its frozen amount as outstanding
      // is how a cancelled document gets chased — the exact confusion this
      // register exists to remove.
      outstandingAmount: money(isVoid ? 0 : outstanding),
      status,
      daysOverdue: bucket.daysOverdue,
      agingBucket: bucket.label,
      trancheLabel: row.trancheLabel ?? null,
    };
  });

  const filtered = mapped.filter((row) => {
    if (wanted === 'OPEN' && !(row.status !== 'VOID' && row.status !== 'PAID')) return false;
    if (wanted === 'PAID' && row.status !== 'PAID') return false;
    if (wanted === 'VOID' && row.status !== 'VOID') return false;
    if (!search) return true;
    return [
      row.invoiceNumber,
      row.orderNumber,
      row.clientName,
      row.vesselName,
    ].some((field) => (field ?? '').toLowerCase().includes(search));
  });

  const live = filtered.filter((row) => row.status !== 'VOID');
  return {
    rows: filtered,
    totals: {
      invoices: filtered.length,
      // Two totals on purpose: `issued` is what the register is FOR, `outstanding`
      // is what is still collectible. Folding the voided ones into either would
      // misstate the money.
      totalIssued: money(live.reduce((sum, row) => sum + (parseFloat(row.amount) || 0), 0)),
      totalOutstanding: money(live.reduce((sum, row) => sum + (parseFloat(row.outstandingAmount) || 0), 0)),
      totalPaid: money(live.reduce((sum, row) => sum + (parseFloat(row.amountPaid) || 0), 0)),
      voided: filtered.length - live.length,
    },
  };
}

/** Rows for the XLSX export, in the register's own column order. */
export async function exportInvoiceRegisterRows(
  tenantId: string,
  filters: InvoiceRegisterFilters = {},
): Promise<Array<Array<string | number>>> {
  const { rows } = await getInvoiceRegister(tenantId, filters);
  return rows.map((row) => [
    row.invoiceNumber,
    row.orderNumber ?? '',
    row.clientName,
    row.vesselName,
    row.traderName ?? '',
    row.issuedAt.slice(0, 10),
    row.dueDate,
    row.status,
    Number(row.amount),
    Number(row.amountPaid),
    Number(row.outstandingAmount),
    row.agingBucket,
    row.daysOverdue ?? 0,
  ]);
}

export const INVOICE_REGISTER_HEADERS = [
  'Invoice number', 'Order number', 'Customer', 'Vessel', 'Trader', 'Issued', 'Due',
  'Status', 'Amount', 'Paid', 'Outstanding', 'Age bucket', 'Days overdue',
];
