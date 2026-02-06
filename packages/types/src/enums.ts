// ─── Enums ───────────────────────────────────────────────────────────

/** Status of a bunker fuel enquiry / order. */
export enum OrderStatus {
  Draft = 'DRAFT',
  Submitted = 'SUBMITTED',
  Confirmed = 'CONFIRMED',
  Delivered = 'DELIVERED',
  Cancelled = 'CANCELLED',
}

/** Supported fuel grades in the Fueld platform. */
export enum FuelGrade {
  VLSFO = 'VLSFO',
  HSFO = 'HSFO',
  LSMGO = 'LSMGO',
  MGO = 'MGO',
}

/** User roles. */
export enum Role {
  Admin = 'ADMIN',
  Trader = 'TRADER',
  Operator = 'OPERATOR',
  Viewer = 'VIEWER',
}
