// ═══════════════════════════════════════════════════════════════════════
//  Document PDF Generators — PDF document definitions (invoice, offer,
//  proforma invoice, nomination) using pdfmake.
// ═══════════════════════════════════════════════════════════════════════

import pdfmake from 'pdfmake';
import vfsFonts from 'pdfmake/build/vfs_fonts.js';
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { db } from '../../db';
import { bankAccounts, orders, orderItems, counterparties, vessels, places, invoices, users, priceReferences, tenants } from '../../db/schema';
import type { TenantSettings } from '../../db/schema';
import QRCode from "qrcode";
import { createPdfBuffer, phoneTextNode, emailTextNode, buildOfferForAccountOfText, buildNotesSection } from './document-pdf.service';
import {
  getCompanyRegistrationNumber, loadBankDetails, tryLoadLogoDataUrl,
  formatCustomerPaymentTerms, formatStoredDateOnlyForDisplay,
  formatNumber, formatNumberCompact, normalizeCountryName, countryAlreadyInAddress,
  formatPhoneDisplay, splitAddressLines, formatIssuedAtUtc,
} from './document-utils.service';
import { createDocumentRevision, getRevisionAbsolutePath, mapRevisionInfo } from './document-revision.service';
import {
  getDateFormatSettings, getCostSalesDecimalPrecision,
} from '../admin/settings.service';
import {
  getPublicApiBaseUrl,
  phoneToTelUri,
} from './document-utils.service';
import {
  fetchInvoiceData,
  fetchOrderForInvoice,
  loadOrderBankDetails,
  maxMs,
  maxItemUpdatedAtMs,
  persistDocumentRevision,
  overwriteDocumentRevisionArtifact,
  getLatestDocumentRevisionByStream,
  loadDocumentRevisionBuffer,
  trimTrailingSlash,
  sanitizePathSegment,
  documentTypePrefix,
  buildVerificationRef,
  resolveDocumentStreamTarget,
  buildDocumentStreamKey,
  toMs,
  parseTimezoneOffset,
  replaceCompanyNamePlaceholder,
  buildOfferDocument,
  computeDueDate,
  formatDateTimeForDisplay,
} from './document.service';
import type { DocumentRevisionInfo, BankDetails, DocumentPrintMeta, DocumentType } from './document.types';
import { DEFAULT_BANK_DETAILS } from './document.types';

const pdfmakeVfs = (pdfmake as any)?.virtualfs;
if (pdfmakeVfs && typeof pdfmakeVfs.writeFileSync === 'function') {
  for (const [fontFileName, base64Data] of Object.entries(vfsFonts as Record<string, string>)) {
    pdfmakeVfs.writeFileSync(fontFileName, base64Data, 'base64');
  }
}

pdfmake.setFonts({
  Roboto: {
    normal: 'Roboto-Regular.ttf',
    bold: 'Roboto-Medium.ttf',
    italics: 'Roboto-Italic.ttf',
    bolditalics: 'Roboto-MediumItalic.ttf',
  },
});

export function buildInvoiceDocument(data: {
  invoiceNumber: string;
  orderNumber?: string | null;
  dueDate: string;
  clientName: string;
  clientCountry: string | null;
  clientAddress?: string | null;
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
    priceUnit?: string;
    salesPrice: string | null;
    costPrice: string | null;
  }>;
  totalAmount: string | null;
  bank: BankDetails;
  createdAt: Date;
  companyName: string | null;
  vatNumber: string | null;
  companyRegistrationNumber: string | null;
  fraudPreventionText: string | null;
  latePaymentInterest: string | null;
  verifyUrl?: string | null;
  verifyLink?: string | null;
  companyLogoDataUrl: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  printMeta?: DocumentPrintMeta | null;
  purchaseOrderNumber?: string | null;
  dateFormat?: string | null;
  costSalesDecimalPrecision?: number | null;
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
      { text: formatNumberCompact(item.quantity, 3), alignment: 'right' },
      { text: item.unit },
      { text: formatNumber(item.salesPrice, 2, data.costSalesDecimalPrecision ?? undefined), alignment: 'right' },
      { text: formatNumber(String(lineTotal), 2), alignment: 'right' },
    ];
  });

  // Grand total
  const grandTotal = data.items.reduce((sum, item) => {
    const qty = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.salesPrice ?? '0') || 0;
    return sum + qty * price;
  }, 0);
  const totalAmountDueLabel = `Total amount due to ${data.companyName?.trim() || 'Company'}`;

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
              ...(data.purchaseOrderNumber?.trim() ? [
                { text: `PO: ${data.purchaseOrderNumber.trim()}`, style: 'invoiceNumber', color: '#374151' } as Content,
              ] : []),
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
            stack: (() => {
              const billTo: Content[] = [
                { text: 'Bill To:', style: 'sectionLabel' } as Content,
                { text: data.clientName, style: 'clientName' } as Content,
              ];
              const invAddr = data.clientAddress?.trim();
              if (invAddr) {
                const addrLines = splitAddressLines(invAddr);
                for (const line of addrLines) billTo.push({ text: line, color: '#666666' } as Content);
                if (data.clientCountry?.trim() && !countryAlreadyInAddress(addrLines, data.clientCountry)) {
                  billTo.push({ text: data.clientCountry.trim(), color: '#666666' } as Content);
                }
              } else if (data.clientCountry) {
                billTo.push({ text: data.clientCountry, color: '#666666' } as Content);
              }
              return billTo;
            })(),
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
      { text: '', margin: [0, 22, 0, 0] } as Content,

      // ── Vessel Info ──
      {
        columns: [
          { width: '50%', text: `Vessel: ${data.vesselName}${data.vesselImo ? ` (IMO: ${data.vesselImo})` : ''}`, style: 'vesselInfo' },
          { width: '50%', text: `Port: ${data.portName}`, style: 'vesselInfo', alignment: 'right' },
        ],
      } as Content,
      { text: '', margin: [0, 10, 0, 0] } as Content,

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

      {
        columns: [
          { width: '*', text: totalAmountDueLabel, bold: true },
          { width: 'auto', text: `${formatNumber(String(grandTotal), 2)} USD`, bold: true, alignment: 'right' },
        ],
        margin: [0, 6, 0, 0],
      } as Content,

      // ── Notes / Payment Terms ── (removed — not needed on invoices)

      // ── Divider ──
      { text: '', margin: [0, 4, 0, 0] } as Content,
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e5e7eb' }],
      } as Content,
      { text: '', margin: [0, 6, 0, 0] } as Content,

      // ── Bank Details ──
      { text: 'REMITTANCE INSTRUCTIONS', style: 'sectionLabel' } as Content,
      { text: 'Payment to be effected, free of all charges to us, by telegraphic transfer to:', fontSize: 9, margin: [0, 2, 0, 6] } as Content,
      { text: `Please include Order Ref ${data.orderNumber ?? data.invoiceNumber} in the transfer message/note.`, fontSize: 9, margin: [0, 0, 0, 6] } as Content,
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
      ...(data.bank.sortCode ? [{
        columns: [
          { width: '25%', text: 'Sort Code:', bold: true },
          { width: '75%', text: data.bank.sortCode },
        ],
        margin: [0, 2, 0, 0],
      } as Content] : []),
      ...(data.bank.routingNumber ? [{
        columns: [
          { width: '25%', text: 'Routing No:', bold: true },
          { width: '75%', text: data.bank.routingNumber },
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
      ...(data.latePaymentInterest ? [{
        text: `Note : Late payment charged @ ${data.latePaymentInterest} interest, per month pro rata.`,
        fontSize: 8, color: '#b91c1c', bold: true,
        decoration: 'underline' as const,
        margin: [0, 10, 0, 0],
      } as Content] : []),

      // ── Fraud Prevention + QR (2-column) ──
      ...((data.fraudPreventionText || data.verifyUrl) ? [
        { text: '', margin: [0, 10, 0, 0] } as Content,
        {
          columns: [
            {
              width: '*',
              stack: [
                ...(data.fraudPreventionText ? [
                  { text: 'FRAUD PREVENTION', fontSize: 9, bold: true, margin: [0, 0, 0, 4] } as Content,
                  { text: data.fraudPreventionText, fontSize: 8, color: '#374151', margin: [0, 0, 10, 0] } as Content,
                ] : []),
              ],
            },
            {
              width: 'auto',
              stack: [
                ...(data.verifyUrl ? [
                  { image: data.verifyUrl, fit: [80, 80], alignment: 'right', link: data.verifyLink ?? undefined } as Content,
                  { text: 'Scan or click to verify', fontSize: 7, color: '#1a56db', alignment: 'center', margin: [0, 4, 0, 0], link: data.verifyLink ?? undefined } as Content,
                  ...(data.verifyLink ? [
                    { text: `Verify domain: ${new URL(data.verifyLink).hostname}`, fontSize: 6, color: '#6b7280', alignment: 'center', margin: [0, 2, 0, 0] } as Content,
                  ] : []),
                ] : []),
              ],
            },
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
        for (const line of splitAddressLines(data.companyAddress)) {
          leftTexts.push({ text: line, fontSize: 8, color: '#374151' } as Content);
        }
      }
      const middleTexts: Content[] = [];
      if (data.companyPhone?.trim()) {
        const display = formatPhoneDisplay(data.companyPhone) ?? data.companyPhone.trim();
        middleTexts.push({ text: `Phone No : ${display}`, fontSize: 8, color: '#1a56db', link: phoneToTelUri(data.companyPhone) } as Content);
      }
      if (data.companyEmail?.trim()) {
        middleTexts.push({ text: `Email : ${data.companyEmail.trim()}`, fontSize: 8, color: '#1a56db', link: `mailto:${data.companyEmail.trim()}` } as Content);
      }
      if (data.companyRegistrationNumber?.trim()) {
        middleTexts.push({ text: `Reg. No : ${data.companyRegistrationNumber.trim()}`, fontSize: 8, color: '#374151' } as Content);
      }
      if (data.vatNumber?.trim()) {
        middleTexts.push({ text: `VAT No : ${data.vatNumber.trim()}`, fontSize: 8, color: '#374151' } as Content);
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
          ...(data.printMeta ? [{
            text: `Issued (UTC): ${formatIssuedAtUtc(data.printMeta.issuedAt, data.dateFormat ?? undefined)}   Revision: ${data.printMeta.revisionNumber}   Ref: ${data.printMeta.verificationRef}   Fingerprint: ${data.printMeta.fingerprintShort}`,
            fontSize: 7,
            color: '#6b7280',
            alignment: 'center',
            margin: [0, 16, 0, 0] as [number, number, number, number],
          } as Content] : []),
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
  const { dateFormat } = await getDateFormatSettings();
  const { precision: costSalesDecimalPrecision } = await getCostSalesDecimalPrecision();

  const bank = await loadOrderBankDetails(order.bankAccountId, order.invoicingCompanyId);

  // QR code verification
  let verifyUrl: string | null = null;
  const verifyLink = `${getPublicApiBaseUrl()}/verify/${order.id}/invoice`;
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

  // Resolve price reference names for formula-priced items
  const invRefIds = new Set<string>();
  for (const item of order.items) {
    if (item.salesReferenceId) invRefIds.add(item.salesReferenceId);
  }
  const invRefNameMap = new Map<string, string>();
  if (invRefIds.size > 0) {
    const refs = await db.select({ id: priceReferences.id, name: priceReferences.name })
      .from(priceReferences)
      .where(inArray(priceReferences.id, [...invRefIds]));
    for (const r of refs) invRefNameMap.set(r.id, r.name);
  }

  const docData = {
    orderNumber: order.orderNumber ?? null,
    clientName: order.client.name,
    clientCountry: order.client.country,
    clientAddress: order.client.headOfficeAddress ?? null,
    customerContactName: null,
    customerContactRole: null,
    customerContactPhone: null,
    customerContactEmail: null,
    vesselName: order.vessel.name,
    vesselImo: order.vessel.imo,
    portName: order.place.name,
    eta: order.eta?.toISOString() ?? null,
    etd: order.etd?.toISOString() ?? null,
    timezone: order.place.timezone ?? null,
    dateFormat: dateFormat,
    costSalesDecimalPrecision: costSalesDecimalPrecision,
    currency: order.currency ?? 'USD',
    fromName: order.salesRep?.name ?? null,
    fromEmail: order.salesRep?.email ?? null,
    fromPhone: order.salesRep?.phone ?? null,
    paymentTerms: formatCustomerPaymentTerms(order.customerPaymentTermType, order.customerCreditDays),
    customerNote: order.customerNote ?? null,
    purchaseOrderNumber: order.purchaseOrderNumber ?? null,
    termsAndConditions: order.termsAndConditions ?? null,
    placeRemark: order.placeRemark ?? order.place.orderRemark ?? null,
    companyName: order.invoicingCompany?.name ?? null,
    companyAddress: order.invoicingCompany?.headOfficeAddress ?? null,
    companyPhone: order.invoicingCompany?.headOfficePhone ?? null,
    companyEmail: order.invoicingCompany?.headOfficeEmail ?? null,
    companyRegistrationNumber: getCompanyRegistrationNumber(order.invoicingCompany),
    companyWebsite: order.invoicingCompany?.website ?? null,
    companyLogoDataUrl,
    itemNotes: order.items
      .filter((item) => item.customerNote)
      .map((item) => ({
        label: item.productType,
        note: String(item.customerNote),
      })),
    items: order.items.map((item) => ({
      productType: item.productType,
      description: item.description,
      quantity: item.deliveredQuantity ?? item.quantity,
      unit: item.unit,
      priceUnit: item.salesUnit ?? item.unit,
      salesPrice: item.salesPrice,
      salesPricingModel: item.salesPricingModel,
      salesReferenceName: item.salesReferenceId ? (invRefNameMap.get(item.salesReferenceId) ?? null) : null,
      salesPremium: item.salesPremium,
      salesBarging: item.salesBarging,
      salesBargingUnit: item.salesBargingUnit,
      salesCreditDays: item.salesCreditDays,
      salesPriceFinalized: item.salesPriceFinalized,
    })),
    createdAt: invoice.createdAt,
    verifyUrl,
    verifyLink,
    fraudPreventionText: order.invoicingCompany?.fraudPreventionText ?? null,
    bank,
    vatNumber: order.invoicingCompany?.vatNumber ?? null,
    latePaymentInterest: order.invoicingCompany?.latePaymentInterest ?? null,
    docTitle: 'INVOICE',
  };

  const docDefinition = buildProformaDocument(docData);
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
  revision: DocumentRevisionInfo;
}> {
  const order = await fetchOrderForInvoice(orderId);
  const { dateFormat } = await getDateFormatSettings();
  const { precision: costSalesDecimalPrecision } = await getCostSalesDecimalPrecision();

  // Find the first invoice or generate a preview number
  const invoice = order.invoices?.[0];
  const existingRevision = await getLatestDocumentRevisionByStream({
    documentType: 'INVOICE',
    orderId: order.id,
    invoiceId: invoice?.id ?? null,
  });

  const invoiceSourceUpdatedAtMs = maxMs([
    order.updatedAt,
    order.client.updatedAt,
    order.vessel.updatedAt,
    order.place.updatedAt,
    order.invoicingCompany?.updatedAt ?? null,
    order.salesRep?.updatedAt ?? null,
    invoice?.updatedAt ?? invoice?.createdAt ?? null,
    order.customerContact?.updatedAt ?? null,
    order.supplierContact?.updatedAt ?? null,
  ]);
  const itemSourceUpdatedAtMs = maxItemUpdatedAtMs(order.items);
  const sourceUpdatedAtMs = Math.max(invoiceSourceUpdatedAtMs, itemSourceUpdatedAtMs);

  if (existingRevision && sourceUpdatedAtMs <= existingRevision.issuedAt.getTime()) {
    const existingBuffer = loadDocumentRevisionBuffer(existingRevision);
    const existingInvoiceNumber = invoice?.invoiceNumber ?? `PREVIEW-${orderId.slice(0, 8).toUpperCase()}`;
    const existingFileName = `Fueld_Invoice_${existingInvoiceNumber.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`;
    return {
      buffer: existingBuffer,
      invoiceNumber: existingInvoiceNumber,
      fileName: existingFileName,
      revision: existingRevision,
    };
  }

  const invoiceNumber = invoice?.invoiceNumber ?? `PREVIEW-${orderId.slice(0, 8).toUpperCase()}`;

  const bank = await loadOrderBankDetails(order.bankAccountId, order.invoicingCompanyId);

  // QR code verification
  let verifyUrl: string | null = null;
  const verifyLink = `${getPublicApiBaseUrl()}/verify/${orderId}/invoice`;
  try {
    verifyUrl = await QRCode.toDataURL(verifyLink, { width: 160, margin: 1 });
  } catch { /* QR generation failed — continue without */ }

  // Company logo
  const companyLogoDataUrl = tryLoadLogoDataUrl(order.invoicingCompany?.logoUrl ?? null);

  // Resolve price reference names for formula-priced items
  const invoiceRefIds = new Set<string>();
  for (const item of order.items) {
    if (item.salesReferenceId) invoiceRefIds.add(item.salesReferenceId);
  }
  const invoiceRefNameMap = new Map<string, string>();
  if (invoiceRefIds.size > 0) {
    const refs = await db.select({ id: priceReferences.id, name: priceReferences.name })
      .from(priceReferences)
      .where(inArray(priceReferences.id, [...invoiceRefIds]));
    for (const r of refs) invoiceRefNameMap.set(r.id, r.name);
  }

  const docData = {
    orderNumber: order.orderNumber ?? null,
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
    dateFormat: dateFormat,
    costSalesDecimalPrecision: costSalesDecimalPrecision,
    currency: order.currency ?? 'USD',
    fromName: order.salesRep?.name ?? null,
    fromEmail: order.salesRep?.email ?? null,
    fromPhone: order.salesRep?.phone ?? null,
    paymentTerms: formatCustomerPaymentTerms(order.customerPaymentTermType, order.customerCreditDays),
    dueDate: computeDueDate(
      invoice?.createdAt ?? order.createdAt,
      order.customerPaymentTermType,
      order.customerCreditDays,
      order.eta,
    ),
    customerNote: order.customerNote ?? null,
    purchaseOrderNumber: order.purchaseOrderNumber ?? null,
    termsAndConditions: order.termsAndConditions ?? null,
    placeRemark: order.placeRemark ?? order.place.orderRemark ?? null,
    companyName: order.invoicingCompany?.name ?? null,
    companyAddress: order.invoicingCompany?.headOfficeAddress ?? null,
    companyPhone: order.invoicingCompany?.headOfficePhone ?? null,
    companyEmail: order.invoicingCompany?.headOfficeEmail ?? null,
    companyRegistrationNumber: getCompanyRegistrationNumber(order.invoicingCompany),
    companyWebsite: order.invoicingCompany?.website ?? null,
    companyLogoDataUrl,
    itemNotes: order.items
      .filter((item) => item.customerNote)
      .map((item) => ({
        label: item.productType,
        note: String(item.customerNote),
      })),
    items: order.items.map((item) => ({
      productType: item.productType,
      description: item.description,
      quantity: item.deliveredQuantity ?? item.quantity,
      unit: item.unit,
      priceUnit: item.salesUnit ?? item.unit,
      salesPrice: item.salesPrice,
      salesPricingModel: item.salesPricingModel,
      salesReferenceName: item.salesReferenceId ? (invoiceRefNameMap.get(item.salesReferenceId) ?? null) : null,
      salesPremium: item.salesPremium,
      salesBarging: item.salesBarging,
      salesBargingUnit: item.salesBargingUnit,
      salesCreditDays: item.salesCreditDays,
      salesPriceFinalized: item.salesPriceFinalized,
    })),
    createdAt: invoice?.createdAt ?? order.createdAt,
    verifyUrl,
    verifyLink,
    fraudPreventionText: order.invoicingCompany?.fraudPreventionText ?? null,
    bank,
    vatNumber: order.invoicingCompany?.vatNumber ?? null,
    latePaymentInterest: order.invoicingCompany?.latePaymentInterest ?? null,
    docTitle: 'INVOICE',
    printMeta: null as DocumentPrintMeta | null,
  };

  const docDefinition = buildProformaDocument(docData);
  const buffer = await createPdfBuffer(docDefinition);
  const fileName = `Fueld_Invoice_${invoiceNumber.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`;
  const revision = await persistDocumentRevision({
    tenantId: order.tenantId,
    orderId: order.id,
    invoiceId: invoice?.id ?? null,
    documentType: 'INVOICE',
    fileName,
    buffer,
  });

  if (revision.isNew) {
    const verifyTokenLink = `${getPublicApiBaseUrl()}/verify/token/${revision.verifyToken}`;
    let verifyTokenQr = docData.verifyUrl;
    try {
      verifyTokenQr = await QRCode.toDataURL(verifyTokenLink, { width: 160, margin: 1 });
    } catch {
      // keep existing QR (or null) if token QR generation fails
    }
    const finalized = buildProformaDocument({
      ...docData,
      verifyUrl: verifyTokenQr,
      verifyLink: verifyTokenLink,
      printMeta: {
        issuedAt: revision.issuedAt,
        revisionNumber: revision.revisionNumber,
        verificationRef: revision.verificationRef,
        fingerprintShort: revision.fingerprintShort,
      },
    });
    const finalizedBuffer = await createPdfBuffer(finalized);
    await overwriteDocumentRevisionArtifact(revision, finalizedBuffer);
  }

  const canonicalBuffer = loadDocumentRevisionBuffer(revision);

  return { buffer: canonicalBuffer, invoiceNumber, fileName, revision };
}

// ─── Internal: pdfmake → Buffer ──────────────────────────────────────


export function buildProformaDocument(data: {
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
  dateFormat?: string | null;
  costSalesDecimalPrecision?: number | null;
  currency: string;
  fromName: string | null;
  fromEmail: string | null;
  fromPhone: string | null;
  paymentTerms: string | null;
  dueDate?: string | null;
  customerNote: string | null;
  termsAndConditions: string | null;
  companyName: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  companyRegistrationNumber?: string | null;
  companyWebsite: string | null;
  companyLogoDataUrl: string | null;
  itemNotes: Array<{ label: string; note: string }>;
  items: Array<{
    productType: string;
    description: string | null;
    quantity: string;
    unit: string;
    priceUnit?: string;
    salesPrice: string | null;
    salesPricingModel?: string | null;
    salesReferenceName?: string | null;
    salesPremium?: string | null;
    salesBarging?: string | null;
    salesBargingUnit?: string | null;
    salesCreditDays?: number | null;
    salesPriceFinalized?: boolean | null;
  }>;
  createdAt: Date;
  verifyUrl?: string | null;
  verifyLink?: string | null;
  fraudPreventionText?: string | null;
  bank?: BankDetails | null;
  vatNumber?: string | null;
  latePaymentInterest?: string | null;
  placeRemark?: string | null;
  docTitle?: string;
  printMeta?: DocumentPrintMeta | null;
  purchaseOrderNumber?: string | null;
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
    customerBlock.push({ text: `Att.: ${data.customerContactName.trim()}`, fontSize: 10 } as Content);
  }
  // Client address lines
  const clientAddr = data.clientAddress?.trim();
  if (clientAddr) {
    const lines = splitAddressLines(clientAddr);
    for (const line of lines) {
      customerBlock.push({ text: line, fontSize: 10 } as Content);
    }
    // Append country if not already included in address lines
    if (data.clientCountry?.trim() && !countryAlreadyInAddress(lines, data.clientCountry)) {
      customerBlock.push({ text: data.clientCountry.trim(), fontSize: 10 } as Content);
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
    { text: 'Total amount', style: 'tableHeader', alignment: 'right' },
  ];

  const tableRows: TableCell[][] = data.items.map((item) => {
    const qty = parseFloat(item.quantity) || 0;
    const unitPrice = parseFloat(item.salesPrice ?? '0') || 0;
    const lineTotal = qty * unitPrice;
    const productCell: Content = item.description?.trim()
      ? { text: [{ text: item.productType }, { text: `  ${item.description.trim()}`, fontSize: 8, color: '#374151' }] }
      : { text: item.productType };

    let priceCell: Content;
    let totalCell: Content;
    if (item.salesPricingModel === 'FORMULA') {
      const parts: Content[] = [];
      if (item.salesReferenceName) parts.push({ text: item.salesReferenceName, bold: true, fontSize: 9 });
      if (item.salesPremium && parseFloat(item.salesPremium)) parts.push({ text: ` + ${formatNumber(item.salesPremium)} /${item.priceUnit ?? item.unit}`, fontSize: 8 });
      if (item.salesBarging && parseFloat(item.salesBarging)) parts.push({ text: `\nbarging ${formatNumber(item.salesBarging)} ${item.salesBargingUnit || 'l/s'}`, fontSize: 8 });
      if (item.salesPriceFinalized) {
        parts.push({ text: `\n\u2192 ${formatNumber(item.salesPrice)} ${data.currency}/${item.priceUnit ?? item.unit}`, fontSize: 8, bold: true });
        totalCell = { text: `${formatNumber(String(lineTotal), 2)} ${data.currency}`, alignment: 'right' };
      } else {
        totalCell = { text: 'TBD', alignment: 'right', italics: true, color: '#d97706' };
      }
      priceCell = { text: parts, alignment: 'right' };
    } else {
      priceCell = { text: `${data.currency}/${item.priceUnit ?? item.unit}  ${formatNumber(item.salesPrice)}`, alignment: 'right' };
      totalCell = { text: `${formatNumber(String(lineTotal), 2)} ${data.currency}`, alignment: 'right' };
    }

    return [
      productCell as TableCell,
      { text: formatNumberCompact(item.quantity, 3), alignment: 'right' },
      { text: item.unit },
      priceCell as TableCell,
      totalCell as TableCell,
    ];
  });
  const grandTotal = data.items.reduce((sum, item) => {
    const qty = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.salesPrice ?? '0') || 0;
    return sum + qty * price;
  }, 0);
  const totalAmountDueLabel = `Total amount due to ${data.companyName?.trim() || 'Company'}`;

  // Delivery date string
  let deliveryDateStr = '';
  if (data.eta) {
    const hasRange = !!data.etd;
    const fmtEta = formatDateTimeForDisplay(data.eta, data.timezone, hasRange, data.dateFormat ?? undefined);
    deliveryDateStr = fmtEta ?? data.eta;
    if (data.etd) {
      const fmtEtd = formatDateTimeForDisplay(data.etd, data.timezone, false, data.dateFormat ?? undefined);
      deliveryDateStr += ` to ${fmtEtd ?? data.etd}`;
    }
  }

  // "For account of" line (like reference PDF)
  const vesselRef = `${data.vesselName}${data.vesselImo ? ` (IMO: ${data.vesselImo})` : ''}`;
  const vesselDisplay = data.vesselName.startsWith('MV ') ? vesselRef : `MV ${vesselRef}`;
  const forAccountParts = [`Master and/or owner and/or charterers and/or ${vesselDisplay}`];
  if (data.clientName) forAccountParts.push(`and/or ${data.clientName}`);
  const hasNotesSection = !!data.customerNote?.trim() || data.itemNotes.length > 0;

  // ── Header (3 columns: client | title | logo+date/ref) ────────────
  const customerTopOffset = data.companyLogoDataUrl ? 60 : 0;
  const headerContentHeight = 30 + customerTopOffset + customerBlock.length * 14 + 4;
  const topMargin = Math.max(140, headerContentHeight);

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
          ...(data.purchaseOrderNumber?.trim() ? [
            [{ text: 'PO No.:', bold: true, alignment: 'right', margin: [0, 0, 4, 0] }, { text: data.purchaseOrderNumber.trim(), alignment: 'right' }],
          ] : []),
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
      margin: [40, 30, 0, 0],
      columns: [
        { width: 150, stack: currentPage === 1 ? customerBlock : [{ text: '' }], margin: [0, customerTopOffset, 0, 0] },
        { width: '*', text: data.docTitle ?? 'PROFORMA INVOICE', style: 'docTitle', alignment: 'center', margin: [10, 0, 10, 0], noWrap: true },
        { width: 150, stack: rightStack, margin: [0, 0, 40, 0] },
      ],
    } as Content;
  };

  // ── Footer (company details + page number) ────────────────────────
  const footerFn = (currentPage: number, pageCount: number) => {
    const leftTexts: Content[] = [
      { text: senderName, fontSize: 8, bold: true, color: '#374151' } as Content,
    ];
    if (data.companyAddress?.trim()) {
      for (const line of splitAddressLines(data.companyAddress)) {
        leftTexts.push({ text: line, fontSize: 8, color: '#374151' } as Content);
      }
    }
    const middleTexts: Content[] = [];
    if (data.companyPhone?.trim()) {
      const display = formatPhoneDisplay(data.companyPhone) ?? data.companyPhone.trim();
      middleTexts.push({ text: `T ${display}`, fontSize: 8, color: '#1a56db', link: phoneToTelUri(data.companyPhone) } as Content);
    }
    if (data.companyEmail?.trim()) {
      middleTexts.push({ text: data.companyEmail.trim(), fontSize: 8, color: '#1a56db', link: `mailto:${data.companyEmail.trim()}` } as Content);
    }
    if (data.companyRegistrationNumber?.trim()) {
      middleTexts.push({ text: `Reg. No : ${data.companyRegistrationNumber.trim()}`, fontSize: 8, color: '#374151' } as Content);
    }
    if (data.vatNumber?.trim()) {
      middleTexts.push({ text: `VAT No : ${data.vatNumber.trim()}`, fontSize: 8, color: '#374151' } as Content);
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
        ...(data.printMeta ? [{
          text: `Issued (UTC): ${formatIssuedAtUtc(data.printMeta.issuedAt, data.dateFormat ?? undefined)}   Revision: ${data.printMeta.revisionNumber}   Ref: ${data.printMeta.verificationRef}   Fingerprint: ${data.printMeta.fingerprintShort}`,
          fontSize: 7,
          color: '#6b7280',
          alignment: 'center',
          margin: [0, 16, 0, 0] as [number, number, number, number],
        } as Content] : []),
      ],
    };
  };

  // ── Document definition ───────────────────────────────────────────
  return {
    pageSize: 'A4',
    pageMargins: [40, topMargin, 40, 80],
    header,
    content: [
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
        margin: [0, 20, 0, 14],
      } as Content,

      // Items table
      {
        table: {
          headerRows: 1,
          widths: ['*', 65, 35, 130, 90],
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
      {
        columns: [
          { width: '*', text: totalAmountDueLabel, bold: true },
          { width: 'auto', text: `${formatNumber(String(grandTotal), 2)} ${data.currency}`, bold: true, alignment: 'right' },
        ],
        margin: [0, 6, 0, 0],
      } as Content,
      { text: '', margin: [0, 6, 0, 0] } as Content,

      // Payment terms
      ...(data.paymentTerms
        ? [{ text: [{ text: 'Payment terms:  ', bold: true }, { text: data.paymentTerms.replace(/_/g, ' ') }], margin: [0, 0, 0, 2] } as Content]
        : []),
      ...(data.dueDate
        ? [{ text: [{ text: 'Due date:  ', bold: true }, { text: data.dueDate }], margin: [0, 0, 0, 2] } as Content]
        : []),

      // Notes
      ...buildNotesSection({
        customerNotes: data.customerNote,
        termsAndConditions: data.termsAndConditions ?? null,
        vendorName: data.companyName ?? '',
        clientName: data.clientName,
        vesselName: data.vesselName,
        placeName: data.portName,
        itemNotes: data.itemNotes,
      }),

      // ── Remittance Instructions ──
      ...(data.bank ? [
        { text: '', margin: [0, hasNotesSection ? 2 : 8, 0, 0] } as Content,
        { canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e5e7eb' }] } as Content,
        { text: '', margin: [0, 6, 0, 0] } as Content,
        { text: 'REMITTANCE INSTRUCTIONS', style: 'sectionLabel' } as Content,
        { text: 'Payment to be effected, free of all charges to us, by telegraphic transfer to:', fontSize: 9, margin: [0, 2, 0, 6] } as Content,
        { text: `Please include Order Ref ${data.orderNumber ?? refNum} in the transfer message/note.`, fontSize: 9, margin: [0, 0, 0, 6] } as Content,
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
        ...(data.bank.sortCode ? [{
          columns: [
            { width: '25%', text: 'Sort Code:', bold: true },
            { width: '75%', text: data.bank.sortCode },
          ],
          margin: [0, 2, 0, 0],
        } as Content] : []),
        ...(data.bank.routingNumber ? [{
          columns: [
            { width: '25%', text: 'Routing No:', bold: true },
            { width: '75%', text: data.bank.routingNumber },
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
      ] : []),

      // ── VAT Number ──
      ...(data.vatNumber ? [{
        text: `${data.companyName ?? 'Company'} VAT: ${data.vatNumber}`,
        fontSize: 9,
        margin: [0, 10, 0, 0],
      } as Content] : []),

      // ── Payment note ──
      ...(data.latePaymentInterest ? [{
        text: `Note : Late payment charged @ ${data.latePaymentInterest} interest, per month pro rata.`,
        fontSize: 8, color: '#b91c1c', bold: true,
        decoration: 'underline' as const,
        margin: [0, 10, 0, 0],
      } as Content] : []),

      // ── Fraud Prevention + QR (2-column) ──
      ...((data.fraudPreventionText || data.verifyUrl) ? [
        { text: '', margin: [0, 10, 0, 0] } as Content,
        {
          columns: [
            {
              width: '*',
              stack: [
                ...(data.fraudPreventionText ? [
                  { text: 'FRAUD PREVENTION', fontSize: 9, bold: true, margin: [0, 0, 0, 4] } as Content,
                  { text: data.fraudPreventionText, fontSize: 8, color: '#374151', margin: [0, 0, 10, 0] } as Content,
                ] : []),
              ],
            },
            {
              width: 'auto',
              stack: [
                ...(data.verifyUrl ? [
                  { image: data.verifyUrl, fit: [80, 80], alignment: 'right', link: data.verifyLink ?? undefined } as Content,
                  { text: 'Scan or click to verify', fontSize: 7, color: '#1a56db', alignment: 'center', margin: [0, 4, 0, 0], link: data.verifyLink ?? undefined } as Content,
                  ...(data.verifyLink ? [
                    { text: `Verify domain: ${new URL(data.verifyLink).hostname}`, fontSize: 6, color: '#6b7280', alignment: 'center', margin: [0, 2, 0, 0] } as Content,
                  ] : []),
                ] : []),
              ],
            },
          ],
        } as Content,
      ] : []),
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
  revision: DocumentRevisionInfo;
}> {
  const order = await fetchOrderForInvoice(orderId);
  const { dateFormat } = await getDateFormatSettings();
  const { precision: costSalesDecimalPrecision } = await getCostSalesDecimalPrecision();
  const existingRevision = await getLatestDocumentRevisionByStream({
    documentType: 'PROFORMA_INVOICE',
    orderId: order.id,
  });

  const proformaSourceUpdatedAtMs = maxMs([
    order.updatedAt,
    order.client.updatedAt,
    order.vessel.updatedAt,
    order.place.updatedAt,
    order.invoicingCompany?.updatedAt ?? null,
    order.salesRep?.updatedAt ?? null,
    order.customerContact?.updatedAt ?? null,
    order.supplierContact?.updatedAt ?? null,
  ]);
  const proformaItemUpdatedAtMs = maxItemUpdatedAtMs(order.items);
  const proformaCombinedUpdatedAtMs = Math.max(proformaSourceUpdatedAtMs, proformaItemUpdatedAtMs);

  if (existingRevision && proformaCombinedUpdatedAtMs <= existingRevision.issuedAt.getTime()) {
    const existingBuffer = loadDocumentRevisionBuffer(existingRevision);
    const existingFileName = `Proforma_Invoice_${order.orderNumber ?? orderId.slice(0, 8)}.pdf`;
    return { buffer: existingBuffer, fileName: existingFileName, revision: existingRevision };
  }

  const companyLogoDataUrl = tryLoadLogoDataUrl(order.invoicingCompany?.logoUrl ?? null);
  const bank = await loadOrderBankDetails(order.bankAccountId, order.invoicingCompanyId);

  // Resolve price reference names for formula-priced items
  const proformaRefIds = new Set<string>();
  for (const item of order.items) {
    if (item.salesReferenceId) proformaRefIds.add(item.salesReferenceId);
  }
  const proformaRefNameMap = new Map<string, string>();
  if (proformaRefIds.size > 0) {
    const refs = await db.select({ id: priceReferences.id, name: priceReferences.name })
      .from(priceReferences)
      .where(inArray(priceReferences.id, [...proformaRefIds]));
    for (const r of refs) proformaRefNameMap.set(r.id, r.name);
  }

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
    dateFormat: dateFormat,
    costSalesDecimalPrecision: costSalesDecimalPrecision,
    currency: order.currency ?? 'USD',
    fromName: order.salesRep?.name ?? null,
    fromEmail: order.salesRep?.email ?? null,
    fromPhone: order.salesRep?.phone ?? null,
    paymentTerms,
    customerNote: order.customerNote ?? null,
    purchaseOrderNumber: order.purchaseOrderNumber ?? null,
    termsAndConditions: order.termsAndConditions ?? null,
    placeRemark: order.placeRemark ?? order.place.orderRemark ?? null,
    companyName: order.invoicingCompany?.name ?? null,
    companyAddress: order.invoicingCompany?.headOfficeAddress ?? null,
    companyPhone: order.invoicingCompany?.headOfficePhone ?? null,
    companyEmail: order.invoicingCompany?.headOfficeEmail ?? null,
    companyRegistrationNumber: getCompanyRegistrationNumber(order.invoicingCompany),
    companyWebsite: order.invoicingCompany?.website ?? null,
    companyLogoDataUrl,
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
      priceUnit: item.salesUnit ?? item.unit,
      salesPrice: item.salesPrice,
      salesPricingModel: item.salesPricingModel,
      salesReferenceName: item.salesReferenceId ? (proformaRefNameMap.get(item.salesReferenceId) ?? null) : null,
      salesPremium: item.salesPremium,
      salesBarging: item.salesBarging,
      salesBargingUnit: item.salesBargingUnit,
      salesCreditDays: item.salesCreditDays,
      salesPriceFinalized: item.salesPriceFinalized,
    })),
    createdAt: order.createdAt,
    verifyUrl: null as string | null,
    verifyLink: null as string | null,
    fraudPreventionText: order.invoicingCompany?.fraudPreventionText ?? null,
    bank,
    vatNumber: order.invoicingCompany?.vatNumber ?? null,
    latePaymentInterest: order.invoicingCompany?.latePaymentInterest ?? null,
    printMeta: null,
  };

  // Generate QR code verification URL
  const verifyLink = `${getPublicApiBaseUrl()}/verify/${orderId}/proforma-invoice`;
  try {
    docData.verifyUrl = await QRCode.toDataURL(verifyLink, { width: 160, margin: 1 });
    docData.verifyLink = verifyLink;
  } catch { /* QR generation failed — continue without */ }

  const docDefinition = buildProformaDocument(docData);
  const buffer = await createPdfBuffer(docDefinition);
  const fileName = `Proforma_Invoice_${order.orderNumber ?? orderId.slice(0, 8)}.pdf`;
  const revision = await persistDocumentRevision({
    tenantId: order.tenantId,
    orderId: order.id,
    documentType: 'PROFORMA_INVOICE',
    fileName,
    buffer,
  });

  if (revision.isNew) {
    const verifyTokenLink = `${getPublicApiBaseUrl()}/verify/token/${revision.verifyToken}`;
    let verifyTokenQr = docData.verifyUrl;
    try {
      verifyTokenQr = await QRCode.toDataURL(verifyTokenLink, { width: 160, margin: 1 });
    } catch {
      // keep existing QR (or null) if token QR generation fails
    }
    const finalized = buildProformaDocument({
      ...docData,
      verifyUrl: verifyTokenQr,
      verifyLink: verifyTokenLink,
      printMeta: {
        issuedAt: revision.issuedAt,
        revisionNumber: revision.revisionNumber,
        verificationRef: revision.verificationRef,
        fingerprintShort: revision.fingerprintShort,
      },
    });
    const finalizedBuffer = await createPdfBuffer(finalized);
    await overwriteDocumentRevisionArtifact(revision, finalizedBuffer);
  }

  const canonicalBuffer = loadDocumentRevisionBuffer(revision);

  return { buffer: canonicalBuffer, fileName, revision };
}

export const __documentTestUtils = {
  trimTrailingSlash,
  getPublicApiBaseUrl,
  sanitizePathSegment,
  documentTypePrefix,
  buildVerificationRef,
  mapRevisionInfo,
  getRevisionAbsolutePath,
  resolveDocumentStreamTarget,
  buildDocumentStreamKey,
  toMs,
  maxMs,
  maxItemUpdatedAtMs,
  persistDocumentRevision,
  fetchInvoiceData,
  fetchOrderForInvoice,
  getCompanyRegistrationNumber,
  loadOrderBankDetails,
  overwriteDocumentRevisionArtifact,
  formatNumber,
  formatPhoneDisplay,
  phoneToTelUri,
  phoneTextNode,
  emailTextNode,
  parseTimezoneOffset,
  formatDateTimeForDisplay,
  formatCustomerPaymentTerms,
  computeDueDate,
  replaceCompanyNamePlaceholder,
  buildOfferForAccountOfText,
  buildNotesSection,
  normalizeCountryName,
  countryAlreadyInAddress,
  tryLoadLogoDataUrl,
  createPdfBuffer,
  buildInvoiceDocument,
  buildOfferDocument,
  buildProformaDocument,
};
