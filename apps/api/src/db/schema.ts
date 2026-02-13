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
  'FINANCE',
  'TEAMLEAD',
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

export const paymentTermTypeEnum = pgEnum('payment_term_type', [
  'CREDIT',
  'COD',
  'PREPAY',
]);

export const orderAttachmentTypeEnum = pgEnum('order_attachment_type', [
  'BDR',
  'OTHER',
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

export interface TenantSettings {
  activityRetentionDays?: number;
  // Security / Auth
  ssoProvider?: 'microsoft' | 'google' | 'none';
  ssoClientId?: string;
  ssoClientSecret?: string;
  ssoTenantId?: string;         // Microsoft Entra tenant ID
  ssoEnabled?: boolean;
  enforce2FA?: boolean;         // Force 2FA for email/password users
  passkeyEnabled?: boolean;      // Allow passkeys as a 2FA method
  passkeyAllowPasswordless?: boolean; // Allow passkeys for passwordless login
  tokenExpirationMinutes?: number;  // JWT lifetime (default 15)
  sessionTimeoutMinutes?: number;   // Idle session timeout (default 480 = 8h)
  // Branding
  defaultLogoUrl?: string;       // Default company logo if a company has none
  // Order numbering
  orderNumberTemplate?: string;  // e.g. '{PREFIX}{YYYY}{MM}{DD}-{SEQ:6}', default '{YYYY}{MM}{DD}-{SEQ:6}'
  orderNumberPrefix?: string;    // optional prefix, e.g. 'FU-'
  // Vessel-company roles (configurable from admin)
  vesselCompanyRoles?: { key: string; label: string; group: string; description?: string; seasearcherCode?: string }[];
}

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  domain: text('domain').notNull().unique(),
  settings: jsonb('settings').$type<TenantSettings>().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  2. TEAMS (groups of users with shared company access)
// ═══════════════════════════════════════════════════════════════════════

export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  3. USERS (extended with tenant, vacation/delegation, team)
// ═══════════════════════════════════════════════════════════════════════

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: roleEnum('role').notNull().default('TRADER'),

  // Team membership (determines default own-company access)
  teamId: uuid('team_id').references(() => teams.id),

  // Account status
  isActive: boolean('is_active').notNull().default(true),

  // Password auth (nullable — null when using O365 SSO only)
  passwordHash: text('password_hash'),

  // O365 SSO mapping
  o365Id: text('o365_id').unique(),

  // TOTP 2FA
  twoFactorSecret: text('two_factor_secret'),
  is2faEnabled: boolean('is_2fa_enabled').notNull().default(false),

  // Session management
  refreshToken: text('refresh_token'),

  // Profile
  avatarUrl: text('avatar_url'),

  // IP restriction (JSON array of allowed CIDR/IPs, null = unrestricted)
  allowedIps: text('allowed_ips'),

  // Vacation / delegation
  isOnLeave: boolean('is_on_leave').notNull().default(false),
  leaveEndDate: date('leave_end_date'),
  delegateId: uuid('delegate_id'), // FK added via relations (self-ref)

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  3b. PUSH NOTIFICATION SUBSCRIPTIONS
// ═══════════════════════════════════════════════════════════════════════

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  expirationTime: timestamp('expiration_time', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  4. COUNTERPARTIES
// ═══════════════════════════════════════════════════════════════════════

export const counterparties = pgTable('counterparties', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  type: counterpartyTypeEnum('type').notNull(),
  types: jsonb('types').$type<string[]>().default([]),
  creditLimit: numeric('credit_limit', { precision: 14, scale: 2 }).default('0'),
  creditUsed: numeric('credit_used', { precision: 14, scale: 2 }).default('0'),
  country: text('country'),

  // Own company flag — marks this counterparty as one of "our" companies
  isOwnCompany: boolean('is_own_company').notNull().default(false),

  // ── Seasearcher / LLI enrichment ───────────────────────────────
  seasearcherId: text('seasearcher_id').unique(),      // Seasearcher company ID
  companyImo: text('company_imo'),                     // LLI company IMO
  countryIso: text('country_iso'),                     // ISO-3 code (e.g. DNK)
  yearFormed: integer('year_formed'),
  companyRoles: jsonb('company_roles').$type<string[]>(),
  fleetSize: integer('fleet_size'),
  headOfficeAddress: text('head_office_address'),
  headOfficePhone: text('head_office_phone'),
  headOfficeEmail: text('head_office_email'),
  website: text('website'),
  isSanctioned: boolean('is_sanctioned').default(false),
  lastSynced: timestamp('last_synced', { withTimezone: true }),

  // ── Responsible user ───────────────────────────────────────────────
  responsibleUserId: uuid('responsible_user_id').references(() => users.id),

  // Company logo (for own companies — used in PDF generation)
  logoUrl: text('logo_url'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  5. TEAM ↔ OWN COMPANY ACCESS (which own companies a team can access)
// ═══════════════════════════════════════════════════════════════════════

export const teamCompanies = pgTable('team_companies', {
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  counterpartyId: uuid('counterparty_id').notNull().references(() => counterparties.id, { onDelete: 'cascade' }),
});

// ═══════════════════════════════════════════════════════════════════════
//  6. USER ↔ OWN COMPANY OVERRIDES (per-user, overrides team defaults)
// ═══════════════════════════════════════════════════════════════════════

export const userCompanyOverrides = pgTable('user_company_overrides', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  counterpartyId: uuid('counterparty_id').notNull().references(() => counterparties.id, { onDelete: 'cascade' }),
});

// ═══════════════════════════════════════════════════════════════════════
//  7. COMPANY GROUPS (named reusable groups of companies)
// ═══════════════════════════════════════════════════════════════════════

export const companyGroups = pgTable('company_groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const companyGroupMembers = pgTable('company_group_members', {
  groupId: uuid('group_id').notNull().references(() => companyGroups.id, { onDelete: 'cascade' }),
  counterpartyId: uuid('counterparty_id').notNull().references(() => counterparties.id, { onDelete: 'cascade' }),
});

// ═══════════════════════════════════════════════════════════════════════
//  8. PLACES  (ports, anchorages, sub-ports, terminals, fields)
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

  // ── Hierarchy (sub-port → parent port) ─────────────────────────────
  parentPlaceId: uuid('parent_place_id'),            // self-ref FK
  parentPlaceName: text('parent_place_name'),

  // ── Responsible user ───────────────────────────────────────────────
  responsibleUserId: uuid('responsible_user_id').references(() => users.id),

  // ── Sync metadata ─────────────────────────────────────────────────
  lliLastUpdated: timestamp('lli_last_updated', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  8b. PORT SUPPLIERS  (user-managed supplier list per place)
// ═══════════════════════════════════════════════════════════════════════

export const portSuppliers = pgTable('port_suppliers', {
  id: uuid('id').defaultRandom().primaryKey(),
  placeId: uuid('place_id').notNull().references(() => places.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id').notNull().references(() => counterparties.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => companyContacts.id, { onDelete: 'set null' }),
  products: jsonb('products').$type<string[]>().default([]),  // product type tags
  note: text('note'),
  addedById: uuid('added_by_id').references(() => users.id),
  addedByName: text('added_by_name'),    // cached user name
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  8c. VESSEL COMPANIES (user-managed company associations per vessel)
// ═══════════════════════════════════════════════════════════════════════

export const vesselCompanyRoleEnum = pgEnum('vessel_company_role', [
  'REGISTERED_OWNER',
  'NOMINAL_OWNER',
  'BENEFICIAL_OWNER',
  'GROUP_BENEFICIAL_OWNER',
  'COMMERCIAL_OPERATOR',
  'THIRD_PARTY_OPERATOR',
  'DISPONENT_OWNER',
  'BAREBOAT_CHARTERER',
  'TECHNICAL_MANAGER',
  'ISM_MANAGER',
  'SHIP_MANAGER',
]);

export const vesselCompanies = pgTable('vessel_companies', {
  id: uuid('id').defaultRandom().primaryKey(),
  vesselId: uuid('vessel_id').notNull().references(() => vessels.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id').notNull().references(() => counterparties.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  source: text('source').notNull().default('manual'),  // 'manual' | 'seasearcher'
  contactId: uuid('contact_id').references(() => companyContacts.id, { onDelete: 'set null' }),
  note: text('note'),
  addedById: uuid('added_by_id').references(() => users.id),
  addedByName: text('added_by_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  9. VESSELS
// ═══════════════════════════════════════════════════════════════════════

export const vessels = pgTable('vessels', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  imo: text('imo').unique(),
  mmsi: text('mmsi').unique(),
  seasearcherId: text('seasearcher_id').unique(),
  flag: text('flag'),
  flagCode: text('flag_code'),
  type: text('type'),
  status: text('status'),
  loa: doublePrecision('loa'),
  breadth: doublePrecision('breadth'),
  depth: doublePrecision('depth'),
  draught: doublePrecision('draught'),
  deadWeightTonnage: doublePrecision('dead_weight_tonnage'),
  grossTonnage: doublePrecision('gross_tonnage'),
  buildYear: integer('build_year'),
  builder: text('builder'),
  classificationSociety: text('classification_society'),
  lastSynced: timestamp('last_synced', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  10. ORDERS (the Trading Aggregate root)
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
//  ORDER NUMBER SEQUENCES (global incrementing counter per tenant)
// ═══════════════════════════════════════════════════════════════════════

export const orderNumberSequences = pgTable('order_number_sequences', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id).primaryKey(),
  lastSeq: integer('last_seq').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),

  // External order number (e.g. 20260209-000001) — unique, human-readable
  orderNumber: text('order_number').unique(),

  clientId: uuid('client_id').notNull().references(() => counterparties.id),
  vesselId: uuid('vessel_id').notNull().references(() => vessels.id),
  placeId: uuid('place_id').notNull().references(() => places.id),
  salesRepId: uuid('sales_rep_id').references(() => users.id),
  status: orderStatusEnum('status').notNull().default('INQUIRY'),

  // Invoicing — which of our own companies is invoicing this order
  invoicingCompanyId: uuid('invoicing_company_id').references(() => counterparties.id),

  // Currency for pricing (default USD)
  currency: text('currency').notNull().default('USD'),

  eta: timestamp('eta', { withTimezone: true }),
  etd: timestamp('etd', { withTimezone: true }),

  customerPaymentTermType: paymentTermTypeEnum('customer_payment_term_type'),
  customerCreditDays: integer('customer_credit_days'),
  customerNote: text('customer_note'),

  supplierId: uuid('supplier_id').references(() => counterparties.id),
  supplierPaymentTermType: paymentTermTypeEnum('supplier_payment_term_type'),
  supplierCreditDays: integer('supplier_credit_days'),
  supplierNote: text('supplier_note'),

  // Analytics
  lossReason: text('loss_reason'),
  closedAt: timestamp('closed_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  11. ORDER ITEMS (line items per order)
// ═══════════════════════════════════════════════════════════════════════

export const orderItems = pgTable('order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),

  productType: productTypeEnum('product_type').notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull(),
  quantityMin: numeric('quantity_min', { precision: 12, scale: 3 }),
  quantityMax: numeric('quantity_max', { precision: 12, scale: 3 }),
  unit: text('unit').notNull().default('MT'),

  costPrice: numeric('cost_price', { precision: 12, scale: 4 }),
  costCurrency: text('cost_currency').notNull().default('USD'),
  salesPrice: numeric('sales_price', { precision: 12, scale: 4 }),
  salesCurrency: text('sales_currency').notNull().default('USD'),
  profit: numeric('profit', { precision: 12, scale: 4 }),

  paymentTerms: paymentTermsEnum('payment_terms'),

  customerNote: text('customer_note'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  11b. ORDER ATTACHMENTS
// ═══════════════════════════════════════════════════════════════════════

export const orderAttachments = pgTable('order_attachments', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  type: orderAttachmentTypeEnum('type').notNull().default('OTHER'),
  fileName: text('file_name').notNull(),
  filePath: text('file_path').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  12. INVOICES
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
//  12b. CUSTOMER PAYMENTS (ledger entries)
// ═══════════════════════════════════════════════════════════════════════

export const customerPayments = pgTable('customer_payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  customerId: uuid('customer_id').notNull().references(() => counterparties.id),
  orderId: uuid('order_id').references(() => orders.id),
  invoiceId: uuid('invoice_id').references(() => invoices.id),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('USD'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  method: text('method'),
  note: text('note'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  13. INVOICE COMMENTS (collections workflow)
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
//  14. AUDIT LOGS
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
//  14b. ACTIVITY LOGS (comprehensive user activity tracking)
// ═══════════════════════════════════════════════════════════════════════

export const activityLogs = pgTable('activity_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  userId: uuid('user_id').references(() => users.id),
  action: text('action').notNull(),          // VIEW, CREATE, UPDATE, DELETE
  entityType: text('entity_type').notNull(),  // company, place, vessel, order, ...
  entityId: uuid('entity_id'),
  entityName: text('entity_name'),            // cached for display
  httpMethod: text('http_method'),
  httpPath: text('http_path'),
  pageTitle: text('page_title'),
  clientIp: text('client_ip'),
  userAgent: text('user_agent'),
  platform: text('platform'),                // e.g. 'Chrome / macOS'
  timezone: text('timezone'),                // e.g. 'Europe/London'
  language: text('language'),                // e.g. 'en-GB'
  country: text('country'),                  // e.g. 'United Kingdom'
  city: text('city'),                        // e.g. 'London'
  metadata: jsonb('metadata'),               // extra details
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  15. CREDIT LINES (supplier & customer credit)
// ═══════════════════════════════════════════════════════════════════════

export const creditLineTypeEnum = pgEnum('credit_line_type', [
  'SUPPLIER',
  'CUSTOMER',
]);

export const creditLines = pgTable('credit_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  type: creditLineTypeEnum('type').notNull(),

  creditAmount: numeric('credit_amount', { precision: 14, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('USD'),
  expires: date('expires'),
  periodDays: integer('period_days').notNull().default(30),

  // Customer credit specific
  fromDelivery: boolean('from_delivery').notNull().default(false),
  qualified: boolean('qualified').notNull().default(false),

  notes: text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  16. CREDIT LINE ↔ OWN COMPANIES (our entities on this credit line)
// ═══════════════════════════════════════════════════════════════════════

export const creditLineCompanies = pgTable('credit_line_companies', {
  creditLineId: uuid('credit_line_id').notNull().references(() => creditLines.id, { onDelete: 'cascade' }),
  counterpartyId: uuid('counterparty_id').notNull().references(() => counterparties.id, { onDelete: 'cascade' }),
});

// ═══════════════════════════════════════════════════════════════════════
//  16b. CREDIT LINE ↔ COUNTERPARTIES (external companies: suppliers or customers)
// ═══════════════════════════════════════════════════════════════════════

export const creditLineCounterparties = pgTable('credit_line_counterparties', {
  creditLineId: uuid('credit_line_id').notNull().references(() => creditLines.id, { onDelete: 'cascade' }),
  counterpartyId: uuid('counterparty_id').notNull().references(() => counterparties.id, { onDelete: 'cascade' }),
});

// ═══════════════════════════════════════════════════════════════════════
//  17. INVITATIONS
// ═══════════════════════════════════════════════════════════════════════

export const invitations = pgTable('invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: roleEnum('role').notNull().default('TRADER'),
  token: text('token').notNull().unique(),
  invitedBy: uuid('invited_by').notNull().references(() => users.id),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  19. INTEGRATION CREDENTIALS (encrypted API keys / passwords)
// ═══════════════════════════════════════════════════════════════════════

export const integrationCredentials = pgTable('integration_credentials', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  provider: text('provider').notNull(),              // e.g. 'LLI'
  key: text('key').notNull(),                        // e.g. 'username', 'password'
  encryptedValue: text('encrypted_value').notNull(),  // AES-256-GCM encrypted
  iv: text('iv').notNull(),                          // initialisation vector (hex)
  authTag: text('auth_tag').notNull(),               // GCM auth tag (hex)
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  20. COMPANY CONTACTS (manual & synced from Seasearcher)
// ═══════════════════════════════════════════════════════════════════════

export const companyContacts = pgTable('company_contacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  counterpartyId: uuid('counterparty_id').notNull().references(() => counterparties.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  role: text('role'),                          // e.g. 'Director', 'Bunker Manager'
  phone: text('phone'),
  fax: text('fax'),
  email: text('email'),
  notes: text('notes'),
  source: text('source').notNull().default('manual'), // 'manual' | 'seasearcher'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  21. COMPANY EMAILS (flexible email types per company)
// ═══════════════════════════════════════════════════════════════════════

export const companyEmails = pgTable('company_emails', {
  id: uuid('id').defaultRandom().primaryKey(),
  counterpartyId: uuid('counterparty_id').notNull().references(() => counterparties.id, { onDelete: 'cascade' }),
  emailType: text('email_type').notNull(),     // 'sales' | 'invoice' | 'inquiry' | 'general' | custom
  email: text('email').notNull(),
  label: text('label'),                        // optional friendly label
  isPrimary: boolean('is_primary').notNull().default(false),
  addedById: uuid('added_by_id').references(() => users.id),
  addedByName: text('added_by_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  ENTITY COMMENTS (polymorphic — place, company, order, vessel)
// ═══════════════════════════════════════════════════════════════════════

export const entityComments = pgTable('entity_comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityType: text('entity_type').notNull(),   // 'place' | 'company' | 'order' | 'vessel'
  entityId: uuid('entity_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id),
  userName: text('user_name').notNull(),        // cached for display
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  RELATIONS (Drizzle relational query builder)
// ═══════════════════════════════════════════════════════════════════════

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  counterparties: many(counterparties),
  orders: many(orders),
  teams: many(teams),
  companyGroups: many(companyGroups),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  tenant: one(tenants, { fields: [teams.tenantId], references: [tenants.id] }),
  members: many(users),
  teamCompanies: many(teamCompanies),
}));

export const teamCompaniesRelations = relations(teamCompanies, ({ one }) => ({
  team: one(teams, { fields: [teamCompanies.teamId], references: [teams.id] }),
  company: one(counterparties, { fields: [teamCompanies.counterpartyId], references: [counterparties.id] }),
}));

export const userCompanyOverridesRelations = relations(userCompanyOverrides, ({ one }) => ({
  user: one(users, { fields: [userCompanyOverrides.userId], references: [users.id] }),
  company: one(counterparties, { fields: [userCompanyOverrides.counterpartyId], references: [counterparties.id] }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
  team: one(teams, { fields: [users.teamId], references: [teams.id] }),
  delegate: one(users, {
    fields: [users.delegateId],
    references: [users.id],
    relationName: 'delegation',
  }),
  companyOverrides: many(userCompanyOverrides),
  salesOrders: many(orders),
  invoiceComments: many(invoiceComments),
  auditLogs: many(auditLogs),
  passkeys: many(passkeys),
}));

// ═══════════════════════════════════════════════════════════════════════
//  PASSKEYS (WebAuthn / FIDO2 credentials)
// ═══════════════════════════════════════════════════════════════════════

export const passkeys = pgTable('passkeys', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  credentialId: text('credential_id').notNull().unique(),  // base64url-encoded credential ID
  publicKey: text('public_key').notNull(),                 // base64url-encoded public key
  counter: integer('counter').notNull().default(0),        // signature counter for clone detection
  deviceType: text('device_type'),                         // 'singleDevice' | 'multiDevice'
  backedUp: boolean('backed_up').notNull().default(false), // whether credential is backed up (synced)
  transports: text('transports'),                          // comma-separated: usb,ble,nfc,internal
  friendlyName: text('friendly_name').notNull(),           // user-assigned name, e.g. "MacBook Touch ID"
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const passkeysRelations = relations(passkeys, ({ one }) => ({
  user: one(users, { fields: [passkeys.userId], references: [users.id] }),
}));

export const counterpartiesRelations = relations(counterparties, ({ one, many }) => ({
  tenant: one(tenants, { fields: [counterparties.tenantId], references: [tenants.id] }),
  responsibleUser: one(users, { fields: [counterparties.responsibleUserId], references: [users.id] }),
  clientOrders: many(orders),
  suppliedItems: many(orderItems),
  teamCompanies: many(teamCompanies),
  userOverrides: many(userCompanyOverrides),
  groupMemberships: many(companyGroupMembers),
  creditLineCompanies: many(creditLineCompanies),
  creditLineCounterparties: many(creditLineCounterparties),
  contacts: many(companyContacts),
  emails: many(companyEmails),
  vesselAssociations: many(vesselCompanies),
}));

export const companyContactsRelations = relations(companyContacts, ({ one }) => ({
  counterparty: one(counterparties, { fields: [companyContacts.counterpartyId], references: [counterparties.id] }),
}));

export const companyEmailsRelations = relations(companyEmails, ({ one }) => ({
  counterparty: one(counterparties, { fields: [companyEmails.counterpartyId], references: [counterparties.id] }),
  addedBy: one(users, { fields: [companyEmails.addedById], references: [users.id] }),
}));

export const companyGroupsRelations = relations(companyGroups, ({ one, many }) => ({
  tenant: one(tenants, { fields: [companyGroups.tenantId], references: [tenants.id] }),
  members: many(companyGroupMembers),
}));

export const companyGroupMembersRelations = relations(companyGroupMembers, ({ one }) => ({
  group: one(companyGroups, { fields: [companyGroupMembers.groupId], references: [companyGroups.id] }),
  company: one(counterparties, { fields: [companyGroupMembers.counterpartyId], references: [counterparties.id] }),
}));

export const placesRelations = relations(places, ({ one, many }) => ({
  parentPlace: one(places, {
    fields: [places.parentPlaceId],
    references: [places.id],
    relationName: 'parentChild',
  }),
  childPlaces: many(places, { relationName: 'parentChild' }),
  orders: many(orders),
  suppliers: many(portSuppliers),
  responsibleUser: one(users, {
    fields: [places.responsibleUserId],
    references: [users.id],
  }),
}));

export const portSuppliersRelations = relations(portSuppliers, ({ one }) => ({
  place: one(places, { fields: [portSuppliers.placeId], references: [places.id] }),
  company: one(counterparties, { fields: [portSuppliers.companyId], references: [counterparties.id] }),
  contact: one(companyContacts, { fields: [portSuppliers.contactId], references: [companyContacts.id] }),
  addedBy: one(users, { fields: [portSuppliers.addedById], references: [users.id] }),
}));

export const vesselsRelations = relations(vessels, ({ many }) => ({
  orders: many(orders),
  companies: many(vesselCompanies),
}));

export const vesselCompaniesRelations = relations(vesselCompanies, ({ one }) => ({
  vessel: one(vessels, { fields: [vesselCompanies.vesselId], references: [vessels.id] }),
  company: one(counterparties, { fields: [vesselCompanies.companyId], references: [counterparties.id] }),
  contact: one(companyContacts, { fields: [vesselCompanies.contactId], references: [companyContacts.id] }),
  addedBy: one(users, { fields: [vesselCompanies.addedById], references: [users.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  tenant: one(tenants, { fields: [orders.tenantId], references: [tenants.id] }),
  client: one(counterparties, { fields: [orders.clientId], references: [counterparties.id] }),
  vessel: one(vessels, { fields: [orders.vesselId], references: [vessels.id] }),
  place: one(places, { fields: [orders.placeId], references: [places.id] }),
  salesRep: one(users, { fields: [orders.salesRepId], references: [users.id] }),
  supplier: one(counterparties, { fields: [orders.supplierId], references: [counterparties.id] }),
  invoicingCompany: one(counterparties, {
    fields: [orders.invoicingCompanyId],
    references: [counterparties.id],
    relationName: 'invoicingOrders',
  }),
  items: many(orderItems),
  invoices: many(invoices),
  attachments: many(orderAttachments),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
}));

export const orderAttachmentsRelations = relations(orderAttachments, ({ one }) => ({
  order: one(orders, { fields: [orderAttachments.orderId], references: [orders.id] }),
  uploader: one(users, { fields: [orderAttachments.uploadedBy], references: [users.id] }),
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

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  tenant: one(tenants, { fields: [activityLogs.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [activityLogs.userId], references: [users.id] }),
}));

export const creditLinesRelations = relations(creditLines, ({ one, many }) => ({
  tenant: one(tenants, { fields: [creditLines.tenantId], references: [tenants.id] }),
  ownCompanies: many(creditLineCompanies),
  counterparties: many(creditLineCounterparties),
}));

export const creditLineCompaniesRelations = relations(creditLineCompanies, ({ one }) => ({
  creditLine: one(creditLines, { fields: [creditLineCompanies.creditLineId], references: [creditLines.id] }),
  company: one(counterparties, { fields: [creditLineCompanies.counterpartyId], references: [counterparties.id] }),
}));

export const creditLineCounterpartiesRelations = relations(creditLineCounterparties, ({ one }) => ({
  creditLine: one(creditLines, { fields: [creditLineCounterparties.creditLineId], references: [creditLines.id] }),
  company: one(counterparties, { fields: [creditLineCounterparties.counterpartyId], references: [counterparties.id] }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  tenant: one(tenants, { fields: [invitations.tenantId], references: [tenants.id] }),
  inviter: one(users, { fields: [invitations.invitedBy], references: [users.id] }),
}));

// ═══════════════════════════════════════════════════════════════════════
//  BANK ACCOUNTS (for own companies — used in invoices / PDFs)
// ═══════════════════════════════════════════════════════════════════════

export const bankAccounts = pgTable('bank_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  counterpartyId: uuid('counterparty_id').notNull().references(() => counterparties.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),           // e.g. "USD Main Account"
  bankName: text('bank_name').notNull(),
  accountName: text('account_name'),        // beneficiary name
  accountNumber: text('account_number'),     // local account number
  iban: text('iban'),
  swiftBic: text('swift_bic'),
  currency: text('currency').notNull(),      // ISO 4217: USD, EUR, AED…
  branchAddress: text('branch_address'),
  sortCode: text('sort_code'),              // UK sort code
  routingNumber: text('routing_number'),     // US routing number
  isDefault: boolean('is_default').notNull().default(false),
  notes: text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bankAccountsRelations = relations(bankAccounts, ({ one }) => ({
  company: one(counterparties, { fields: [bankAccounts.counterpartyId], references: [counterparties.id] }),
}));

// ═══════════════════════════════════════════════════════════════════════
//  TYPE INFERENCE HELPERS
// ═══════════════════════════════════════════════════════════════════════

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;

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

export type CreditLine = typeof creditLines.$inferSelect;
export type NewCreditLine = typeof creditLines.$inferInsert;

export type CompanyGroup = typeof companyGroups.$inferSelect;
export type NewCompanyGroup = typeof companyGroups.$inferInsert;

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;

export type IntegrationCredential = typeof integrationCredentials.$inferSelect;
export type NewIntegrationCredential = typeof integrationCredentials.$inferInsert;

export type CompanyContact = typeof companyContacts.$inferSelect;
export type NewCompanyContact = typeof companyContacts.$inferInsert;

export type CompanyEmail = typeof companyEmails.$inferSelect;
export type NewCompanyEmail = typeof companyEmails.$inferInsert;

export type VesselCompany = typeof vesselCompanies.$inferSelect;
export type NewVesselCompany = typeof vesselCompanies.$inferInsert;

export type ActivityLog = typeof activityLogs.$inferSelect;
export type NewActivityLog = typeof activityLogs.$inferInsert;

export type EntityComment = typeof entityComments.$inferSelect;
export type NewEntityComment = typeof entityComments.$inferInsert;

export type BankAccount = typeof bankAccounts.$inferSelect;
export type NewBankAccount = typeof bankAccounts.$inferInsert;
