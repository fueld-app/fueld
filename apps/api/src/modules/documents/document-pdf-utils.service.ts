// ═══════════════════════════════════════════════════════════════════════
//  Document PDF Generators — PDF document definitions (invoice, offer,
//  proforma invoice, nomination) using pdfmake.
// ═══════════════════════════════════════════════════════════════════════

import pdfmake from 'pdfmake';
import vfsFonts from 'pdfmake/build/vfs_fonts.js';
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { db } from '../../db';
import { bankAccounts, orders, orderItems, counterparties, vessels, places, invoices, users, priceReferences, tenants } from '../../db/schema';
import type { TenantSettings } from '../../db/schema';
import { createPdfBuffer } from './document-pdf.service';
import {
  getCompanyRegistrationNumber, loadBankDetails, tryLoadLogoDataUrl,
  formatCustomerPaymentTerms, formatStoredDateOnlyForDisplay,
  formatNumber, formatNumberCompact, normalizeCountryName, countryAlreadyInAddress,
  formatPhoneDisplay, splitAddressLines, computeDueDate,
} from './document-utils.service';
import { createDocumentRevision, getRevisionAbsolutePath, mapRevisionInfo } from './document-revision.service';
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

export function createPdfBuffer(docDefinition: TDocumentDefinitions): Promise<Buffer> {
  const pdf = pdfmake.createPdf(docDefinition);
  return pdf.getBuffer();
}

// ═══════════════════════════════════════════════════════════════════════
//  Offer PDF
// ═══════════════════════════════════════════════════════════════════════


