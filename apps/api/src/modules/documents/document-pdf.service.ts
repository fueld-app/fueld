// ═══════════════════════════════════════════════════════════════════════
//  Document PDF config — pdfmake setup + shared helpers
// ═══════════════════════════════════════════════════════════════════════

import pdfmake from 'pdfmake';
import vfsFonts from 'pdfmake/build/vfs_fonts.js';
import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces';
import { formatNumber, replaceCompanyNamePlaceholder } from './document-utils.service';

// ─── pdfmake font setup ──────────────────────────────────────────────

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

// ─── Shared PDF creation ─────────────────────────────────────────────

export function createPdfBuffer(docDefinition: TDocumentDefinitions): Promise<Buffer> {
  const pdfDoc = pdfmake.createPdf(docDefinition);
  return pdfDoc.getBuffer();
}

// ─── Shared document helpers ─────────────────────────────────────────

export function phoneTextNode(
  label: string,
  phone: string,
  opts: { fontSize?: number; margin?: [number, number, number, number] } = {},
): Content {
  return {
    text: `${label}: ${phone}`,
    fontSize: opts.fontSize ?? 9,
    margin: opts.margin ?? [0, 0, 0, 0],
  };
}

export function emailTextNode(
  label: string,
  email: string,
  opts: { fontSize?: number; margin?: [number, number, number, number] } = {},
): Content {
  return {
    text: `${label}: ${email}`,
    fontSize: opts.fontSize ?? 9,
    margin: opts.margin ?? [0, 0, 0, 0],
  };
}

export function buildOfferForAccountOfText(params: {
  vendorName: string;
  vendorCountry: string;
  clientName: string;
  clientCountry: string;
}) {
  const forTheAccountOf = `For the account of: ${params.clientName} (${params.clientCountry})`;
  return { text: forTheAccountOf, fontSize: 10, bold: true, margin: [0, 6, 0, 0] };
}

export function buildNotesSection(params: {
  customerNotes: string | null;
  termsAndConditions: string | null;
  vendorName: string;
  clientName: string;
  vesselName: string;
  placeName: string;
  itemNotes?: Array<{ label: string; note: string }>;
  placeRemark?: string | null;
}): Content[] {
  const notes: Content[] = [];

  if (params.customerNotes) {
    notes.push({
      text: `Customer notes: ${replaceCompanyNamePlaceholder(params.customerNotes, params.vendorName, params.clientName, params.vesselName, params.placeName)}`,
      fontSize: 8,
      color: '#6b7280',
      margin: [0, 4, 0, 0],
    });
  }

  if (params.termsAndConditions) {
    notes.push({
      text: `Terms & conditions: ${replaceCompanyNamePlaceholder(params.termsAndConditions, params.vendorName, params.clientName, params.vesselName, params.placeName)}`,
      fontSize: 8,
      color: '#6b7280',
      margin: [0, 4, 0, 0],
    });
  }

  return notes;
}

