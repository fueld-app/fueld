// ═══════════════════════════════════════════════════════════════════════
//  Documents — SLEEK layout
//
//  A second layout for a tenant's PDFs, structurally different from the
//  CLASSIC one rather than a restyle: different block order, a real totals
//  breakdown, a lighter table, and a plain "Payment methods accepted"
//  remittance block.
//
//  Written because Moxie asked for their invoices to match a reference they
//  sent us. Kept as a separate layout rather than editing the classic builder
//  so every other tenant's documents stay byte-identical until they opt in.
//
//  Scope note: this renders INVOICE / PROFORMA / OFFER / CONFIRMATION alike,
//  because all four go through buildProformaDocument. A document carrying no
//  remittance or no totals block (an offer) simply renders without that block
//  rather than getting a different layout.
// ═══════════════════════════════════════════════════════════════════════

import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';

export type DocumentLayout = 'CLASSIC' | 'SLEEK';

/** Issuer block shown top-right, mirroring the reference. */
export interface SleekIssuer {
  name: string;
  address: string | null;
  taxId: string | null;
  phone: string | null;
  email: string | null;
}

/** Third party on the document (customer, or the party an offer goes to). */
export interface SleekParty {
  name: string;
  address: string | null;
  /** Contact line, already labelled (e.g. "Att.: Kathy Rolfo") or null. */
  attention: string | null;
  /** Customer's own registration number, printed under their address. */
  taxId: string | null;
}

export interface SleekLine {
  /** Product name and its description, already joined (e.g. "LSMGO — DMA"). */
  description: string;
  quantity: string;
  unitPrice: string;
  /** Omitted when the document hides prices. */
  amount: string | null;
}

export interface SleekTotals {
  subtotal: string;
  taxable: string;
  taxLabel: string;
  taxAmount: string;
  total: string;
  /** Short label for the bold row, e.g. "Total including VAT". */
  totalShortLabel: string;
  totalLabel: string | null;
  /** e.g. "1 USD = 6.52 DKK" — only when the order carries an FX rate. */
  exchangeRate?: string | null;
}

export interface SleekBank {
  beneficiary: string;
  bankName: string | null;
  accountNumber: string | null;
  iban: string | null;
  swift: string | null;
  branchAddress: string | null;
}

export interface SleekDocumentInput {
  /** Company whose documents these are — drives the logo and, in the header, the accent. */
  brandName: string;
  logoDataUrl: string | null;
  /** Document noun: "Invoice", "Offer", "Proforma Invoice". Reference uses title case. */
  title: string;
  /** Top-right metadata line. Every entry already formatted. */
  meta: Array<{ label: string; value: string }>;
  issuer: SleekIssuer;
  party: SleekParty;
  /** Vessel / delivery block — only for fuel orders, omitted for offers. */
  voyage: Array<{ label: string; value: string }>;
  lines: SleekLine[];
  headers: string[];
  totals: SleekTotals | null;
  /** "The amount is due on Oct 7, 2026." */
  dueLine: string | null;
  /** Split payment terms note, shown above the totals when present. */
  trancheNote: string | null;
  bank: SleekBank | null;
  /** Free-text notes / T&Cs, already split into paragraphs. */
  notes: string[];
  accent: string;
  /** Verification QR, kept because removing it would lose document verification. */
  verifyUrl: string | null;
  verifyLink: string | null;
  fraudPreventionText: string | null;
  /** Footer closure from buildDocumentFooter — reused so both layouts agree. */
  footer: (currentPage: number, pageCount: number) => Content;
}

// ─── Palette ─────────────────────────────────────────────────────────
// The reference is near-monochrome: black text, hairline rules, and colour
// only in the logo. `accent` is used for the few interactive affordances.

const INK = '#111827';
const RULE = '#d1d5db';
const MUTED = '#6b7280';
const SUBTLE_RULE = '#e5e7eb';

/** The reference's title is large, light and lower-case-titled ("Invoice"). */
const TITLE = { fontSize: 26, color: INK };

const LABEL = { fontSize: 9.5, color: INK };
const VALUE = { fontSize: 9.5, bold: true, color: INK };

/** A label/value pair rendered on one line in the top-right metadata row. */
function metaRow(entries: Array<{ label: string; value: string }>): Content {
  return {
    columns: entries.map((e, i) => ({
      width: 'auto' as const,
      // The value never wraps: a date or reference broken across lines is unreadable.
      text: [
        { text: `${e.label}: `, ...LABEL } as Content,
        { text: e.value, ...VALUE, noWrap: true } as Content,
      ],
      ...(i > 0 ? { margin: [18, 0, 0, 0] as [number, number, number, number] } : {}),
    })),
    alignment: 'right' as const,
    margin: [0, 6, 0, 0] as [number, number, number, number],
  } as Content;
}

function addressLines(address: string | null): string[] {
  if (!address?.trim()) return [];
  return address.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * The totals breakdown.
 *
 * `Taxable amount` / `VAT` are printed because the reference prints them, and
 * because `orderItems` carries taxRate/taxAmount — they are real fields that the
 * classic layout never showed. Every line item in production currently has them
 * NULL, so `taxAmount` is "0.00"; the block is still correct, and starts showing
 * real VAT the moment a line carries a rate.
 */
function totalsBlock(totals: SleekTotals): Content {
  const compact = { fontSize: 9.5, color: INK };
  const rule = { hLineWidth: (i: number) => (i === 2 ? 0.6 : 0), hLineColor: () => RULE, vLineWidth: () => 0 };
  const pad = { paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 3, paddingBottom: () => 3 };

  // The reference splits this into two columns: what the tax break-down is on the
  // left, and what is actually payable on the right. Reproduced because it is
  // what makes the block read as a summary rather than a stack of rows.
  const left: TableCell[][] = [
    [
      { text: 'Non-taxable amount:', ...compact } as TableCell,
      { text: totals.subtotal, ...compact, alignment: 'right' as const, margin: [12, 0, 0, 0] } as TableCell,
    ],
    [
      { text: 'Taxable amount:', ...compact } as TableCell,
      { text: totals.taxable, ...compact, alignment: 'right' as const, margin: [12, 0, 0, 0] } as TableCell,
    ],
  ];

  const right: TableCell[][] = [
    [
      { text: 'Total excluding VAT', ...compact } as TableCell,
      { text: totals.subtotal, ...compact, alignment: 'right' as const } as TableCell,
    ],
    [
      { text: totals.taxLabel, ...compact } as TableCell,
      { text: totals.taxAmount, ...compact, alignment: 'right' as const } as TableCell,
    ],
    [
      { text: totals.totalShortLabel, fontSize: 11, bold: true, color: INK } as TableCell,
      { text: totals.total, fontSize: 11, bold: true, color: INK, alignment: 'right' as const } as TableCell,
    ],
  ];

  const stack: Content[] = [
    {
      columns: [
        { width: '*', table: { widths: ['auto', 'auto'], body: left }, layout: { ...rule, ...pad }, alignment: 'left' as const } as unknown as Content,
        { width: 250, table: { widths: ['*', 'auto'], body: right }, layout: { ...rule, ...pad } } as unknown as Content,
      ],
    } as Content,
  ];

  if (totals.exchangeRate) {
    stack.push({
      columns: [
        { width: '*', text: '' },
        {
          width: 250,
          margin: [0, 8, 0, 0] as [number, number, number, number],
          columns: [
            { width: '*', text: 'Exchange rate:', ...compact } as Content,
            { width: 'auto', text: totals.exchangeRate, ...compact } as Content,
          ],
        },
      ],
    } as Content);
  }

  // Present only for split payment terms; see sleekTotalLabel.
  if (totals.totalLabel) {
    stack.push({ text: totals.totalLabel, fontSize: 9.5, color: INK, margin: [0, 10, 0, 0] } as Content);
  }

  return { stack } as Content;
}

/** Plain "Payment methods accepted" block, matching the reference's wording. */
function bankBlock(bank: SleekBank, beneficiaryFallback: string): Content {
  const lines: Content[] = [{ text: 'Payment methods accepted', fontSize: 15, color: INK, margin: [0, 0, 0, 10] } as Content];
  lines.push({ text: 'Bank Details:', ...LABEL, margin: [0, 0, 0, 4] });

  const detail = (label: string, value: string | null) => {
    if (!value?.trim()) return;
    lines.push({ text: `${label} ${value.trim()}`, fontSize: 9, color: INK, margin: [0, 0, 0, 3] } as Content);
  };

  // The reference leads with the beneficiary, then bank, then account and IBAN.
  detail('BENEFICIARY:', bank.beneficiary?.trim() || beneficiaryFallback);
  detail('Bank Name:', bank.bankName);
  if (bank.branchAddress?.trim()) {
    for (const l of addressLines(bank.branchAddress)) detail('', l);
  }
  detail('ACCOUNT:', bank.accountNumber);
  detail('IBAN:', bank.iban);
  detail('SWIFT:', bank.swift);

  return { stack: lines, margin: [0, 16, 0, 0] } as Content;
}

export function buildSleekDocument(input: SleekDocumentInput): TDocumentDefinitions {
  const { accent } = input;

  // ── Logo: centred on its own line, as the reference has it ─────────
  const logoBlock: Content[] = [];
  if (input.logoDataUrl) {
    logoBlock.push({
      image: input.logoDataUrl,
      fit: [200, 68],
      alignment: 'center' as const,
      margin: [0, 0, 0, 2] as [number, number, number, number],
    } as Content);
  }

  // ── Party (left) ───────────────────────────────────────────────────
  const partyStack: Content[] = [{ text: input.party.name, fontSize: 11, bold: true, color: INK } as Content];
  if (input.party.attention?.trim()) {
    partyStack.push({ text: input.party.attention.trim(), fontSize: 10, color: INK } as Content);
  }
  for (const line of addressLines(input.party.address)) {
    partyStack.push({ text: line, fontSize: 10, color: INK } as Content);
  }
  if (input.party.taxId?.trim()) {
    partyStack.push({ text: `Tax ID: ${input.party.taxId.trim()}`, fontSize: 10, color: INK, margin: [0, 6, 0, 0] } as Content);
  }

  // ── Issuer (right) ─────────────────────────────────────────────────
  const issuerStack: Content[] = [];
  const issuerLine = (text: string, bold = false) =>
    issuerStack.push({ text, fontSize: 10, color: INK, bold, alignment: 'right' as const } as Content);
  issuerLine(input.issuer.name, true);
  for (const line of addressLines(input.issuer.address)) issuerLine(line);
  if (input.issuer.taxId?.trim()) {
    issuerStack.push({ text: `Tax ID: ${input.issuer.taxId.trim()}`, fontSize: 10, color: INK, alignment: 'right' as const, margin: [0, 6, 0, 0] } as Content);
  }
  if (input.issuer.phone?.trim()) {
    issuerStack.push({ text: `Phone: ${input.issuer.phone.trim()}`, fontSize: 10, color: accent, alignment: 'right' as const } as Content);
  }
  if (input.issuer.email?.trim()) {
    issuerStack.push({ text: input.issuer.email.trim(), fontSize: 10, color: accent, alignment: 'right' as const } as Content);
  }

  const content: Content[] = [];

  // ── Logo ───────────────────────────────────────────────────────────
  if (logoBlock.length > 0) {
    content.push({ stack: logoBlock, margin: [0, 0, 0, 6] } as Content);
  }

  // ── Parties ────────────────────────────────────────────────────────
  content.push({
    columns: [
      { width: '*', stack: partyStack } as Content,
      { width: 'auto', stack: issuerStack } as Content,
    ],
    margin: [0, 6, 0, 0],
  } as Content);

  // ── Title + metadata, over a full-width rule, then the table follows ─
  content.push({
    columns: [
      { width: '*', text: input.title, ...TITLE } as Content,
      { width: 'auto' as const, stack: [metaRow(input.meta)], margin: [16, 0, 0, 0] as [number, number, number, number] } as Content,
    ],
    margin: [0, 18, 0, 0],
  } as Content);
  // The rule that separates the heading from the lines, as in the reference.
  content.push({
    canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 487, y2: 0, lineWidth: 0.6, lineColor: RULE }],
    margin: [0, 6, 0, 0],
  } as Content);

  // ── Voyage (vessel / delivery) ─────────────────────────────────────
  if (input.voyage.length > 0) {
    content.push({
      width: 300,
      margin: [0, 14, 0, 0],
      table: {
        widths: [90, '*'],
        body: input.voyage.map((v) => [
          { text: v.label, fontSize: 10, color: INK } as TableCell,
          { text: v.value, fontSize: 10, color: INK } as TableCell,
        ]),
      },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 2, paddingBottom: () => 2 },
    } as unknown as Content);
  }

  // ── Line items: hairline rules top and bottom only ─────────────────
  // Numeric columns right-align, the rest left. Derived from position so the
  // caller only supplies header labels, not alignments.
  const RIGHT_ALIGNED = new Set([1, 2, input.headers.length - 1]);
  const headerCells: TableCell[] = input.headers.map((h, i) => ({
    text: h,
    fontSize: 9.5,
    color: MUTED,
    alignment: RIGHT_ALIGNED.has(i) ? ('right' as const) : ('left' as const),
  } as TableCell));

  const body: TableCell[][] = [headerCells];
  for (const line of input.lines) {
    // One cell holding name and description together, so the pair reads as a
    // single item and stays on one line. Long text wraps inside the cell rather
    // than being clipped.
    body.push([
      { text: line.description, fontSize: 10, color: INK } as TableCell,
      { text: line.quantity, fontSize: 10, color: INK, alignment: 'right' } as TableCell,
      { text: line.unitPrice, fontSize: 10, color: INK, alignment: 'right' } as TableCell,
      { text: line.amount ?? '', fontSize: 10, color: INK, alignment: 'right' } as TableCell,
    ]);
  }

  content.push({
    margin: [0, 0, 0, 0],
    // Four columns, matching the reference and the body rows.
    table: { widths: ['*', 80, 95, 105], headerRows: 1, body },
    layout: {
      // One rule under the header row and one closing the table; the heading
      // rule above is drawn separately so it spans the full width.
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
        (i === 1 || i === node.table.body.length ? 0.6 : 0),
      hLineColor: () => RULE,
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 6,
      paddingBottom: () => 6,
    },
  } as unknown as Content);

  // ── Totals ─────────────────────────────────────────────────────────
  if (input.totals) {
    if (input.trancheNote?.trim()) {
      content.push({ text: input.trancheNote.trim(), fontSize: 9.5, color: INK, margin: [0, 12, 0, 0] } as Content);
    }
    content.push({ ...(totalsBlock(input.totals) as object), margin: [0, 10, 0, 0] } as Content);
  }

  // ── Due line ───────────────────────────────────────────────────────
  if (input.dueLine?.trim()) {
    content.push({ text: input.dueLine.trim(), fontSize: 10, color: INK, margin: [0, 12, 0, 0] } as Content);
  }

  // ── Notes ──────────────────────────────────────────────────────────
  for (const note of input.notes) {
    content.push({ text: note, fontSize: 9.5, color: INK, margin: [0, 12, 0, 0] } as Content);
  }

  // ── Bank ───────────────────────────────────────────────────────────
  if (input.bank) {
    content.push(bankBlock(input.bank, input.issuer.name));
  }

  // ── Verification ───────────────────────────────────────────────────
  // Deliberately kept: the reference omits it, but it is how a customer proves
  // the PDF is authentic. Made visually quiet so it does not fight the layout.
  if (input.verifyUrl) {
    content.push({
      columns: [
        { width: '*' as const, text: '' },
        {
          width: 'auto' as const,
          stack: [
            { image: input.verifyUrl, fit: [78, 78], alignment: 'center' as const } as Content,
            { text: 'Scan to verify', fontSize: 7.5, color: accent, alignment: 'center' as const, margin: [0, 3, 0, 0], link: input.verifyLink ?? undefined } as Content,
          ],
        },
      ],
      margin: [0, 14, 0, 0],
    } as Content);
  }
  if (input.fraudPreventionText?.trim()) {
    content.push({ text: input.fraudPreventionText.trim(), fontSize: 8, color: MUTED, margin: [0, 4, 0, 0] } as Content);
  }

  return {
    pageSize: 'A4',
    pageMargins: [54, 40, 54, 86],
    content,
    footer: input.footer,
    defaultStyle: { fontSize: 10, font: 'Roboto', color: INK },
  };
}

/** Exposed for tests: the totals block without assembling a whole document. */
export const __sleekTestUtils = { totalsBlock, bankBlock, metaRow };
