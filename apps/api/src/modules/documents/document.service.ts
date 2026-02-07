import pdfmake from 'pdfmake';
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { orders, orderItems, counterparties, vessels, places, invoices, users } from '../../db/schema';

// ═══════════════════════════════════════════════════════════════════════
//  Document Service — Server-side PDF generation (pdfmake v0.3)
// ═══════════════════════════════════════════════════════════════════════

// Configure fonts (server-side: use built-in Roboto shipped with pdfmake)
pdfmake.setFonts({
  Roboto: {
    normal: 'node_modules/pdfmake/fonts/Roboto/Roboto-Regular.ttf',
    bold: 'node_modules/pdfmake/fonts/Roboto/Roboto-Medium.ttf',
    italics: 'node_modules/pdfmake/fonts/Roboto/Roboto-Italic.ttf',
    bolditalics: 'node_modules/pdfmake/fonts/Roboto/Roboto-MediumItalic.ttf',
  },
});

// ─── Bank details (configurable per tenant in a real system) ─────────

interface BankDetails {
  bankName: string;
  accountName: string;
  iban: string;
  swift: string;
  currency: string;
}

const DEFAULT_BANK_DETAILS: BankDetails = {
  bankName: 'DNB Bank ASA',
  accountName: 'Fueld Trading Ltd',
  iban: 'NO93 8601 1117 947',
  swift: 'DNBANOKKXXX',
  currency: 'USD',
};

// ─── Data fetching ───────────────────────────────────────────────────

async function fetchInvoiceData(invoiceId: string) {
  const invoice = await db.query.invoices.findFirst({
    where: eq(invoices.id, invoiceId),
    with: {
      order: {
        with: {
          client: true,
          vessel: true,
          place: true,
          salesRep: true,
          items: {
            with: {
              supplier: true,
            },
          },
        },
      },
    },
  });

  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
  return invoice;
}

async function fetchOrderForInvoice(orderId: string) {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    with: {
      client: true,
      vessel: true,
      place: true,
      salesRep: true,
      items: {
        with: {
          supplier: true,
        },
      },
      invoices: true,
    },
  });

  if (!order) throw new Error(`Order ${orderId} not found`);
  return order;
}

// ─── PDF Builder ─────────────────────────────────────────────────────

function formatNumber(val: string | null | undefined, decimals = 2): string {
  if (!val) return '—';
  const n = parseFloat(val);
  return isNaN(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function buildInvoiceDocument(data: {
  invoiceNumber: string;
  dueDate: string;
  clientName: string;
  clientCountry: string | null;
  vesselName: string;
  vesselImo: string | null;
  portName: string;
  salesRepName: string | null;
  items: Array<{
    productType: string;
    quantity: string;
    unit: string;
    salesPrice: string | null;
    costPrice: string | null;
  }>;
  totalAmount: string | null;
  bank: BankDetails;
  createdAt: Date;
}): TDocumentDefinitions {
  // Build line items table
  const tableHeader: TableCell[] = [
    { text: '#', style: 'tableHeader' },
    { text: 'Product', style: 'tableHeader' },
    { text: 'Quantity', style: 'tableHeader', alignment: 'right' },
    { text: 'Unit', style: 'tableHeader' },
    { text: 'Unit Price (USD)', style: 'tableHeader', alignment: 'right' },
    { text: 'Total (USD)', style: 'tableHeader', alignment: 'right' },
  ];

  const tableRows: TableCell[][] = data.items.map((item, idx) => {
    const qty = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.salesPrice ?? '0') || 0;
    const lineTotal = qty * price;
    return [
      { text: String(idx + 1), alignment: 'center' },
      { text: item.productType },
      { text: formatNumber(item.quantity, 3), alignment: 'right' },
      { text: item.unit },
      { text: formatNumber(item.salesPrice, 4), alignment: 'right' },
      { text: formatNumber(String(lineTotal), 2), alignment: 'right' },
    ];
  });

  // Grand total
  const grandTotal = data.items.reduce((sum, item) => {
    const qty = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.salesPrice ?? '0') || 0;
    return sum + qty * price;
  }, 0);

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60],

    content: [
      // ── Header ──
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'FUELD', style: 'brand' },
              { text: 'Bunker Trading Solutions', style: 'brandSub' },
            ],
          },
          {
            width: 'auto',
            stack: [
              { text: 'INVOICE', style: 'invoiceTitle' },
              { text: `#${data.invoiceNumber}`, style: 'invoiceNumber' },
            ],
            alignment: 'right',
          },
        ],
      } as Content,
      { text: '', margin: [0, 10, 0, 0] } as Content,

      // ── Horizontal divider ──
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#1a56db' }],
      } as Content,
      { text: '', margin: [0, 10, 0, 0] } as Content,

      // ── Bill To / Invoice Meta ──
      {
        columns: [
          {
            width: '50%',
            stack: [
              { text: 'Bill To:', style: 'sectionLabel' },
              { text: data.clientName, style: 'clientName' },
              { text: data.clientCountry ?? '', color: '#666666' },
            ],
          },
          {
            width: '50%',
            stack: [
              { text: `Invoice Date: ${data.createdAt.toISOString().split('T')[0]}`, alignment: 'right' },
              { text: `Due Date: ${data.dueDate}`, alignment: 'right', bold: true },
              { text: `Sales Rep: ${data.salesRepName ?? 'N/A'}`, alignment: 'right', color: '#666666' },
            ],
          },
        ],
      } as Content,
      { text: '', margin: [0, 10, 0, 0] } as Content,

      // ── Vessel Info ──
      {
        columns: [
          { width: '50%', text: `Vessel: ${data.vesselName}${data.vesselImo ? ` (IMO: ${data.vesselImo})` : ''}`, style: 'vesselInfo' },
          { width: '50%', text: `Port: ${data.portName}`, style: 'vesselInfo', alignment: 'right' },
        ],
      } as Content,
      { text: '', margin: [0, 15, 0, 0] } as Content,

      // ── Line Items Table ──
      {
        table: {
          headerRows: 1,
          widths: [25, '*', 70, 40, 80, 90],
          body: [tableHeader, ...tableRows],
        },
        layout: {
          hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
            i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5,
          vLineWidth: () => 0,
          hLineColor: (i: number) => (i <= 1 ? '#1a56db' : '#e5e7eb'),
          paddingTop: () => 6,
          paddingBottom: () => 6,
        },
      } as Content,

      // ── Total ──
      { text: '', margin: [0, 10, 0, 0] } as Content,
      {
        columns: [
          { width: '*', text: '' },
          {
            width: 'auto',
            table: {
              body: [
                [
                  { text: 'TOTAL', style: 'totalLabel' },
                  { text: `USD ${formatNumber(String(grandTotal))}`, style: 'totalValue' },
                ],
              ],
            },
            layout: 'noBorders',
          },
        ],
      } as Content,

      // ── Divider ──
      { text: '', margin: [0, 20, 0, 0] } as Content,
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e5e7eb' }],
      } as Content,
      { text: '', margin: [0, 10, 0, 0] } as Content,

      // ── Bank Details ──
      { text: 'Payment Details', style: 'sectionLabel' } as Content,
      {
        columns: [
          { width: '25%', text: 'Bank:', bold: true },
          { width: '75%', text: data.bank.bankName },
        ],
        margin: [0, 4, 0, 0],
      } as Content,
      {
        columns: [
          { width: '25%', text: 'Account Name:', bold: true },
          { width: '75%', text: data.bank.accountName },
        ],
        margin: [0, 2, 0, 0],
      } as Content,
      {
        columns: [
          { width: '25%', text: 'IBAN:', bold: true },
          { width: '75%', text: data.bank.iban },
        ],
        margin: [0, 2, 0, 0],
      } as Content,
      {
        columns: [
          { width: '25%', text: 'SWIFT:', bold: true },
          { width: '75%', text: data.bank.swift },
        ],
        margin: [0, 2, 0, 0],
      } as Content,
      {
        columns: [
          { width: '25%', text: 'Currency:', bold: true },
          { width: '75%', text: data.bank.currency },
        ],
        margin: [0, 2, 0, 0],
      } as Content,
    ],

    // ── Footer ──
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: 'Generated by Fueld — Bunker Trading SaaS', fontSize: 8, color: '#9ca3af', margin: [40, 0, 0, 0] },
        { text: `Page ${currentPage} of ${pageCount}`, fontSize: 8, color: '#9ca3af', alignment: 'right', margin: [0, 0, 40, 0] },
      ],
    }),

    // ── Styles ──
    styles: {
      brand: { fontSize: 22, bold: true, color: '#1a56db' },
      brandSub: { fontSize: 9, color: '#6b7280', margin: [0, 2, 0, 0] },
      invoiceTitle: { fontSize: 24, bold: true, color: '#111827' },
      invoiceNumber: { fontSize: 12, color: '#6b7280', margin: [0, 2, 0, 0] },
      sectionLabel: { fontSize: 10, bold: true, color: '#1a56db', margin: [0, 0, 0, 4] },
      clientName: { fontSize: 14, bold: true },
      vesselInfo: { fontSize: 10, color: '#374151' },
      tableHeader: { fontSize: 9, bold: true, color: '#ffffff', fillColor: '#1a56db' },
      totalLabel: { fontSize: 12, bold: true, margin: [0, 0, 20, 0] },
      totalValue: { fontSize: 14, bold: true, color: '#1a56db' },
    },

    defaultStyle: {
      fontSize: 10,
      font: 'Roboto',
    },
  };

  return docDefinition;
}

// ═══════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate an invoice PDF buffer for a given invoice ID.
 */
export async function generateInvoicePdfBuffer(invoiceId: string): Promise<Buffer> {
  const invoice = await fetchInvoiceData(invoiceId);
  const order = invoice.order;

  const docData = {
    invoiceNumber: invoice.invoiceNumber,
    dueDate: invoice.dueDate,
    clientName: order.client.name,
    clientCountry: order.client.country,
    vesselName: order.vessel.name,
    vesselImo: order.vessel.imo,
    portName: order.place.name,
    salesRepName: order.salesRep?.name ?? null,
    items: order.items.map((item) => ({
      productType: item.productType,
      quantity: item.quantity,
      unit: item.unit,
      salesPrice: item.salesPrice,
      costPrice: item.costPrice,
    })),
    totalAmount: invoice.amount,
    bank: DEFAULT_BANK_DETAILS,
    createdAt: invoice.createdAt,
  };

  const docDefinition = buildInvoiceDocument(docData);
  return createPdfBuffer(docDefinition);
}

/**
 * Generate an invoice PDF buffer for a given order ID.
 * Uses the first invoice attached to the order, or creates a preview
 * with a placeholder invoice number.
 */
export async function generateOrderInvoicePdfBuffer(orderId: string): Promise<{
  buffer: Buffer;
  invoiceNumber: string;
  fileName: string;
}> {
  const order = await fetchOrderForInvoice(orderId);

  // Find the first invoice or generate a preview number
  const invoice = order.invoices?.[0];
  const invoiceNumber = invoice?.invoiceNumber ?? `PREVIEW-${orderId.slice(0, 8).toUpperCase()}`;
  const dueDate = invoice?.dueDate ?? new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0]!;

  const docData = {
    invoiceNumber,
    dueDate,
    clientName: order.client.name,
    clientCountry: order.client.country,
    vesselName: order.vessel.name,
    vesselImo: order.vessel.imo,
    portName: order.place.name,
    salesRepName: order.salesRep?.name ?? null,
    items: order.items.map((item) => ({
      productType: item.productType,
      quantity: item.quantity,
      unit: item.unit,
      salesPrice: item.salesPrice,
      costPrice: item.costPrice,
    })),
    totalAmount: invoice?.amount ?? null,
    bank: DEFAULT_BANK_DETAILS,
    createdAt: invoice?.createdAt ?? new Date(),
  };

  const docDefinition = buildInvoiceDocument(docData);
  const buffer = await createPdfBuffer(docDefinition);
  const fileName = `Fueld_Invoice_${invoiceNumber.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`;

  return { buffer, invoiceNumber, fileName };
}

// ─── Internal: pdfmake → Buffer ──────────────────────────────────────

function createPdfBuffer(docDefinition: TDocumentDefinitions): Promise<Buffer> {
  const pdf = pdfmake.createPdf(docDefinition);
  return pdf.getBuffer();
}
