/**
 * Supplier invoice PDF — a document addressed to a SUPPLIER, asking them to pay
 * commission they funded on a broker deal.
 *
 * ── It renders from the snapshot, never from the orders ────────────────────
 * Every value on the page comes from `supplier_invoices` / `supplier_invoice_lines`,
 * which were frozen at issue. It deliberately does NOT load the order, the
 * counterparty or the bank account: an issued invoice must keep serving the
 * figures and the remittance details it was issued with, so renaming a company,
 * editing a rate, delivering the order or changing the default bank account
 * cannot restate a document the supplier already holds.
 *
 * That is also why this builder takes a DTO rather than an order id — there is
 * no id it could accidentally re-read live data through.
 *
 * Layout: `buildSleekDocument` for the modern layout, mirroring the customer
 * invoice; the classic branch is the same structure without the sleek styling.
 */
import { buildSleekDocument, type SleekDocumentInput } from './document-layouts/sleek';
import type { SupplierInvoiceBankDetailsDto, SupplierInvoiceDto } from '@fueld/types';

const ACCENT = '#0f766e';
const INK = '#111827';
const MUTED = '#6b7280';

function formatAmount(value: string, currency: string): string {
  const n = parseFloat(value) || 0;
  const formatted = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${formatted} ${currency}`;
}

function formatQty(value: string | null): string {
  if (value == null) return '';
  const n = parseFloat(value) || 0;
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function formatDateOnly(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Everything the document needs, as plain values. Assembled from the frozen
 * snapshot so the function has no way to reach live data.
 */
export interface SupplierInvoiceDocumentInput {
  invoice: SupplierInvoiceDto;
  /**
   * Frozen at issue. Structured, so each field is labelled rather than inferred
   * from its position in a blob — a missing bank name used to shift every
   * subsequent field and print the IBAN under the "SWIFT" label.
   */
  bankDetails: SupplierInvoiceBankDetailsDto | null;
  logoDataUrl: string | null;
  /** Tenant document layout setting. */
  layout: 'CLASSIC' | 'SLEEK';
  /** Footer closure, built by the caller from tenant settings. */
  footer: (currentPage: number, pageCount: number) => unknown;
}

function buildLines(invoice: SupplierInvoiceDto) {
  return invoice.lines.map((line) => ({
    description: [line.productType ?? '', line.vesselName ? `— ${line.vesselName}` : '']
      .filter(Boolean)
      .join(' '),
    quantity: formatQty(line.quantity),
    unit: line.unit ?? '',
    rate: line.rate ? `${parseFloat(line.rate).toLocaleString('en-US', { maximumFractionDigits: 4 })}` : '',
    amount: formatAmount(line.amount, invoice.currency),
    orderNumber: line.orderNumber ?? '',
    customerName: line.customerName ?? '',
  }));
}

/**
 * The document body. Deliberately explicit about who pays whom: a supplier
 * reading this must understand it is being billed for commission, not being
 * paid for fuel.
 */
export function buildSupplierInvoiceDocument(input: SupplierInvoiceDocumentInput) {
  const { invoice } = input;
  const lines = buildLines(invoice);

  const meta = [
    { label: 'Invoice no.', value: invoice.invoiceNumber },
    { label: 'Issued', value: formatDateOnly(invoice.issuedAt?.slice(0, 10) ?? null) ?? '—' },
    { label: 'Due', value: formatDateOnly(invoice.dueDate) ?? '—' },
    { label: 'Period', value: `${formatDateOnly(invoice.periodFrom) ?? invoice.periodFrom} – ${formatDateOnly(invoice.periodTo) ?? invoice.periodTo}` },
  ];

  const noteLines = [
    'Brokerage commission on bunker deliveries brokered by us. This is a charge for the commission agreed',
    'per line below, which is funded by you as the supplier — it is not an invoice for fuel.',
    ...(invoice.note ? ['', invoice.note] : []),
  ];

  if (input.layout === 'SLEEK') {
    const sleekInput: SleekDocumentInput = {
      brandName: invoice.invoicingCompanyName ?? '',
      logoDataUrl: input.logoDataUrl,
      title: 'Supplier Invoice',
      meta,
      issuer: {
        name: invoice.invoicingCompanyName ?? '',
        address: null,
        taxId: null,
        phone: null,
        email: null,
      },
      party: {
        name: invoice.supplierName,
        address: null,
        attention: null,
        taxId: null,
      },
      voyage: [],
      lines: lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        // The rate IS the price here: commission per unit.
        unitPrice: l.rate ? `${l.rate} ${invoice.currency}/${l.unit || 'MT'}` : '',
        amount: l.amount,
      })),
      headers: ['Product', 'Quantity', 'Unit', 'Rate', 'Amount'],
      totals: {
        subtotal: formatAmount(invoice.amount, invoice.currency),
        taxable: formatAmount(invoice.amount, invoice.currency),
        taxLabel: '',
        taxAmount: '',
        total: formatAmount(invoice.amount, invoice.currency),
        totalShortLabel: 'Total due',
        totalLabel: null,
      },
      dueLine: `The amount is due on ${formatDateOnly(invoice.dueDate) ?? invoice.dueDate}.`,
      trancheNote: null,
      bank: input.bankDetails
        ? {
          beneficiary: input.bankDetails.beneficiary ?? '',
          bankName: input.bankDetails.bankName,
          accountNumber: null,
          iban: input.bankDetails.iban,
          swift: input.bankDetails.swift,
          branchAddress: input.bankDetails.branchAddress,
        }
        : null,
      notes: noteLines,
      accent: ACCENT,
      verifyUrl: null,
      verifyLink: null,
      fraudPreventionText: null,
      accountName: null,
      closing: null,
      // `buildDocumentFooter` returns pdfmake Content; the layout only calls it.
      footer: input.footer as SleekDocumentInput['footer'],
    };
    return buildSleekDocument(sleekInput);
  }

  // ── Classic layout ────────────────────────────────────────────────
  const body: unknown[] = [
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: 'INVOICE TO (SUPPLIER)', fontSize: 8, color: MUTED, bold: true, margin: [0, 0, 0, 3] },
            { text: invoice.supplierName, fontSize: 11, bold: true, color: INK },
          ],
        },
        {
          width: 'auto',
          stack: meta.map((m) => ({
            text: [{ text: `${m.label}:  `, color: MUTED }, { text: m.value, bold: true }],
            fontSize: 9,
            alignment: 'right' as const,
            margin: [0, 0, 0, 2],
          })),
        },
      ],
      margin: [0, 0, 0, 14],
    },
    {
      table: {
        headerRows: 1,
        widths: ['auto', 'auto', '*', 'auto', 'auto', 'auto'],
        body: [
          ['Order', 'Customer', 'Product', 'Qty', 'Rate', 'Amount'].map((t) => ({
            text: t, fontSize: 8, bold: true, color: MUTED, border: [false, false, false, true],
          })),
          ...lines.map((l) => [
            { text: l.orderNumber, fontSize: 8 },
            { text: l.customerName, fontSize: 8 },
            { text: l.description, fontSize: 9 },
            { text: `${l.quantity} ${l.unit}`, fontSize: 9, alignment: 'right' as const },
            { text: l.rate, fontSize: 9, alignment: 'right' as const },
            { text: l.amount, fontSize: 9, alignment: 'right' as const },
          ]),
          [
            { text: '', border: [false, false, false, false] },
            { text: '', border: [false, false, false, false] },
            { text: '', border: [false, false, false, false] },
            { text: '', border: [false, false, false, false] },
            { text: 'TOTAL', fontSize: 9, bold: true, alignment: 'right' as const, border: [false, true, false, false] },
            { text: formatAmount(invoice.amount, invoice.currency), fontSize: 10, bold: true, alignment: 'right' as const, border: [false, true, false, false] },
          ],
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 0, 0, 12],
    },
    {
      text: noteLines.join('\n'),
      fontSize: 8,
      color: MUTED,
      margin: [0, 0, 0, 12],
    },
    ...(input.bankDetails
      ? [{
        stack: [
          { text: 'REMITTANCE', fontSize: 8, bold: true, color: MUTED, margin: [0, 0, 0, 3] },
          ...remittanceLines(input.bankDetails).map((l) => ({ text: l, fontSize: 9 })),
        ],
      }]
      : []),
  ];

  return {
    pageSize: 'A4' as const,
    pageMargins: [40, 50, 40, 60] as [number, number, number, number],
    content: body,
    footer: input.footer,
    defaultStyle: { fontSize: 9, color: INK },
  };
}

/**
 * Label each remittance field explicitly. The previous implementation joined
 * the values with newlines and re-split them by position in the PDF, so an
 * absent bank name or SWIFT code shifted every later value onto the wrong label.
 */
function remittanceLines(bank: SupplierInvoiceBankDetailsDto): string[] {
  const beneficiary = bank.beneficiary?.trim() ?? '';
  const accountName = bank.accountName?.trim() ?? '';
  return [
    beneficiary,
    // Usually identical to the beneficiary; print once when it is.
    accountName && accountName !== beneficiary ? accountName : '',
    bank.bankName?.trim() ?? '',
    bank.iban?.trim() ? `IBAN ${bank.iban.trim()}` : '',
    bank.swift?.trim() ? `SWIFT/BIC ${bank.swift.trim()}` : '',
    bank.currency?.trim() ? `Currency ${bank.currency.trim()}` : '',
    bank.branchAddress?.trim() ?? '',
  ].filter((l) => l.length > 0);
}
