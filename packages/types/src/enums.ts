// ─── Enums ───────────────────────────────────────────────────────────

/** Full order lifecycle status. */
export enum OrderStatus {
  Inquiry = 'INQUIRY',
  Offer = 'OFFER',
  Confirmed = 'CONFIRMED',
  Delivered = 'DELIVERED',
  Invoiced = 'INVOICED',
  Paid = 'PAID',
  Cancelled = 'CANCELLED',
}

/** Product types available for order items. */
export enum ProductType {
  VLSFO = 'VLSFO',
  LSMGO = 'LSMGO',
  IFO380 = 'IFO380',
  MGO = 'MGO',
  LUBE = 'LUBE',
}

/** Payment terms for order line items. */
export enum PaymentTerms {
  CashAdvance = 'CASH_ADVANCE',
  OnReceipt = 'ON_RECEIPT',
  Credit30 = 'CREDIT_30',
}

export enum PaymentTermType {
  Credit = 'CREDIT',
  CashOnDelivery = 'COD',
  Prepayment = 'PREPAY',
}

export enum OrderAttachmentType {
  Bdr = 'BDR',
  Other = 'OTHER',
}

/** Counterparty classification. */
export enum CounterpartyType {
  Supplier = 'SUPPLIER',
  Client = 'CLIENT',
  Barge = 'BARGE',
}

/** Invoice lifecycle status. */
export enum InvoiceStatus {
  Draft = 'DRAFT',
  Sent = 'SENT',
  Overdue = 'OVERDUE',
  PartiallyPaid = 'PARTIALLY_PAID',
  Paid = 'PAID',
  Void = 'VOID',
}

/** User roles. */
export enum Role {
  Admin = 'ADMIN',
  Trader = 'TRADER',
  Finance = 'FINANCE',
  Teamlead = 'TEAMLEAD',
  CreditManager = 'CREDITMANAGER',
}

/** Credit application lifecycle status. */
export enum CreditApplicationStatus {
  Pending = 'PENDING',
  Approved = 'APPROVED',
  Rejected = 'REJECTED',
  Cancelled = 'CANCELLED',
}

/** Credit application review decision. */
export enum CreditApplicationReviewDecision {
  Approved = 'APPROVED',
  Rejected = 'REJECTED',
}

// ── Risk Monitoring ──

export enum RiskProviderClass {
  Watchlist = 'WATCHLIST',
  MaritimeContext = 'MARITIME_CONTEXT',
  BusinessDistress = 'BUSINESS_DISTRESS',
}

export enum RiskCheckStatus {
  Clear = 'CLEAR',
  Hit = 'HIT',
  Error = 'ERROR',
  NoCoverage = 'NO_COVERAGE',
}

export enum RiskHitSeverity {
  Critical = 'CRITICAL',
  High = 'HIGH',
  Medium = 'MEDIUM',
  Low = 'LOW',
  Info = 'INFO',
}

export enum RiskOverrideStatus {
  Pending = 'PENDING',
  Approved = 'APPROVED',
  Expired = 'EXPIRED',
  Revoked = 'REVOKED',
}

export enum PricingModel {
  Fixed = 'FIXED',
  Formula = 'FORMULA',
}
