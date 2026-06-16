// ═══════════════════════════════════════════════════════════════════════
//  Document Types — shared types, constants, and small type helpers
// ═══════════════════════════════════════════════════════════════════════

export type DocumentType = 'OFFER' | 'PROFORMA_INVOICE' | 'INVOICE' | 'OTHER';

export const DOCUMENT_TEMPLATE_VERSION = '2026-04-10a';

export interface BankDetails {
  bankName: string;
  accountName: string | null;
  accountNumber: string | null;
  iban: string | null;
  swift: string | null;
  currency: string;
  branchAddress: string | null;
  sortCode: string | null;
  routingNumber: string | null;
  intermediaryBank: string | null;
}

export interface DocumentRevisionInfo {
  id: string;
  tenantId: string;
  revisionNumber: number;
  verificationRef: string;
  verifyToken: string;
  sha256Hex: string;
  fingerprintShort: string;
  issuedAt: Date;
  filePath: string;
  isNew: boolean;
}

export interface DocumentPrintMeta {
  issuedAt: Date;
  revisionNumber: number;
  verificationRef: string;
  fingerprintShort: string;
}

export const DEFAULT_BANK_DETAILS: BankDetails = {
  bankName: 'HSBC Bank Plc',
  accountName: 'Fueld Pte Ltd',
  accountNumber: null,
  iban: 'GB80HBUK40156712345678',
  swift: 'HBUKGB4B',
  currency: 'USD',
  branchAddress: 'London, United Kingdom',
  sortCode: null,
  routingNumber: null,
  intermediaryBank: null,
};

export function documentTypePrefix(documentType: DocumentType): string {
  switch (documentType) {
    case 'OFFER': return 'OFF';
    case 'PROFORMA_INVOICE': return 'PFI';
    case 'INVOICE': return 'INV';
    default: return 'DOC';
  }
}

export function buildVerificationRef(documentType: DocumentType, issuedAt: Date, revisionNumber: number): string {
  const yyyy = String(issuedAt.getUTCFullYear());
  const mm = String(issuedAt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(issuedAt.getUTCDate()).padStart(2, '0');
  return `${documentTypePrefix(documentType)}-${yyyy}${mm}${dd}-R${String(revisionNumber).padStart(3, '0')}`;
}

export function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}
