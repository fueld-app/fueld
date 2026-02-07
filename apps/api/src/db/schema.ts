import {
  pgTable,
  text,
  boolean,
  timestamp,
  uuid,
  pgEnum,
  numeric,
  integer,
  jsonb,
  date,
  doublePrecision,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ═══════════════════════════════════════════════════════════════════════
//  PG ENUMS
// ═══════════════════════════════════════════════════════════════════════

export const roleEnum = pgEnum('role', [
  'ADMIN',
  'TRADER',
  'OPERATOR',
  'VIEWER',
]);

export const orderStatusEnum = pgEnum('order_status', [
  'INQUIRY',
  'OFFER',
  'CONFIRMED',
  'DELIVERED',
  'INVOICED',
  'PAID',
  'CANCELLED',
]);

export const productTypeEnum = pgEnum('product_type', [
  'VLSFO',
  'LSMGO',
  'IFO380',
  'MGO',
  'LUBE',
]);

export const paymentTermsEnum = pgEnum('payment_terms', [
  'CASH_ADVANCE',
  'ON_RECEIPT',
  'CREDIT_30',
]);

export const counterpartyTypeEnum = pgEnum('counterparty_type', [
  'SUPPLIER',
  'CLIENT',
  'BARGE',
]);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'DRAFT',
  'SENT',
  'OVERDUE',
  'PARTIALLY_PAID',
  'PAID',
  'VOID',
]);

// ═══════════════════════════════════════════════════════════════════════
//  1. MULTI-TENANCY ROOT
// ═══════════════════════════════════════════════════════════════════════

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  domain: text('domain').notNull().unique(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  2. USERS (extended with tenant, vacation/delegation)
// ═══════════════════════════════════════════════════════════════════════

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: roleEnum('role').notNull().default('VIEWER'),

  // Password auth (nullable — null when using O365 SSO only)
  passwordHash: text('password_hash'),

  // O365 SSO mapping
  o365Id: text('o365_id').unique(),

  // TOTP 2FA
  twoFactorSecret: text('two_factor_secret'),
  is2faEnabled: boolean('is_2fa_enabled').notNull().default(false),

  // Session management
  refreshToken: text('refresh_token'),

  // Vacation / delegation
  isOnLeave: boolean('is_on_leave').notNull().default(false),
  leaveEndDate: date('leave_end_date'),
  delegateId: uuid('delegate_id'), // FK added via relations (self-ref)

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  3. COUNTERPARTIES
// ═══════════════════════════════════════════════════════════════════════

export const counterparties = pgTable('counterparties', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  type: counterpartyTypeEnum('type').notNull(),
  creditLimit: numeric('credit_limit', { precision: 14, scale: 2 }).default('0'),
  creditUsed: numeric('credit_used', { precision: 14, scale: 2 }).default('0'),
  country: text('country'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  4. PLACES  (ports, anchorages, sub-ports, terminals, fields)
//     Modelled after LLI /placeadvancedchars_v3  →  placeDetails
// ═══════════════════════════════════════════════════════════════════════

export const placeTypeEnum = pgEnum('place_type', [
  'POR',   // Port
  'PSP',   // Sub Port
  'ANC',   // Anchorage
  'TER',   // Terminal
  'FIL',   // Hydrocarbon Field
]);

export const places = pgTable('places', {
  id: uuid('id').defaultRandom().primaryKey(),

  // ── LLI identifiers ────────────────────────────────────────────────
  lliPlaceId: text('lli_place_id').unique(),        // LLI unique place ID
  unlocode: text('unlocode'),                       // UN/LOCODE e.g. "NL RTM"

  // ── Core info ──────────────────────────────────────────────────────
  name: text('name').notNull(),
  country: text('country').notNull(),                // ISO-3 or short code
  countryIso: text('country_iso'),                   // ISO-3 code from LLI
  area: text('area'),                                // e.g. "N Cont Europe"
  subRegion: text('sub_region'),                     // e.g. "Western Asia"
  placeType: placeTypeEnum('place_type'),            // POR / ANC / PSP / TER / FIL
  timezone: text('timezone'),                        // e.g. "GMT +04H"

  // ── Geo ────────────────────────────────────────────────────────────
  lat: doublePrecision('lat'),
  long: doublePrecision('long'),

  // ── Port-specific extras ───────────────────────────────────────────
  admiraltyChart: text('admiralty_chart'),            // e.g. "122/132/133"
  principalFacilities: jsonb('principal_facilities'), // string[] from LLI
  portAuthorityName: text('port_authority_name'),

  // ── Hierarchy (sub-port → parent port) ─────────────────────────────
  parentPlaceId: uuid('parent_place_id'),            // self-ref FK
  parentPlaceName: text('parent_place_name'),

  // ── Sync metadata ─────────────────────────────────────────────────
  lliLastUpdated: timestamp('lli_last_updated', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  5. VESSELS
// ═══════════════════════════════════════════════════════════════════════

export const vessels = pgTable('vessels', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  imo: text('imo').unique(),
  mmsi: text('mmsi').unique(),
  flag: text('flag'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  6. ORDERS (the Trading Aggregate root)
// ═══════════════════════════════════════════════════════════════════════

export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  clientId: uuid('client_id').notNull().references(() => counterparties.id),
  vesselId: uuid('vessel_id').notNull().references(() => vessels.id),
  placeId: uuid('place_id').notNull().references(() => places.id),
  salesRepId: uuid('sales_rep_id').references(() => users.id),
  status: orderStatusEnum('status').notNull().default('INQUIRY'),

  eta: timestamp('eta', { withTimezone: true }),
  etd: timestamp('etd', { withTimezone: true }),

  // Analytics
  lossReason: text('loss_reason'),
  closedAt: timestamp('closed_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  7. ORDER ITEMS (line items per order)
// ═══════════════════════════════════════════════════════════════════════

export const orderItems = pgTable('order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  supplierId: uuid('supplier_id').references(() => counterparties.id),

  productType: productTypeEnum('product_type').notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull(),
  unit: text('unit').notNull().default('MT'),

  costPrice: numeric('cost_price', { precision: 12, scale: 4 }),
  salesPrice: numeric('sales_price', { precision: 12, scale: 4 }),
  profit: numeric('profit', { precision: 12, scale: 4 }),

  paymentTerms: paymentTermsEnum('payment_terms'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  8. INVOICES
// ═══════════════════════════════════════════════════════════════════════

export const invoices = pgTable('invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  invoiceNumber: text('invoice_number').notNull().unique(),
  status: invoiceStatusEnum('status').notNull().default('DRAFT'),
  dueDate: date('due_date').notNull(),
  pdfPath: text('pdf_path'),

  amount: numeric('amount', { precision: 14, scale: 2 }),
  amountPaid: numeric('amount_paid', { precision: 14, scale: 2 }).default('0'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  9. INVOICE COMMENTS (collections workflow)
// ═══════════════════════════════════════════════════════════════════════

export const invoiceComments = pgTable('invoice_comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  comment: text('comment').notNull(),
  nextActionDate: date('next_action_date'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  10. AUDIT LOGS
// ═══════════════════════════════════════════════════════════════════════

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  changesJson: jsonb('changes_json'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  RELATIONS (Drizzle relational query builder)
// ═══════════════════════════════════════════════════════════════════════

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  counterparties: many(counterparties),
  orders: many(orders),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
  delegate: one(users, {
    fields: [users.delegateId],
    references: [users.id],
    relationName: 'delegation',
  }),
  salesOrders: many(orders),
  invoiceComments: many(invoiceComments),
  auditLogs: many(auditLogs),
}));

export const counterpartiesRelations = relations(counterparties, ({ one, many }) => ({
  tenant: one(tenants, { fields: [counterparties.tenantId], references: [tenants.id] }),
  clientOrders: many(orders),
  suppliedItems: many(orderItems),
}));

export const placesRelations = relations(places, ({ one, many }) => ({
  parentPlace: one(places, {
    fields: [places.parentPlaceId],
    references: [places.id],
    relationName: 'parentChild',
  }),
  childPlaces: many(places, { relationName: 'parentChild' }),
  orders: many(orders),
}));

export const vesselsRelations = relations(vessels, ({ many }) => ({
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  tenant: one(tenants, { fields: [orders.tenantId], references: [tenants.id] }),
  client: one(counterparties, { fields: [orders.clientId], references: [counterparties.id] }),
  vessel: one(vessels, { fields: [orders.vesselId], references: [vessels.id] }),
  place: one(places, { fields: [orders.placeId], references: [places.id] }),
  salesRep: one(users, { fields: [orders.salesRepId], references: [users.id] }),
  items: many(orderItems),
  invoices: many(invoices),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  supplier: one(counterparties, { fields: [orderItems.supplierId], references: [counterparties.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  order: one(orders, { fields: [invoices.orderId], references: [orders.id] }),
  comments: many(invoiceComments),
}));

export const invoiceCommentsRelations = relations(invoiceComments, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceComments.invoiceId], references: [invoices.id] }),
  user: one(users, { fields: [invoiceComments.userId], references: [users.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

// ═══════════════════════════════════════════════════════════════════════
//  TYPE INFERENCE HELPERS
// ═══════════════════════════════════════════════════════════════════════

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export type Counterparty = typeof counterparties.$inferSelect;
export type NewCounterparty = typeof counterparties.$inferInsert;

export type Place = typeof places.$inferSelect;
export type NewPlace = typeof places.$inferInsert;

export type Vessel = typeof vessels.$inferSelect;
export type NewVessel = typeof vessels.$inferInsert;

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;

export type InvoiceComment = typeof invoiceComments.$inferSelect;
export type NewInvoiceComment = typeof invoiceComments.$inferInsert;

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
