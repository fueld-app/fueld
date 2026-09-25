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
  Lost = 'LOST',
}

/** Product types available for order items. */
export enum ProductType {
  VLSFO = 'VLSFO',
  ULSFO = 'ULSFO',
  LSMGO = 'LSMGO',
  MGO = 'MGO',
  LUBE = 'LUBE',
  IFO380CST = 'IFO380CST',
  IFO180CST = 'IFO180CST',
  IFO120CST = 'IFO120CST',
  IFO30CST = 'IFO30CST',
  IFO = 'IFO',
  MDO = 'MDO',
  LSIFO = 'LSIFO',
  ITEM = 'ITEM',
  COMMISSION = 'COMMISSION',
  HIRE = 'HIRE',
  PAYMENT = 'PAYMENT',
  CREDIT_NOTE = 'CREDIT_NOTE',
  CUTTERSTOCK = 'CUTTERSTOCK',
  PYGAS = 'PYGAS',
  BARGING_FEE = 'BARGING_FEE',
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
  Broker = 'BROKER',
  Agent = 'AGENT',
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
  OperationsManager = 'OPERATIONSMANAGER',
  Light = 'LIGHT',
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

export enum PlattsReportStatus {
  Uploaded = 'UPLOADED',
  Parsing = 'PARSING',
  Ready = 'READY',
  Failed = 'FAILED',
  Superseded = 'SUPERSEDED',
}

export enum PlattsReportFamily {
  EuropeanMarketscan = 'EUROPEAN_MARKETSCAN',
}

export enum PlattsSectionType {
  Trades = 'TRADES',
  Bids = 'BIDS',
  Offers = 'OFFERS',
  Withdrawals = 'WITHDRAWALS',
  Commentary = 'COMMENTARY',
  Other = 'OTHER',
}

// ─── Commissionable lines ────────────────────────────────────────────

/**
 * Order-line types that a broker does NOT earn a per-MT commission on: fees,
 * services and ledger adjustments.
 *
 * Moxie's rule (Daniek, 2026-09-25): broker commission is "$3/MT" on the
 * PRODUCT delivered, not on the charges around it. These types are stored as
 * their own line with the charge as a lump sum — a barging fee of 2,500 is
 * `quantity: 1` — so multiplying them by a per-MT rate billed a flat $3 as
 * though it were a tonne, and counted the fee as tonnage in the reported total.
 */
export const NON_PRODUCT_LINE_TYPES: ReadonlySet<string> = new Set([
  'BARGING_FEE',
  'COMMISSION',
  'HIRE',
  'PAYMENT',
  'CREDIT_NOTE',
  'ITEM',
]);

/**
 * True when a broker deal earns commission on this line.
 *
 * Deny-list semantics: only the known fee/service types are excluded, and
 * anything else — including an unrecognised or absent product type — is
 * commissionable. That direction matters. `productType` is NOT NULL in the
 * schema, so a stored line always carries one; an absent value only occurs in a
 * caller that failed to map the column. Treating that as non-commissionable
 * would silently zero that caller's entire commission total, which is a worse
 * failure than commissioning a line we could not classify.
 *
 * `ITEM` is a generic catch-all the traders use for charges (agency, trucking,
 * taxes, overtime — Moxie stores exactly those under it), never for fuel, which
 * always carries its own product type. A custom blend (B30/B100) is not in the
 * set and stays commissionable.
 *
 * Both the commission report (apps/api reports.service) and the broker-deal
 * profit column (order-financing) resolve through this, so the two money paths
 * cannot disagree about which lines earn.
 */
export function isCommissionableLine(productType: string | null | undefined): boolean {
  const type = (productType ?? '').trim().toUpperCase();
  return !NON_PRODUCT_LINE_TYPES.has(type);
}
