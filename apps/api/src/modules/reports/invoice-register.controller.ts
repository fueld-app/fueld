/**
 * Invoice register endpoints — Reports → Invoices.
 *
 * Gated by the per-tenant `invoiceRegister` flag. Checked HERE rather than only in
 * the UI: the page is opt-in, and a hidden menu entry must not be the only thing
 * standing between a tenant and a surface that was never meant to be on for them.
 * Returns 403 rather than 404 so the caller can tell "not enabled" from "no data".
 */
import * as XLSX from 'xlsx';
import { getInvoiceSettings } from '../admin/settings.service';
import {
  exportInvoiceRegisterRows,
  getInvoiceRegister,
  INVOICE_REGISTER_HEADERS,
  type InvoiceRegisterFilters,
} from './invoice-register.service';

export interface InvoiceRegisterQuery {
  from?: string;
  to?: string;
  status?: string;
  clientId?: string;
  q?: string;
}

function toFilters(query: InvoiceRegisterQuery): InvoiceRegisterFilters {
  return {
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.clientId ? { clientId: query.clientId } : {}),
    ...(query.q ? { q: query.q } : {}),
  };
}

export async function invoiceRegisterEnabled(tenantId: string): Promise<boolean> {
  const settings = await getInvoiceSettings(tenantId);
  return settings.register;
}

export async function handleGetInvoiceRegister(tenantId: string, query: InvoiceRegisterQuery) {
  if (!(await invoiceRegisterEnabled(tenantId))) {
    return { ok: false as const, message: 'The invoice register is not enabled for this account' };
  }
  const data = await getInvoiceRegister(tenantId, toFilters(query));
  return { ok: true as const, data };
}

export async function handleExportInvoiceRegister(
  tenantId: string,
  query: InvoiceRegisterQuery,
): Promise<{ ok: false; message: string } | { ok: true; fileName: string; content: Buffer }> {
  if (!(await invoiceRegisterEnabled(tenantId))) {
    return { ok: false, message: 'The invoice register is not enabled for this account' };
  }
  const rows = await exportInvoiceRegisterRows(tenantId, toFilters(query));
  // Header row first, then one row per invoice, so the file opens as a table
  // rather than as a list of arrays.
  const sheet = XLSX.utils.aoa_to_sheet([INVOICE_REGISTER_HEADERS, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Invoices');
  const suffix = new Date().toISOString().slice(0, 10);
  return {
    ok: true,
    fileName: `invoices_${suffix}.xlsx`,
    content: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  };
}
