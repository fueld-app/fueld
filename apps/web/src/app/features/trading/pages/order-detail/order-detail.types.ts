import type { PlattsSuggestionsResponseDto } from '@fueld/types';

// ─── Inquiry supplier performance ──────────────────────────────────

export interface InquirySupplierPerformance {
  deliveredCountOverall: number;
  deliveredCountAtPlace: number;
  lastDeliveredAtOverall: string | null;
  lastDeliveredAtPlace: string | null;
  sentCount: number;
  quotedCount: number;
  declinedCount: number;
  noReplyCount: number;
  respondedCount: number;
  deliverableCount: number;
  nonDeliverableCount: number;
  averageResponseHours: number | null;
}

// ─── Inquiry supplier comparison ───────────────────────────────────

export interface InquirySupplierComparisonRow {
  portSupplierId: string;
  supplierId: string;
  supplierName: string;
  contactId: string | null;
  contactName: string | null;
  phone?: string | null;
  products: string[];
  note: string | null;
  email: string | null;
  inquiryStatus: string | null;
  inquirySentAt: string | null;
  performance: InquirySupplierPerformance;
}

// ─── Supplier inquiry reply ────────────────────────────────────────

export interface SupplierInquiryReplyItem {
  orderItemId: string;
  productType: string;
  quantity: string;
  unit: string;
  description: string | null;
  price: string | null;
  currency: string;
  note: string | null;
}

export interface SupplierInquiryReplyRow {
  id: string;
  supplierId: string;
  supplierName: string;
  contactId: string | null;
  contactName: string | null;
  email: string;
  status: 'SENT' | 'QUOTED' | 'DECLINED' | 'NO_REPLY';
  sentAt: string | null;
  responseDeadlineAt: string | null;
  reminderSentAt: string | null;
  reminderCount: number;
  respondedAt: string | null;
  quotedAt: string | null;
  canDeliver: boolean | null;
  declineReason: string | null;
  quoteValidUntil: string | null;
  deliveryWindow: string | null;
  supplierPaymentTerms: string | null;
  supplierComment: string | null;
  responseHours: number | null;
  quoteLineCount: number;
  items: SupplierInquiryReplyItem[];
}

// ─── Inquiry quote matrix ──────────────────────────────────────────

interface InquiryQuoteMatrixCell {
  supplierInquiryId: string;
  supplierId: string;
  supplierName: string;
  status: SupplierInquiryReplyRow['status'];
  price: string | null;
  currency: string;
  note: string | null;
  responseHours: number | null;
  isSelectedSupplier: boolean;
}

export interface InquiryQuoteMatrixRow {
  orderItemId: string;
  productType: string;
  quantity: string;
  quantityMin: string | null;
  unit: string;
  description: string | null;
  cells: InquiryQuoteMatrixCell[];
}

// ─── Inquiry reply recommendation ──────────────────────────────────

export interface InquiryReplyRecommendation {
  bestOverall: boolean;
  lowestComparable: boolean;
  mostComplete: boolean;
  fastest: boolean;
  score: number;
}

// ─── Platts suggestion view model ──────────────────────────────────

export interface PlattsSuggestionViewModel {
  key: string;
  productType: PlattsSuggestionsResponseDto['items'][number]['productType'];
  description: string | null;
  matches: PlattsSuggestionsResponseDto['items'][number]['matches'];
}