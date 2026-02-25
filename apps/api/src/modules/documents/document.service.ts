import pdfmake from 'pdfmake';
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import { and, desc, eq } from 'drizzle-orm';
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import QRCode from 'qrcode';
import { db } from '../../db';
import { bankAccounts, entityComments, orders, orderItems, counterparties, vessels, places, invoices, users } from '../../db/schema';

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
  accountName: string | null;
  accountNumber: string | null;
  iban: string | null;
  swift: string | null;
  currency: string;
  branchAddress: string | null;
  intermediaryBank: string | null;
}

const DEFAULT_BANK_DETAILS: BankDetails = {
  bankName: 'DNB Bank ASA',
  accountName: 'Fueld Trading Ltd',
  accountNumber: null,
  iban: 'NO93 8601 1117 947',
  swift: 'DNBANOKKXXX',
  currency: 'USD',
  branchAddress: null,
  intermediaryBank: null,
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
          supplier: true,
          invoicingCompany: true,
          items: true,
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
      supplier: true,
      invoicingCompany: true,
      customerContact: true,
      supplierContact: true,
      items: true,
      invoices: true,
    },
  });

  if (!order) throw new Error(`Order ${orderId} not found`);
  return order;
}

/** Load the bank account assigned to an order (or the company default). */
async function loadOrderBankDetails(
  bankAccountId: string | null | undefined,
  invoicingCompanyId: string | null | undefined,
): Promise<BankDetails> {
  // Try specific bank account first
  if (bankAccountId) {
    const [ba] = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, bankAccountId))
      .limit(1);
    if (ba) {
      return {
        bankName: ba.bankName,
        accountName: ba.accountName,
        accountNumber: ba.accountNumber,
        iban: ba.iban,
        swift: ba.swiftBic,
        currency: ba.currency,
        branchAddress: ba.branchAddress,
        intermediaryBank: ba.intermediaryBank,
      };
    }
  }
  // Fallback: default bank account for the invoicing company
  if (invoicingCompanyId) {
    const [ba] = await db
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.counterpartyId, invoicingCompanyId), eq(bankAccounts.isDefault, true)))
      .limit(1);
    if (ba) {
      return {
        bankName: ba.bankName,
        accountName: ba.accountName,
        accountNumber: ba.accountNumber,
        iban: ba.iban,
        swift: ba.swiftBic,
        currency: ba.currency,
        branchAddress: ba.branchAddress,
        intermediaryBank: ba.intermediaryBank,
      };
    }
  }
  return DEFAULT_BANK_DETAILS;
}

function renderCompanyTemplate(template: string | null | undefined, companyName: string | null | undefined): string | null {
  const raw = template?.trim();
  if (!raw) return null;
  const name = companyName?.trim();
  if (!name) return raw;
  return raw.split('${companyName}').join(name);
}

function buildCompanyTermsSection(params: {
  companyName?: string | null;
  customerTerms?: string | null;
  supplierTerms?: string | null;
}): Content[] {
  const customer = renderCompanyTemplate(params.customerTerms, params.companyName);
  const supplier = renderCompanyTemplate(params.supplierTerms, params.companyName);
  if (!customer && !supplier) return [];

  const parts: Content[] = [{ text: 'Terms', style: 'sectionLabel' } as Content];
  if (customer) {
    parts.push({ text: customer, margin: [0, 0, 0, 8] } as Content);
  }
  if (supplier) {
    parts.push({ text: 'Supplier terms', bold: true, margin: [0, 0, 0, 4] } as Content);
    parts.push({ text: supplier, margin: [0, 0, 0, 8] } as Content);
  }
  return parts;
}

// ─── PDF Builder ─────────────────────────────────────────────────────

function formatNumber(val: string | null | undefined, decimals = 2): string {
  if (!val) return '—';
  const n = parseFloat(val);
  return isNaN(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Format a phone number for display: keep international prefix, format
 * remaining digits in local-style groups.
 * e.g. "+4526131217" → "+45 2613 1217", "+18005551234" → "+1 800 555 1234"
 */
function formatPhoneDisplay(phone: string | null | undefined): string | null {
  if (!phone) return null;
  // Strip everything except digits and leading +
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = `+${cleaned}`;

  // Split into country code + national number
  // Try common country code lengths: 1 (US/CA), 2, 3
  let cc = '';
  let national = '';
  const digits = cleaned.slice(1); // without +
  if (digits.startsWith('1') && digits.length >= 11) {
    cc = '1'; national = digits.slice(1);
  } else if (digits.length > 2) {
    // Try 2-digit country code first (most European, Asian, etc.)
    cc = digits.slice(0, 2); national = digits.slice(2);
  } else {
    return cleaned; // too short to format
  }

  // Group national number in blocks of 4, last group can be shorter
  const groups: string[] = [];
  for (let i = 0; i < national.length; i += 4) {
    groups.push(national.slice(i, i + 4));
  }
  return `+${cc} ${groups.join(' ')}`;
}

/** Strip non-digit/+ chars for use in tel: URI */
function phoneToTelUri(phone: string): string {
  return 'tel:' + phone.replace(/[^\d+]/g, '');
}

/** Build a pdfmake text node for a phone number with tel: link */
function phoneTextNode(label: string, phone: string, opts: { fontSize?: number; margin?: number[] } = {}): Content {
  const display = formatPhoneDisplay(phone) ?? phone;
  const uri = phoneToTelUri(phone);
  return {
    text: [
      { text: label, bold: true },
      { text: display, link: uri, color: '#1a56db' },
    ],
    fontSize: opts.fontSize ?? 10,
    margin: opts.margin ?? [0, 0, 0, 2],
  } as Content;
}

/** Build a pdfmake text node for an email with mailto: link */
function emailTextNode(label: string, email: string, opts: { fontSize?: number; margin?: number[] } = {}): Content {
  return {
    text: [
      { text: label, bold: true },
      { text: email, link: `mailto:${email}`, color: '#1a56db' },
    ],
    fontSize: opts.fontSize ?? 10,
    margin: opts.margin ?? [0, 0, 0, 2],
  } as Content;
}

function formatCustomerPaymentTerms(
  type: string | null | undefined,
  creditDays: number | null | undefined,
): string | null {
  if (!type) return null;
  if (type === 'CREDIT') {
    const days = creditDays ?? 0;
    return `Credit ${days} days`;
  }
  if (type === 'COD') return 'Cash on Delivery';
  if (type === 'PREPAY') return 'Cash in advance';
  return type;
}

function parseTimezoneOffset(tz: string | null | undefined): number | null {
  if (!tz) return null;
  const match = tz.match(/([+-])\s*(\d{1,2})(?::(\d{2}))?/);
  if (!match) {
    if (/^(GMT|UTC)$/i.test(tz.trim())) return 0;
    return null;
  }
  const sign = match[1] === '+' ? 1 : -1;
  const hours = parseInt(match[2], 10);
  const minutes = match[3] ? parseInt(match[3], 10) : 0;
  return sign * (hours * 60 + minutes);
}

function formatDateTimeForDisplay(value: string | null, tz: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  const offset = parseTimezoneOffset(tz ?? null);
  const local = offset === null ? date : new Date(date.getTime() + offset * 60_000);
  const year = String(local.getUTCFullYear()).padStart(4, '0');
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  const hour = String(local.getUTCHours()).padStart(2, '0');
  const minute = String(local.getUTCMinutes()).padStart(2, '0');
  const formatted = `${day}-${month}-${year} ${hour}:${minute}`;
  return tz ? `${formatted} ${tz}` : formatted;
}

function buildNotesSection(params: {
  customerNote?: string | null;
  placeOrderRemark?: string | null;
  placeComment?: string | null;
  termsAndConditions?: string | null;
  itemNotes?: Array<{ label: string; note: string }>;
}): Content[] {
  const customerNote = params.customerNote?.trim();
  const placeOrderRemark = params.placeOrderRemark?.trim();
  const placeComment = params.placeComment?.trim();
  const termsAndConditions = params.termsAndConditions?.trim();
  const itemNotes = params.itemNotes ?? [];
  if (!customerNote && !placeOrderRemark && !placeComment && !termsAndConditions && itemNotes.length === 0) return [];

  const notes: Content[] = [{ text: 'Notes', style: 'sectionLabel' } as Content];

  if (customerNote) {
    notes.push({ text: customerNote, margin: [0, 0, 0, 6] } as Content);
  }

  if (placeOrderRemark) {
    notes.push({ text: placeOrderRemark, margin: [0, 0, 0, 6] } as Content);
  }

  if (placeComment) {
    notes.push({ text: `Place comment: ${placeComment}`, margin: [0, 0, 0, 6] } as Content);
  }

  if (termsAndConditions) {
    notes.push({ text: 'Additional terms / notes:', bold: true, margin: [0, 2, 0, 4] } as Content);
    notes.push({ text: termsAndConditions, margin: [0, 0, 0, 6] } as Content);
  }

  if (itemNotes.length) {
    notes.push({
      ul: itemNotes.map((entry) => `${entry.label}: ${entry.note}`),
      margin: [0, 0, 0, 6],
    } as Content);
  }

  return notes;
}

function tryLoadLogoDataUrl(logoUrl: string | null | undefined): string | null {
  const raw = (logoUrl ?? '').trim();
  if (!raw) return null;

  // We expect stored URLs like: /uploads/logos/<filename>
  const filename = basename(raw.split('?')[0] ?? '');
  if (!filename) return null;

  const ext = extname(filename).toLowerCase();
  const mime = ext === '.png'
    ? 'image/png'
    : ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : null;
  if (!mime) return null;

  // Resolve to local uploads folder (works in dev and in the deployed /opt/fueld layout).
  const localPath = join(import.meta.dir, '../../../uploads/logos', filename);
  if (!existsSync(localPath)) return null;

  try {
    const buf = readFileSync(localPath);
    if (!buf.length) return null;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
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
  paymentTerms: string | null;
  customerNote: string | null;
  itemNotes: Array<{ label: string; note: string }>;
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
  companyName: string | null;
  vatNumber: string | null;
  fraudPreventionText: string | null;
  verifyUrl?: string | null;
  verifyLink?: string | null;
  companyLogoDataUrl: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
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
            stack: data.companyLogoDataUrl
              ? [{ image: data.companyLogoDataUrl, fit: [140, 50] } as Content]
              : [
                  { text: data.companyName ?? 'FUELD', style: 'brand' } as Content,
                  { text: 'Bunker Trading Solutions', style: 'brandSub' } as Content,
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

      // ── Notes / Payment Terms ──
      ...(data.paymentTerms
        ? [{ text: [{ text: 'Payment terms: ', bold: true }, { text: data.paymentTerms }], margin: [0, 10, 0, 0] } as Content]
        : []),
      ...buildNotesSection({
        customerNote: data.customerNote,
        itemNotes: data.itemNotes,
      }),

      // ── Divider ──
      { text: '', margin: [0, 14, 0, 0] } as Content,
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e5e7eb' }],
      } as Content,
      { text: '', margin: [0, 10, 0, 0] } as Content,

      // ── Bank Details ──
      { text: 'REMITTANCE INSTRUCTIONS', style: 'sectionLabel' } as Content,
      { text: 'Payment to be effected, free of all charges to us, by telegraphic transfer to:', fontSize: 9, margin: [0, 2, 0, 6] } as Content,
      {
        columns: [
          { width: '25%', text: 'Bank:', bold: true },
          { width: '75%', text: data.bank.bankName },
        ],
        margin: [0, 2, 0, 0],
      } as Content,
      ...(data.bank.branchAddress ? [{
        columns: [
          { width: '25%', text: '' },
          { width: '75%', text: data.bank.branchAddress, color: '#374151' },
        ],
        margin: [0, 2, 0, 0],
      } as Content] : []),
      ...(data.bank.accountName ? [{
        columns: [
          { width: '25%', text: 'In favour of:', bold: true },
          { width: '75%', text: data.bank.accountName },
        ],
        margin: [0, 2, 0, 0],
      } as Content] : []),
      ...(data.bank.iban ? [{
        columns: [
          { width: '25%', text: 'IBAN No:', bold: true },
          { width: '75%', text: data.bank.iban, font: 'Roboto' },
        ],
        margin: [0, 2, 0, 0],
      } as Content] : []),
      ...(data.bank.accountNumber ? [{
        columns: [
          { width: '25%', text: 'Account No:', bold: true },
          { width: '75%', text: data.bank.accountNumber, font: 'Roboto' },
        ],
        margin: [0, 2, 0, 0],
      } as Content] : []),
      ...(data.bank.swift ? [{
        columns: [
          { width: '25%', text: 'SWIFT:', bold: true },
          { width: '75%', text: data.bank.swift },
        ],
        margin: [0, 2, 0, 0],
      } as Content] : []),
      ...(data.bank.intermediaryBank ? [{
        columns: [
          { width: '25%', text: 'Intermediary bank:', bold: true },
          { width: '75%', text: data.bank.intermediaryBank },
        ],
        margin: [0, 2, 0, 0],
      } as Content] : []),

      // ── VAT Number ──
      ...(data.vatNumber ? [{
        text: `${data.companyName ?? 'Company'} VAT: ${data.vatNumber}`,
        fontSize: 9,
        margin: [0, 10, 0, 0],
      } as Content] : []),

      // ── Payment note ──
      { text: 'Note: Late payment charged @ 2% interest, per month pro rata.', fontSize: 8, color: '#6b7280', margin: [0, 10, 0, 0] } as Content,

      // ── Fraud Prevention ──
      ...(data.fraudPreventionText ? [
        { text: '', margin: [0, 10, 0, 0] } as Content,
        { text: 'FRAUD PREVENTION', fontSize: 9, bold: true, margin: [0, 0, 0, 4] } as Content,
        { text: data.fraudPreventionText, fontSize: 8, color: '#374151', margin: [0, 0, 0, 0] } as Content,
      ] : []),

      // ── QR code verification ──
      ...(data.verifyUrl ? [
        { text: '', margin: [0, 14, 0, 0] } as Content,
        {
          columns: [
            { width: '*', text: '' },
            {
              width: 'auto',
              stack: [
                { image: data.verifyUrl, fit: [80, 80], alignment: 'center', link: data.verifyLink ?? undefined } as Content,
                { text: 'Scan or click to verify', fontSize: 7, color: '#1a56db', alignment: 'center', margin: [0, 4, 0, 0], link: data.verifyLink ?? undefined } as Content,
                ...(data.verifyLink ? [
                  { text: `Verify domain: ${new URL(data.verifyLink).hostname}`, fontSize: 6, color: '#6b7280', alignment: 'center', margin: [0, 2, 0, 0] } as Content,
                ] : []),
              ],
            },
            { width: '*', text: '' },
          ],
        } as Content,
      ] : []),
    ],

    // ── Footer ──
    footer: (currentPage: number, pageCount: number) => {
      const senderName = data.companyName?.trim() || 'Fueld Trading';
      const leftTexts: Content[] = [
        { text: senderName, fontSize: 8, bold: true, color: '#374151' } as Content,
      ];
      if (data.companyAddress?.trim()) {
        for (const line of data.companyAddress.trim().split(/\n|,\s*/)) {
          const l = line.trim();
          if (l) leftTexts.push({ text: l, fontSize: 8, color: '#374151' } as Content);
        }
      }
      const middleTexts: Content[] = [];
      if (data.companyPhone?.trim()) {
        const display = formatPhoneDisplay(data.companyPhone) ?? data.companyPhone.trim();
        middleTexts.push({ text: `Phone No: ${display}`, fontSize: 8, color: '#374151', link: phoneToTelUri(data.companyPhone) } as Content);
      }
      if (data.companyEmail?.trim()) {
        middleTexts.push({ text: `Email: ${data.companyEmail.trim()}`, fontSize: 8, color: '#1a56db', link: `mailto:${data.companyEmail.trim()}` } as Content);
      }
      return {
        margin: [40, 0, 40, 20] as [number, number, number, number],
        stack: [
          { canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#9ca3af' }] },
          {
            columns: [
              { width: '*' as const, stack: leftTexts },
              { width: '*' as const, stack: middleTexts },
              { width: 'auto' as const, text: `Page ${currentPage} of ${pageCount}`, fontSize: 8, color: '#374151', alignment: 'right' as const },
            ],
            margin: [0, 6, 0, 0] as [number, number, number, number],
          },
        ],
      };
    },

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

  const bank = await loadOrderBankDetails(order.bankAccountId, order.invoicingCompanyId);

  // QR code verification
  let verifyUrl: string | null = null;
  const appUrl = process.env['APP_URL'] || 'http://localhost:4200';
  const verifyLink = `${appUrl}/verify/${order.id}/invoice`;
  try {
    verifyUrl = await QRCode.toDataURL(verifyLink, { width: 160, margin: 1 });
  } catch { /* QR generation failed — continue without */ }

  // Company logo
  let companyLogoDataUrl: string | null = null;
  if (order.invoicingCompany?.logoUrl) {
    const logoPath = join(process.cwd(), 'uploads', order.invoicingCompany.logoUrl);
    if (existsSync(logoPath)) {
      const ext = extname(logoPath).replace('.', '');
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : 'image/jpeg';
      companyLogoDataUrl = `data:${mime};base64,${readFileSync(logoPath).toString('base64')}`;
    }
  }

  const docData = {
    invoiceNumber: invoice.invoiceNumber,
    dueDate: invoice.dueDate,
    clientName: order.client.name,
    clientCountry: order.client.country,
    vesselName: order.vessel.name,
    vesselImo: order.vessel.imo,
    portName: order.place.name,
    salesRepName: order.salesRep?.name ?? null,
    paymentTerms: formatCustomerPaymentTerms(order.customerPaymentTermType, order.customerCreditDays),
    customerNote: order.customerNote ?? null,
    itemNotes: order.items
      .filter((item) => item.customerNote)
      .map((item) => ({
        label: item.productType,
        note: String(item.customerNote),
      })),
    items: order.items.map((item) => ({
      productType: item.productType,
      quantity: item.quantity,
      unit: item.unit,
      salesPrice: item.salesPrice,
      costPrice: item.costPrice,
    })),
    totalAmount: invoice.amount,
    bank,
    createdAt: invoice.createdAt,
    companyName: order.invoicingCompany?.name ?? null,
    vatNumber: order.invoicingCompany?.vatNumber ?? null,
    fraudPreventionText: order.invoicingCompany?.fraudPreventionText ?? null,
    verifyUrl,
    verifyLink,
    companyLogoDataUrl,
    companyAddress: order.invoicingCompany?.headOfficeAddress ?? null,
    companyPhone: order.invoicingCompany?.headOfficePhone ?? null,
    companyEmail: order.invoicingCompany?.headOfficeEmail ?? null,
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

  const bank = await loadOrderBankDetails(order.bankAccountId, order.invoicingCompanyId);

  // QR code verification
  let verifyUrl: string | null = null;
  const appUrl = process.env['APP_URL'] || 'http://localhost:4200';
  const verifyLink = `${appUrl}/verify/${orderId}/invoice`;
  try {
    verifyUrl = await QRCode.toDataURL(verifyLink, { width: 160, margin: 1 });
  } catch { /* QR generation failed — continue without */ }

  // Company logo
  let companyLogoDataUrl: string | null = null;
  if (order.invoicingCompany?.logoUrl) {
    const logoPath = join(process.cwd(), 'uploads', order.invoicingCompany.logoUrl);
    if (existsSync(logoPath)) {
      const ext = extname(logoPath).replace('.', '');
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : 'image/jpeg';
      companyLogoDataUrl = `data:${mime};base64,${readFileSync(logoPath).toString('base64')}`;
    }
  }

  const docData = {
    invoiceNumber,
    dueDate,
    clientName: order.client.name,
    clientCountry: order.client.country,
    vesselName: order.vessel.name,
    vesselImo: order.vessel.imo,
    portName: order.place.name,
    salesRepName: order.salesRep?.name ?? null,
    paymentTerms: formatCustomerPaymentTerms(order.customerPaymentTermType, order.customerCreditDays),
    customerNote: order.customerNote ?? null,
    itemNotes: order.items
      .filter((item) => item.customerNote)
      .map((item) => ({
        label: item.productType,
        note: String(item.customerNote),
      })),
    items: order.items.map((item) => ({
      productType: item.productType,
      quantity: item.quantity,
      unit: item.unit,
      salesPrice: item.salesPrice,
      costPrice: item.costPrice,
    })),
    totalAmount: invoice?.amount ?? null,
    bank,
    createdAt: invoice?.createdAt ?? new Date(),
    companyName: order.invoicingCompany?.name ?? null,
    vatNumber: order.invoicingCompany?.vatNumber ?? null,
    fraudPreventionText: order.invoicingCompany?.fraudPreventionText ?? null,
    verifyUrl,
    verifyLink,
    companyLogoDataUrl,
    companyAddress: order.invoicingCompany?.headOfficeAddress ?? null,
    companyPhone: order.invoicingCompany?.headOfficePhone ?? null,
    companyEmail: order.invoicingCompany?.headOfficeEmail ?? null,
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

// ═══════════════════════════════════════════════════════════════════════
//  Offer PDF
// ═══════════════════════════════════════════════════════════════════════

function buildOfferDocument(data: {
  orderNumber: string | null;
  clientName: string;
  clientCountry: string | null;
  clientAddress: string | null;
  customerContactName: string | null;
  customerContactRole: string | null;
  customerContactPhone: string | null;
  customerContactEmail: string | null;
  vesselName: string;
  vesselImo: string | null;
  portName: string;
  eta: string | null;
  etd: string | null;
  timezone: string | null;
  fromName: string | null;
  fromEmail: string | null;
  fromPhone: string | null;
  paymentTerms: string | null;
  customerNote: string | null;
  placeOrderRemark: string | null;
  placeComment: string | null;
  termsAndConditions: string | null;
  companyName: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  companyWebsite: string | null;
  companyLogoDataUrl: string | null;
  customerTerms: string | null;
  supplierTerms: string | null;
  itemNotes: Array<{ label: string; note: string }>;
  currency: string;
  items: Array<{
    productType: string;
    description: string | null;
    quantity: string;
    quantityMin: string | null;
    quantityMax: string | null;
    unit: string;
    salesPrice: string | null;
  }>;
  createdAt: Date;
  docTitle?: string;
  verifyUrl?: string | null;
}): TDocumentDefinitions {
  // ── Prepare data ──────────────────────────────────────────────────
  const refNum = data.orderNumber ?? 'DRAFT';
  const senderName = data.companyName?.trim() || 'Fueld Trading';
  const dd = String(data.createdAt.getUTCDate()).padStart(2, '0');
  const mm = String(data.createdAt.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = data.createdAt.getUTCFullYear();
  const createdDate = `${dd}-${mm}-${yyyy}`;
  const title = data.docTitle ?? 'OFFER';

  // Customer address block (top-left)
  const customerBlock: Content[] = [
    { text: data.clientName, fontSize: 10 } as Content,
  ];
  if (data.customerContactName?.trim()) {
    const role = data.customerContactRole?.trim();
    customerBlock.push({ text: `Att:${data.customerContactName.trim()}${role ? ` (${role})` : ''}`, fontSize: 10 } as Content);
  }
  // Client address — split commas and newlines into separate lines
  const clientAddr = data.clientAddress?.trim();
  if (clientAddr) {
    const lines = clientAddr.split(/\n|,\s*/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      customerBlock.push({ text: line, fontSize: 10 } as Content);
    }
  } else if (data.clientCountry?.trim()) {
    customerBlock.push({ text: data.clientCountry.trim(), fontSize: 10 } as Content);
  }

  // Right-side meta block (Date / Ref / Page — Page is dynamic via header)
  const rightMetaBlock: Content[] = [];
  if (data.companyLogoDataUrl) {
    rightMetaBlock.push({ image: data.companyLogoDataUrl, fit: [150, 50], alignment: 'right', margin: [0, 0, 0, 8] } as Content);
  }

  // Items table
  const tableHeader: TableCell[] = [
    { text: 'Product', style: 'tableHeader' },
    { text: 'Quantity', style: 'tableHeader', alignment: 'right' },
    { text: 'Unit', style: 'tableHeader' },
    { text: 'Price', style: 'tableHeader', alignment: 'right' },
  ];

  const tableRows: TableCell[][] = data.items.map((item) => {
    const qty = item.quantityMin && item.quantityMax
      ? `${formatNumber(item.quantityMin, 0)} - ${formatNumber(item.quantityMax, 0)}`
      : formatNumber(item.quantity, 3);
    const productCell: Content = item.description?.trim()
      ? { text: [{ text: item.productType }, { text: `  ${item.description.trim()}`, fontSize: 8, color: '#374151' }] }
      : { text: item.productType };
    return [
      productCell as TableCell,
      { text: qty, alignment: 'right' },
      { text: item.unit },
      { text: `${data.currency}/${item.unit}  ${formatNumber(item.salesPrice)}`, alignment: 'right' },
    ];
  });

  // Delivery date string
  let deliveryDateStr = '';
  if (data.eta) {
    const fmtEta = formatDateTimeForDisplay(data.eta, data.timezone);
    deliveryDateStr = fmtEta ?? data.eta;
    if (data.etd) {
      const fmtEtd = formatDateTimeForDisplay(data.etd, data.timezone);
      deliveryDateStr += ` to ${fmtEtd ?? data.etd}`;
    }
  }

  // "For account of" line
  const vesselRef = `${data.vesselName}${data.vesselImo ? ` (IMO: ${data.vesselImo})` : ''}`;
  const vesselDisplay = data.vesselName.startsWith('MV ') ? vesselRef : `MV ${vesselRef}`;
  const forAccountParts = [`Master and/or owner and/or charterers and/or ${vesselDisplay}`];
  if (data.clientName) forAccountParts.push(`and/or ${data.clientName}`);

  // ── Header (3 columns: client | title | logo+date/ref) ───────────
  const header = (currentPage: number, pageCount: number): Content => {
    const rightStack: Content[] = [];
    // Logo
    if (data.companyLogoDataUrl) {
      rightStack.push({ image: data.companyLogoDataUrl, fit: [150, 50], alignment: 'right', margin: [0, 0, 0, 10] } as Content);
    }
    // Date / Ref — tabular so labels and values are column-aligned
    rightStack.push({
      table: {
        widths: ['*', 'auto'],
        body: [
          [{ text: 'Date:', bold: true, alignment: 'right', margin: [0, 0, 4, 0] }, { text: createdDate, alignment: 'right' }],
          [{ text: 'Ref.:', bold: true, alignment: 'right', margin: [0, 0, 4, 0] }, { text: refNum, alignment: 'right' }],
        ],
      },
      layout: {
        hLineWidth: () => 0,
        vLineWidth: () => 0,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 1,
        paddingBottom: () => 1,
      },
      fontSize: 10,
    } as Content);

    return {
      margin: [40, 30, 40, 0],
      columns: [
        { width: 200, stack: currentPage === 1 ? customerBlock : [{ text: '' }] },
        { width: '*', text: title, style: 'docTitle', alignment: 'center', margin: [10, 0, 10, 0] },
        { width: 200, stack: rightStack },
      ],
    } as Content;
  };

  // ── Footer (company details + page number) ────────────────────────
  const footerFn = (currentPage: number, pageCount: number) => {
    const leftTexts: Content[] = [
      { text: senderName, fontSize: 8, bold: true, color: '#374151' } as Content,
    ];
    if (data.companyAddress?.trim()) {
      for (const line of data.companyAddress.trim().split(/\n|,\s*/)) {
        const l = line.trim();
        if (l) leftTexts.push({ text: l, fontSize: 8, color: '#374151' } as Content);
      }
    }
    const middleTexts: Content[] = [];
    if (data.companyPhone?.trim()) {
      const display = formatPhoneDisplay(data.companyPhone) ?? data.companyPhone.trim();
      middleTexts.push({ text: `T ${display}`, fontSize: 8, color: '#374151', link: phoneToTelUri(data.companyPhone) } as Content);
    }
    if (data.companyEmail?.trim()) {
      middleTexts.push({ text: data.companyEmail.trim(), fontSize: 8, color: '#1a56db', link: `mailto:${data.companyEmail.trim()}` } as Content);
    }

    return {
      margin: [40, 0, 40, 20] as [number, number, number, number],
      stack: [
        { canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#9ca3af' }] },
        {
          columns: [
            { width: '*' as const, stack: leftTexts },
            { width: '*' as const, stack: middleTexts },
            { width: 'auto' as const, stack: [{ text: `${currentPage} / ${pageCount}`, fontSize: 8, color: '#374151', alignment: 'right' as const }] },
          ],
          margin: [0, 8, 0, 0] as [number, number, number, number],
        },
      ],
    };
  };

  // ── Document definition ───────────────────────────────────────────
  return {
    pageSize: 'A4',
    pageMargins: [40, 140, 40, 80],
    header,
    content: [
      // Intro text
      { text: 'With reference to our correspondence, we are pleased to confirm to you the following:', margin: [0, 16, 0, 16] } as Content,

      // Vessel / Delivery info (single-column stack)
      {
        stack: [
          {
            columns: [
              { width: 90, text: 'Vessel:', bold: true },
              { width: '*', text: `${data.vesselName}${data.vesselImo ? ` (IMO: ${data.vesselImo})` : ''}` },
            ],
          } as Content,
          {
            columns: [
              { width: 90, text: 'Delivery place:', bold: true },
              { width: '*', text: data.portName },
            ],
            margin: [0, 2, 0, 0],
          } as Content,
          ...(deliveryDateStr ? [{
            columns: [
              { width: 90, text: 'Delivery date:', bold: true },
              { width: '*', text: deliveryDateStr },
            ],
            margin: [0, 2, 0, 0],
          } as Content] : []),
        ],
        margin: [0, 0, 0, 14],
      } as Content,

      // Items table
      {
        table: {
          headerRows: 1,
          widths: ['*', 70, 35, 120],
          body: [tableHeader, ...tableRows],
        },
        layout: {
          hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
            i === 0 || i === 1 || i === node.table.body.length ? 1 : 0,
          vLineWidth: () => 0,
          hLineColor: () => '#111827',
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
      } as Content,
      { text: '', margin: [0, 16, 0, 0] } as Content,

      // For account of
      { text: [{ text: 'For account of:  ', bold: true }, { text: forAccountParts.join(' ') }], margin: [0, 0, 0, 4] } as Content,

      // Payment terms
      ...(data.paymentTerms
        ? [{ text: [{ text: 'Payment terms:  ', bold: true }, { text: data.paymentTerms }], margin: [0, 0, 0, 6] } as Content]
        : []),

      // Notes
      ...buildNotesSection({
        customerNote: data.customerNote,
        placeOrderRemark: data.placeOrderRemark,
        placeComment: data.placeComment,
        termsAndConditions: null,
        itemNotes: [],
      }),

      // Company terms (customer only)
      ...buildCompanyTermsSection({
        companyName: data.companyName,
        customerTerms: data.customerTerms,
        supplierTerms: null,
      }),

      // Sign-off (with optional QR code on the right)
      { text: '', margin: [0, 20, 0, 0] } as Content,
      ...(data.verifyUrl ? [{
        columns: [
          {
            width: '*',
            stack: [
              { text: 'Best regards', margin: [0, 0, 0, 6] } as Content,
              { text: senderName, bold: true, margin: [0, 0, 0, 2] } as Content,
              ...(data.fromName?.trim()
                ? [{ text: data.fromName.trim(), fontSize: 9 } as Content]
                : []),
              { text: '', margin: [0, 10, 0, 0] } as Content,
              ...(data.fromEmail?.trim()
                ? [emailTextNode('Direct Email:  ', data.fromEmail.trim(), { fontSize: 9 })]
                : []),
              ...(data.fromPhone?.trim()
                ? [phoneTextNode('Direct Phone:  ', data.fromPhone.trim(), { fontSize: 9 })]
                : []),
            ],
          },
          {
            width: 'auto',
            stack: [
              { image: data.verifyUrl, fit: [80, 80], alignment: 'right' } as Content,
              { text: 'Scan to verify', fontSize: 7, color: '#6b7280', alignment: 'center', margin: [0, 4, 0, 0] } as Content,
            ],
          },
        ],
      } as Content] : [
        { text: 'Best regards', margin: [0, 0, 0, 6] } as Content,
        { text: senderName, bold: true, margin: [0, 0, 0, 2] } as Content,
        ...(data.fromName?.trim()
          ? [{ text: data.fromName.trim(), fontSize: 9 } as Content]
          : []),
        { text: '', margin: [0, 10, 0, 0] } as Content,
        ...(data.fromEmail?.trim()
          ? [emailTextNode('Direct Email:  ', data.fromEmail.trim(), { fontSize: 9 })]
          : []),
        ...(data.fromPhone?.trim()
          ? [phoneTextNode('Direct Phone:  ', data.fromPhone.trim(), { fontSize: 9 })]
          : []),
      ]),
    ],
    footer: footerFn,
    styles: {
      docTitle: { fontSize: 16, bold: true, color: '#111827' },
      sectionLabel: { fontSize: 10, bold: true, color: '#111827', margin: [0, 0, 0, 4] },
      tableHeader: { fontSize: 9, bold: true },
    },
    defaultStyle: { fontSize: 10, font: 'Roboto' },
  };
}

/**
 * Generate an Offer PDF buffer for a given order ID.
 */
export async function generateOfferPdfBuffer(orderId: string): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  const order = await fetchOrderForInvoice(orderId);

  const companyLogoDataUrl = tryLoadLogoDataUrl(order.invoicingCompany?.logoUrl ?? null);

  const [latestPlaceComment] = await db
    .select({ content: entityComments.content })
    .from(entityComments)
    .where(and(eq(entityComments.entityType, 'place'), eq(entityComments.entityId, order.placeId)))
    .orderBy(desc(entityComments.createdAt))
    .limit(1);

  const docData = {
    orderNumber: order.orderNumber,
    clientName: order.client.name,
    clientCountry: order.client.country,
    clientAddress: order.client.headOfficeAddress ?? null,
    customerContactName: order.customerContact?.name ?? null,
    customerContactRole: order.customerContact?.role ?? null,
    customerContactPhone: order.customerContact?.phone ?? null,
    customerContactEmail: order.customerContact?.email ?? null,
    vesselName: order.vessel.name,
    vesselImo: order.vessel.imo,
    portName: order.place.name,
    eta: order.eta?.toISOString() ?? null,
    etd: order.etd?.toISOString() ?? null,
    timezone: order.place.timezone ?? null,
    fromName: order.salesRep?.name ?? null,
    fromEmail: order.salesRep?.email ?? null,
    fromPhone: order.salesRep?.phone ?? null,
    paymentTerms: formatCustomerPaymentTerms(order.customerPaymentTermType, order.customerCreditDays),
    customerNote: order.customerNote ?? null,
    placeOrderRemark: order.place?.orderRemark ?? null,
    placeComment: latestPlaceComment?.content ?? null,
    termsAndConditions: order.termsAndConditions ?? null,
    companyName: order.invoicingCompany?.name ?? null,
    companyAddress: order.invoicingCompany?.headOfficeAddress ?? null,
    companyPhone: order.invoicingCompany?.headOfficePhone ?? null,
    companyEmail: order.invoicingCompany?.headOfficeEmail ?? null,
    companyWebsite: order.invoicingCompany?.website ?? null,
    companyLogoDataUrl,
    customerTerms: order.invoicingCompany?.customerTerms ?? null,
    supplierTerms: order.invoicingCompany?.supplierTerms ?? null,
    itemNotes: order.items
      .filter((item) => item.customerNote)
      .map((item) => ({
        label: item.productType,
        note: String(item.customerNote),
      })),
    currency: order.currency ?? 'USD',
    items: order.items.map((item) => ({
      productType: item.productType,
      description: item.description,
      quantity: item.quantity,
      quantityMin: item.quantityMin,
      quantityMax: item.quantityMax,
      unit: item.unit,
      salesPrice: item.salesPrice,
    })),
    createdAt: new Date(),
    verifyUrl: null as string | null,
  };

  // QR code removed from offers — only shown on invoices and proforma invoices

  const docDefinition = buildOfferDocument(docData);
  const buffer = await createPdfBuffer(docDefinition);
  const fileName = `Offer_${order.orderNumber ?? orderId.slice(0, 8)}.pdf`;

  return { buffer, fileName };
}

// ═══════════════════════════════════════════════════════════════════════
//  Proforma Invoice PDF
// ═══════════════════════════════════════════════════════════════════════

function buildProformaDocument(data: {
  orderNumber: string | null;
  clientName: string;
  clientCountry: string | null;
  clientAddress: string | null;
  customerContactName: string | null;
  customerContactRole: string | null;
  customerContactPhone: string | null;
  customerContactEmail: string | null;
  vesselName: string;
  vesselImo: string | null;
  portName: string;
  eta: string | null;
  etd: string | null;
  timezone: string | null;
  currency: string;
  fromName: string | null;
  fromEmail: string | null;
  fromPhone: string | null;
  paymentTerms: string | null;
  customerNote: string | null;
  placeOrderRemark: string | null;
  placeComment: string | null;
  termsAndConditions: string | null;
  companyName: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  companyWebsite: string | null;
  companyLogoDataUrl: string | null;
  customerTerms: string | null;
  supplierTerms: string | null;
  itemNotes: Array<{ label: string; note: string }>;
  items: Array<{
    productType: string;
    description: string | null;
    quantity: string;
    unit: string;
    salesPrice: string | null;
  }>;
  createdAt: Date;
  verifyUrl?: string | null;
  verifyLink?: string | null;
  fraudPreventionText?: string | null;
}): TDocumentDefinitions {
  // ── Prepare data ──────────────────────────────────────────────────
  const refNum = data.orderNumber ?? 'DRAFT';
  const senderName = data.companyName?.trim() || 'Fueld Trading';
  const dd2 = String(data.createdAt.getUTCDate()).padStart(2, '0');
  const mm2 = String(data.createdAt.getUTCMonth() + 1).padStart(2, '0');
  const yyyy2 = data.createdAt.getUTCFullYear();
  const createdDate = `${dd2}-${mm2}-${yyyy2}`;

  // Customer address block (top-left)
  const customerBlock: Content[] = [
    { text: data.clientName, fontSize: 10 } as Content,
  ];
  if (data.customerContactName?.trim()) {
    const role = data.customerContactRole?.trim();
    customerBlock.push({ text: `Att:${data.customerContactName.trim()}${role ? ` (${role})` : ''}`, fontSize: 10 } as Content);
  }
  // Client address — split commas and newlines into separate lines
  const clientAddr = data.clientAddress?.trim();
  if (clientAddr) {
    const lines = clientAddr.split(/\n|,\s*/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      customerBlock.push({ text: line, fontSize: 10 } as Content);
    }
  } else if (data.clientCountry?.trim()) {
    customerBlock.push({ text: data.clientCountry.trim(), fontSize: 10 } as Content);
  }

  // Items table (with totals for confirmation/nomination)
  const tableHeader: TableCell[] = [
    { text: 'Product', style: 'tableHeader' },
    { text: 'Quantity', style: 'tableHeader', alignment: 'right' },
    { text: 'Unit', style: 'tableHeader' },
    { text: 'Price', style: 'tableHeader', alignment: 'right' },
  ];

  const tableRows: TableCell[][] = data.items.map((item) => {
    const productCell: Content = item.description?.trim()
      ? { text: [{ text: item.productType }, { text: `  ${item.description.trim()}`, fontSize: 8, color: '#374151' }] }
      : { text: item.productType };
    return [
      productCell as TableCell,
      { text: formatNumber(item.quantity, 3), alignment: 'right' },
      { text: item.unit },
      { text: `${data.currency}/${item.unit}  ${formatNumber(item.salesPrice)}`, alignment: 'right' },
    ];
  });

  // Delivery date string
  let deliveryDateStr = '';
  if (data.eta) {
    const fmtEta = formatDateTimeForDisplay(data.eta, data.timezone);
    deliveryDateStr = fmtEta ?? data.eta;
    if (data.etd) {
      const fmtEtd = formatDateTimeForDisplay(data.etd, data.timezone);
      deliveryDateStr += ` to ${fmtEtd ?? data.etd}`;
    }
  }

  // "For account of" line (like reference PDF)
  const vesselRef = `${data.vesselName}${data.vesselImo ? ` (IMO: ${data.vesselImo})` : ''}`;
  const vesselDisplay = data.vesselName.startsWith('MV ') ? vesselRef : `MV ${vesselRef}`;
  const forAccountParts = [`Master and/or owner and/or charterers and/or ${vesselDisplay}`];
  if (data.clientName) forAccountParts.push(`and/or ${data.clientName}`);

  // ── Header (3 columns: client | title | logo+date/ref) ────────────
  const header = (currentPage: number, _pageCount: number): Content => {
    const rightStack: Content[] = [];
    if (data.companyLogoDataUrl) {
      rightStack.push({ image: data.companyLogoDataUrl, fit: [150, 50], alignment: 'right', margin: [0, 0, 0, 10] } as Content);
    }
    // Date / Ref — tabular so labels and values are column-aligned
    rightStack.push({
      table: {
        widths: ['*', 'auto'],
        body: [
          [{ text: 'Date:', bold: true, alignment: 'right', margin: [0, 0, 4, 0] }, { text: createdDate, alignment: 'right' }],
          [{ text: 'Ref.:', bold: true, alignment: 'right', margin: [0, 0, 4, 0] }, { text: refNum, alignment: 'right' }],
        ],
      },
      layout: {
        hLineWidth: () => 0,
        vLineWidth: () => 0,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 1,
        paddingBottom: () => 1,
      },
      fontSize: 10,
    } as Content);

    return {
      margin: [40, 30, 40, 0],
      columns: [
        { width: 150, stack: currentPage === 1 ? customerBlock : [{ text: '' }] },
        { width: '*', text: 'PROFORMA INVOICE', style: 'docTitle', alignment: 'center', margin: [10, 0, 10, 0], noWrap: true },
        { width: 150, stack: rightStack },
      ],
    } as Content;
  };

  // ── Footer (company details + page number) ────────────────────────
  const footerFn = (currentPage: number, pageCount: number) => {
    const leftTexts: Content[] = [
      { text: senderName, fontSize: 8, bold: true, color: '#374151' } as Content,
    ];
    if (data.companyAddress?.trim()) {
      for (const line of data.companyAddress.trim().split(/\n|,\s*/)) {
        const l = line.trim();
        if (l) leftTexts.push({ text: l, fontSize: 8, color: '#374151' } as Content);
      }
    }
    const middleTexts: Content[] = [];
    if (data.companyPhone?.trim()) {
      const display = formatPhoneDisplay(data.companyPhone) ?? data.companyPhone.trim();
      middleTexts.push({ text: `T ${display}`, fontSize: 8, color: '#374151', link: phoneToTelUri(data.companyPhone) } as Content);
    }
    if (data.companyEmail?.trim()) {
      middleTexts.push({ text: data.companyEmail.trim(), fontSize: 8, color: '#1a56db', link: `mailto:${data.companyEmail.trim()}` } as Content);
    }

    return {
      margin: [40, 0, 40, 20] as [number, number, number, number],
      stack: [
        { canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#9ca3af' }] },
        {
          columns: [
            { width: '*' as const, stack: leftTexts },
            { width: '*' as const, stack: middleTexts },
            { width: 'auto' as const, stack: [{ text: `${currentPage} / ${pageCount}`, fontSize: 8, color: '#374151', alignment: 'right' as const }] },
          ],
          margin: [0, 8, 0, 0] as [number, number, number, number],
        },
      ],
    };
  };

  // ── Document definition ───────────────────────────────────────────
  return {
    pageSize: 'A4',
    pageMargins: [40, 140, 40, 80],
    header,
    content: [
      // Intro text
      { text: 'With reference to our correspondence, we are pleased to confirm to you the following:', margin: [0, 16, 0, 16] } as Content,

      // Vessel / Delivery info (single-column stack)
      {
        stack: [
          {
            columns: [
              { width: 90, text: 'Vessel:', bold: true },
              { width: '*', text: vesselRef },
            ],
          } as Content,
          {
            columns: [
              { width: 90, text: 'Delivery place:', bold: true },
              { width: '*', text: data.portName },
            ],
            margin: [0, 2, 0, 0],
          } as Content,
          ...(deliveryDateStr ? [{
            columns: [
              { width: 90, text: 'Delivery date:', bold: true },
              { width: '*', text: deliveryDateStr },
            ],
            margin: [0, 2, 0, 0],
          } as Content] : []),
        ],
        margin: [0, 0, 0, 14],
      } as Content,

      // Items table
      {
        table: {
          headerRows: 1,
          widths: ['*', 70, 35, 120],
          body: [tableHeader, ...tableRows],
        },
        layout: {
          hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
            i === 0 || i === 1 || i === node.table.body.length ? 1 : 0,
          vLineWidth: () => 0,
          hLineColor: () => '#111827',
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
      } as Content,
      { text: '', margin: [0, 16, 0, 0] } as Content,

      // For account of
      { text: [{ text: 'For account of:  ', bold: true }, { text: forAccountParts.join(' ') }], margin: [0, 0, 0, 4] } as Content,

      // Payment terms
      ...(data.paymentTerms
        ? [{ text: [{ text: 'Payment terms:  ', bold: true }, { text: data.paymentTerms.replace(/_/g, ' ') }], margin: [0, 0, 0, 6] } as Content]
        : []),

      // Notes
      ...buildNotesSection({
        customerNote: data.customerNote,
        placeOrderRemark: data.placeOrderRemark,
        placeComment: data.placeComment,
        termsAndConditions: data.termsAndConditions,
        itemNotes: data.itemNotes,
      }),

      // Company terms
      ...buildCompanyTermsSection({
        companyName: data.companyName,
        customerTerms: data.customerTerms,
        supplierTerms: null,
      }),

      // ── Fraud Prevention ──
      ...(data.fraudPreventionText ? [
        { text: '', margin: [0, 10, 0, 0] } as Content,
        { text: 'FRAUD PREVENTION', fontSize: 9, bold: true, margin: [0, 0, 0, 4] } as Content,
        { text: data.fraudPreventionText, fontSize: 8, color: '#374151', margin: [0, 0, 0, 0] } as Content,
      ] : []),

      // Sign-off (with optional QR code on the right)
      { text: '', margin: [0, 20, 0, 0] } as Content,
      ...(data.verifyUrl ? [{
        columns: [
          {
            width: '*',
            stack: [
              { text: 'Best regards', margin: [0, 0, 0, 6] } as Content,
              { text: senderName, bold: true, margin: [0, 0, 0, 2] } as Content,
              ...(data.fromName?.trim()
                ? [{ text: data.fromName.trim(), fontSize: 9 } as Content]
                : []),
              { text: '', margin: [0, 10, 0, 0] } as Content,
              ...(data.fromEmail?.trim()
                ? [emailTextNode('Direct Email:  ', data.fromEmail.trim(), { fontSize: 9 })]
                : []),
              ...(data.fromPhone?.trim()
                ? [phoneTextNode('Direct Phone:  ', data.fromPhone.trim(), { fontSize: 9 })]
                : []),
            ],
          },
          {
            width: 'auto',
            stack: [
              { image: data.verifyUrl, fit: [80, 80], alignment: 'right', link: data.verifyLink ?? undefined } as Content,
              { text: 'Scan or click to verify', fontSize: 7, color: '#1a56db', alignment: 'center', margin: [0, 4, 0, 0], link: data.verifyLink ?? undefined } as Content,
              ...(data.verifyLink ? [
                { text: `Verify domain: ${new URL(data.verifyLink).hostname}`, fontSize: 6, color: '#6b7280', alignment: 'center', margin: [0, 2, 0, 0] } as Content,
              ] : []),
            ],
          },
        ],
      } as Content] : [
        { text: 'Best regards', margin: [0, 0, 0, 6] } as Content,
        { text: senderName, bold: true, margin: [0, 0, 0, 2] } as Content,
        ...(data.fromName?.trim()
          ? [{ text: data.fromName.trim(), fontSize: 9 } as Content]
          : []),
        { text: '', margin: [0, 10, 0, 0] } as Content,
        ...(data.fromEmail?.trim()
          ? [emailTextNode('Direct Email:  ', data.fromEmail.trim(), { fontSize: 9 })]
          : []),
        ...(data.fromPhone?.trim()
          ? [phoneTextNode('Direct Phone:  ', data.fromPhone.trim(), { fontSize: 9 })]
          : []),
      ]),
    ],
    footer: footerFn,
    styles: {
      docTitle: { fontSize: 16, bold: true, color: '#111827' },
      sectionLabel: { fontSize: 10, bold: true, color: '#111827', margin: [0, 0, 0, 4] },
      tableHeader: { fontSize: 9, bold: true },
    },
    defaultStyle: { fontSize: 10, font: 'Roboto' },
  };
}

/**
 * Generate a Proforma Invoice PDF buffer for a given order ID.
 */
export async function generateProformaInvoicePdfBuffer(orderId: string): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  const order = await fetchOrderForInvoice(orderId);

  const companyLogoDataUrl = tryLoadLogoDataUrl(order.invoicingCompany?.logoUrl ?? null);

  const [latestPlaceComment] = await db
    .select({ content: entityComments.content })
    .from(entityComments)
    .where(and(eq(entityComments.entityType, 'place'), eq(entityComments.entityId, order.placeId)))
    .orderBy(desc(entityComments.createdAt))
    .limit(1);

  const paymentTerms = formatCustomerPaymentTerms(
    order.customerPaymentTermType,
    order.customerCreditDays,
  );

  const docData = {
    orderNumber: order.orderNumber,
    clientName: order.client.name,
    clientCountry: order.client.country,
    clientAddress: order.client.headOfficeAddress ?? null,
    customerContactName: order.customerContact?.name ?? null,
    customerContactRole: order.customerContact?.role ?? null,
    customerContactPhone: order.customerContact?.phone ?? null,
    customerContactEmail: order.customerContact?.email ?? null,
    vesselName: order.vessel.name,
    vesselImo: order.vessel.imo,
    portName: order.place.name,
    eta: order.eta?.toISOString() ?? null,
    etd: order.etd?.toISOString() ?? null,
    timezone: order.place.timezone ?? null,
    currency: order.currency ?? 'USD',
    fromName: order.salesRep?.name ?? null,
    fromEmail: order.salesRep?.email ?? null,
    fromPhone: order.salesRep?.phone ?? null,
    paymentTerms,
    customerNote: order.customerNote ?? null,
    placeOrderRemark: order.place?.orderRemark ?? null,
    placeComment: latestPlaceComment?.content ?? null,
    termsAndConditions: order.termsAndConditions ?? null,
    companyName: order.invoicingCompany?.name ?? null,
    companyAddress: order.invoicingCompany?.headOfficeAddress ?? null,
    companyPhone: order.invoicingCompany?.headOfficePhone ?? null,
    companyEmail: order.invoicingCompany?.headOfficeEmail ?? null,
    companyWebsite: order.invoicingCompany?.website ?? null,
    companyLogoDataUrl,
    customerTerms: order.invoicingCompany?.customerTerms ?? null,
    supplierTerms: order.invoicingCompany?.supplierTerms ?? null,
    itemNotes: order.items
      .filter((item) => item.customerNote)
      .map((item) => ({
        label: item.productType,
        note: String(item.customerNote),
      })),
    items: order.items.map((item) => ({
      productType: item.productType,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      salesPrice: item.salesPrice,
    })),
    createdAt: new Date(),
    verifyUrl: null as string | null,
    verifyLink: null as string | null,
    fraudPreventionText: order.invoicingCompany?.fraudPreventionText ?? null,
  };

  // Generate QR code verification URL
  const appUrl = process.env['APP_URL'] || 'http://localhost:4200';
  const verifyLink = `${appUrl}/verify/${orderId}/proforma-invoice`;
  try {
    docData.verifyUrl = await QRCode.toDataURL(verifyLink, { width: 160, margin: 1 });
    docData.verifyLink = verifyLink;
  } catch { /* QR generation failed — continue without */ }

  const docDefinition = buildProformaDocument(docData);
  const buffer = await createPdfBuffer(docDefinition);
  const fileName = `Nomination_${order.orderNumber ?? orderId.slice(0, 8)}.pdf`;

  return { buffer, fileName };
}
