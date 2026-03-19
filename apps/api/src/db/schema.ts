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
  'CREDITMANAGER',
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
  'MGO',
  'LUBE',
  'IFO380CST',
  'IFO180CST',
  'IFO120CST',
  'IFO30CST',
  'IFO',
  'MDO',
  'LSIFO',
  'ITEM',
  'COMMISSION',
  'HIRE',
  'PAYMENT',
  'CREDIT_NOTE',
  'CUTTERSTOCK',
  'PYGAS',
  'BARGING_FEE',
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

export const documentTypeEnum = pgEnum('document_type', [
  'OFFER',
  'PROFORMA_INVOICE',
  'INVOICE',
  'OTHER',
]);

export const riskProviderClassEnum = pgEnum('risk_provider_class', [
  'WATCHLIST',
  'MARITIME_CONTEXT',
  'BUSINESS_DISTRESS',
]);

export const riskCheckStatusEnum = pgEnum('risk_check_status', [
  'CLEAR',
  'HIT',
  'ERROR',
  'NO_COVERAGE',
]);

export const riskHitSeverityEnum = pgEnum('risk_hit_severity', [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'INFO',
]);

export const riskOverrideStatusEnum = pgEnum('risk_override_status', [
  'PENDING',
  'APPROVED',
  'EXPIRED',
  'REVOKED',
]);

export const pricingModelEnum = pgEnum('pricing_model', [
  'FIXED',
  'FORMULA',
]);

export const plattsReportStatusEnum = pgEnum('platts_report_status', [
  'UPLOADED',
  'PARSING',
  'READY',
  'FAILED',
  'SUPERSEDED',
]);

export const plattsReportFamilyEnum = pgEnum('platts_report_family', [
  'EUROPEAN_MARKETSCAN',
]);

export const plattsSectionTypeEnum = pgEnum('platts_section_type', [
  'TRADES',
  'BIDS',
  'OFFERS',
  'WITHDRAWALS',
  'COMMENTARY',
  'OTHER',
]);

// ═══════════════════════════════════════════════════════════════════════
//  1. MULTI-TENANCY ROOT
// ═══════════════════════════════════════════════════════════════════════

export interface TenantSettings {
  activityRetentionDays?: number;
  financingRateAnnual?: number;
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
  documentVerificationLinkExpiryDays?: number; // 0 = never expires
  // Branding
  defaultLogoUrl?: string;       // Default company logo if a company has none
  // Order numbering
  orderNumberTemplate?: string;  // e.g. '{PREFIX}{YYYY}{MM}{DD}-{SEQ:6}', default '{YYYY}{MM}{DD}-{SEQ:6}'
  orderNumberPrefix?: string;    // optional prefix, e.g. 'FU-'
  // Vessel-company roles (configurable from admin)
  vesselCompanyRoles?: { key: string; label: string; group: string; description?: string; seasearcherCode?: string }[];
  // Configurable product and unit options for order line items
  products?: string[];
  units?: string[];
  // Default conversion factors between units (e.g. MT→CBM = 1.1765)
  unitConversions?: { productType?: string; fromUnit: string; toUnit: string; factor: number }[];
  // Configurable currency options for order line items
  currencies?: string[];
  // Configurable company types (e.g. CLIENT, SUPPLIER, BARGE)
  companyTypes?: string[];
  // Configurable reasons required when cancelling inquiries
  inquiryCancelReasons?: string[];
  inquirySettings?: {
    supplierResponseUrlEnabled?: boolean;
    autoMarkNoReplyAfterHours?: number | null;
    defaultResponseDeadlineHours?: number;
  };
  // Configurable attachment types for order/inquiry attachments
  attachmentTypes?: string[];
  // Microsoft email sending
  approvedEmailDomains?: string[];            // Restrict Microsoft connect to these domains (empty/null = any)
  microsoftConnectForceUserEmail?: boolean;    // Force Microsoft connect to match the user's Fueld email
  // WhatsApp integration
  whatsappEnabled?: boolean;
  whatsappDefaultGroupJid?: string | null;
  whatsappIncomingRfqEnabled?: boolean;
  whatsappFirstInquiryGroupNotificationEnabled?: boolean;
  // Credit applications
  creditApplicationSettings?: {
    requiredApprovals: number;          // how many credit managers must approve (default 1)
    autoApplyOnApproval: boolean;       // auto-create/update credit line when approved
    immediateRejection: boolean;        // reject immediately on first rejection (vs wait for all)
    notifyCreditManagers: boolean;      // legacy — maps to notifyPush for backward compat
    notifyPush: boolean;                // send push notifications on new applications
    notifyEmail: boolean;               // send email to credit managers/admins
    notifyWhatsApp: boolean;            // send WhatsApp message to default group
    notifyTraderPush: boolean;          // send push notification to trader on approval/rejection
    notifyTraderEmail: boolean;         // send email to trader on approval/rejection
    notifyTraderWhatsApp: boolean;      // send WhatsApp msg to default group on approval/rejection
  };
  // Risk monitoring
  riskMonitoringSettings?: {
    enabled: boolean;                   // master toggle
    checkIntervalHours: number;         // how often to run background checks (default 24)
    openSanctionsEnabled: boolean;      // enable OpenSanctions watchlist checks
    openSanctionsBaseUrl: string;       // yente API URL (e.g. http://localhost:8000)
    companiesHouseEnabled: boolean;     // enable Companies House (UK) distress checks
    companiesHouseApiKey: string;       // Companies House API key
    seasearcherEnabled: boolean;        // enable SeaSearcher maritime context checks
    autoEnforceOnHit: boolean;          // auto-freeze credit on trusted-source hit
    overrideExpiryDays: number;         // override window in days (default 7)
    notifyPush: boolean;
    notifyEmail: boolean;
    notifyWhatsApp: boolean;
  };
  // Vessel sanction checks (TankerTrackers)
  vesselSanctionSettings?: {
    enabled: boolean;                   // master toggle
    checkIntervalHours: number;         // how often to run checks (default 24)
    notifyPush: boolean;
    notifyEmail: boolean;
    notifyWhatsApp: boolean;
  };
  // Broker settings
  brokerCcCustomer?: boolean;  // When brokerGetsAll, also CC the original customer contact (default false)
  // Follow-up settings
  followUpSettings?: {
    defaultFollowUpDays: number;  // Default days ahead for follow-up date (default 90)
  };
  // Company segmentation — admin-configurable categories & options
  segmentCategories?: {
    key: string;           // stable identifier (e.g. 'business', 'purchasing')
    label: string;         // display name
    mode: 'multi' | 'single';
    options: { key: string; label: string; description?: string }[];
  }[];
  // Shared report presets and schedules
  reportsSettings?: {
    savedViews?: {
      id: string;
      name: string;
      description?: string | null;
      filters?: {
        from?: string;
        to?: string;
        traderId?: string | null;
        teamId?: string | null;
        customerId?: string | null;
        productType?: string | null;
      };
      createdAt: string;
      updatedAt: string;
      createdByName?: string | null;
    }[];
    schedules?: {
      id: string;
      name: string;
      description?: string | null;
      reportType: 'SUMMARY' | 'MARGIN_ANALYSIS';
      deliveryMode?: 'HTML' | 'CSV' | 'XLSX' | 'CSV_XLSX';
      bodyMode?: 'HTML_SUMMARY' | 'ATTACHMENT_ONLY';
      hourUtc: number;
      recipientRoles: string[];
      extraEmails?: string[];
      filters?: {
        from?: string;
        to?: string;
        traderId?: string | null;
        teamId?: string | null;
        customerId?: string | null;
        productType?: string | null;
      };
      isActive?: boolean;
      lastSentAt?: string | null;
      createdAt: string;
      updatedAt: string;
    }[];
  };
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
  phone: text('phone'),

  // IP restriction (JSON array of allowed CIDR/IPs, null = unrestricted)
  allowedIps: text('allowed_ips'),

  // Microsoft OAuth — encrypted refresh token for server-side Graph API access
  microsoftRefreshToken: text('microsoft_refresh_token'),
  microsoftRefreshTokenIv: text('microsoft_refresh_token_iv'),
  microsoftRefreshTokenAuthTag: text('microsoft_refresh_token_auth_tag'),

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
//  3b. WHATSAPP AUTH STATE (Baileys multi-device sessions)
// ═══════════════════════════════════════════════════════════════════════

export const whatsappSessions = pgTable('whatsapp_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id).unique(),
  creds: jsonb('creds'),                       // Baileys AuthenticationCreds
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  phoneNumber: text('phone_number'),            // Linked phone number (for display)
  defaultGroupJid: text('default_group_jid'),   // Default WA group for auto-sharing (e.g. trader RFQ group)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const whatsappKeys = pgTable('whatsapp_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  keyType: text('key_type').notNull(),          // e.g. 'pre-key', 'session', 'sender-key', 'app-state-sync-key', etc.
  keyId: text('key_id').notNull(),              // The specific key identifier
  keyData: jsonb('key_data').notNull(),         // The serialized key data
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
  companiesHouseNumber: text('companies_house_number'),
  lastSynced: timestamp('last_synced', { withTimezone: true }),

  // Per-field manual override tracking — fields the user manually edited
  // that should NOT be overwritten by SeaSearcher sync
  manualOverrides: jsonb('manual_overrides').$type<string[]>().default([]),

  // Dismissed SeaSearcher conflicts — maps field name → the SS value that was dismissed
  // so we can show them as minimised rather than prominent on next sync
  dismissedConflicts: jsonb('dismissed_conflicts').$type<Record<string, string | number | null>>().default({}),

  // ── Responsible user ───────────────────────────────────────────────
  responsibleUserId: uuid('responsible_user_id').references(() => users.id),

  // Company logo (for own companies — used in PDF generation)
  logoUrl: text('logo_url'),

  // Brand color (hex, e.g. '#1a56db') — used as email header background
  brandColor: text('brand_color'),

  // VAT number (displayed on invoices)
  vatNumber: text('vat_number'),

  // Company registration number (displayed on document footers)
  companyRegistrationNumber: text('company_registration_number'),

  // Fraud prevention notice (displayed on invoices)
  fraudPreventionText: text('fraud_prevention_text'),

  // Terms templates (used for own companies; rendered into PDFs/orders)
  customerTerms: text('customer_terms'),
  supplierTerms: text('supplier_terms'),

  // Late payment interest rate (e.g. "2%") — shown on invoices
  latePaymentInterest: text('late_payment_interest'),

  // ── Company segmentation ───────────────────────────────────────────
  // Keys match segmentCategories[].key; values are option key(s)
  segments: jsonb('segments').$type<Record<string, string | string[]>>().default({}),

  // ── Parent / Child hierarchy ────────────────────────────────────────
  // Single-level only: a parent cannot be a child, a child cannot be a parent.
  parentId: uuid('parent_id'),

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
  timezone: text('timezone'),                        // IANA timezone ID e.g. "Asia/Dubai"
  timezoneLegacy: text('timezone_legacy'),            // Original LLI format e.g. "GMT +04H"

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

  // ── Default order remark (applies to all orders in this place) ─────
  orderRemark: text('order_remark'),

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
  sanctionStatus: text('sanction_status').default('UNCHECKED'),
  lastSanctionCheck: timestamp('last_sanction_check', { withTimezone: true }),
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

  // Bank account to use on invoices
  bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id, { onDelete: 'set null' }),

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

  // Contact persons
  customerContactId: uuid('customer_contact_id').references(() => companyContacts.id, { onDelete: 'set null' }),
  supplierContactId: uuid('supplier_contact_id').references(() => companyContacts.id, { onDelete: 'set null' }),

  // Broker — optional company that handles all comms on the customer's behalf
  brokerId: uuid('broker_id').references(() => counterparties.id),
  brokerContactId: uuid('broker_contact_id').references(() => companyContacts.id, { onDelete: 'set null' }),
  brokerGetsAll: boolean('broker_gets_all').notNull().default(false),

  // Terms & conditions
  termsAndConditions: text('terms_and_conditions'),

  // Place remark (seeded from place.orderRemark on creation, editable per-order)
  placeRemark: text('place_remark'),

  // Analytics
  lossReason: text('loss_reason'),
  closedAt: timestamp('closed_at', { withTimezone: true }),

  // Delivery
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  10b. PRICE REFERENCES (master list of formula base-price sources)
// ═══════════════════════════════════════════════════════════════════════

export const priceReferences = pgTable('price_references', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  code: text('code').notNull(),
  description: text('description'),
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
  costUnit: text('cost_unit').notNull().default('MT'),
  salesUnit: text('sales_unit').notNull().default('MT'),
  costConversionFactor: numeric('cost_conversion_factor', { precision: 12, scale: 6 }).notNull().default('1'),
  unitConversionFactor: numeric('unit_conversion_factor', { precision: 12, scale: 6 }).notNull().default('1'),

  description: text('description'),

  // ── Fixed pricing ─────────────────────────────────────────────────
  costPrice: numeric('cost_price', { precision: 12, scale: 4 }),
  costCurrency: text('cost_currency').notNull().default('USD'),
  salesPrice: numeric('sales_price', { precision: 12, scale: 4 }),
  salesCurrency: text('sales_currency').notNull().default('USD'),
  profit: numeric('profit', { precision: 12, scale: 4 }),

  // ── Formula pricing (cost side) ───────────────────────────────────
  costPricingModel: pricingModelEnum('cost_pricing_model').notNull().default('FIXED'),
  costReferenceId: uuid('cost_reference_id').references(() => priceReferences.id, { onDelete: 'set null' }),
  costPlattsEntryId: uuid('cost_platts_entry_id').references(() => plattsReportEntries.id, { onDelete: 'set null' }),
  costPremium: numeric('cost_premium', { precision: 12, scale: 4 }),
  costBarging: numeric('cost_barging', { precision: 12, scale: 4 }),
  costBargingUnit: text('cost_barging_unit'),
  costCreditDays: integer('cost_credit_days'),
  costPriceFinalized: boolean('cost_price_finalized').notNull().default(false),

  // ── Formula pricing (sell side) ───────────────────────────────────
  salesPricingModel: pricingModelEnum('sales_pricing_model').notNull().default('FIXED'),
  salesReferenceId: uuid('sales_reference_id').references(() => priceReferences.id, { onDelete: 'set null' }),
  salesPlattsEntryId: uuid('sales_platts_entry_id').references(() => plattsReportEntries.id, { onDelete: 'set null' }),
  salesPremium: numeric('sales_premium', { precision: 12, scale: 4 }),
  salesBarging: numeric('sales_barging', { precision: 12, scale: 4 }),
  salesBargingUnit: text('sales_barging_unit'),
  salesCreditDays: integer('sales_credit_days'),
  salesPriceFinalized: boolean('sales_price_finalized').notNull().default(false),

  deliveredQuantity: numeric('delivered_quantity', { precision: 12, scale: 3 }),

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
  type: text('type').notNull().default('OTHER'),
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
//  12a. DOCUMENT REVISIONS (immutable PDF artifacts + fingerprints)
// ═══════════════════════════════════════════════════════════════════════

export const documentRevisions = pgTable('document_revisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
  invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'cascade' }),
  documentType: documentTypeEnum('document_type').notNull(),
  streamKey: text('stream_key').notNull(),
  revisionNumber: integer('revision_number').notNull(),
  verificationRef: text('verification_ref').notNull(),
  verifyToken: text('verify_token').notNull().unique(),
  sha256Hex: text('sha256_hex').notNull(),
  fingerprintShort: text('fingerprint_short').notNull(),
  filePath: text('file_path').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull().default('application/pdf'),
  fileSize: integer('file_size').notNull(),
  generatedBy: uuid('generated_by').references(() => users.id),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════
//  12b. PLATTS REPORTS
// ═══════════════════════════════════════════════════════════════════════

export const plattsReports = pgTable('platts_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  family: plattsReportFamilyEnum('family').notNull().default('EUROPEAN_MARKETSCAN'),
  publicationDate: date('publication_date').notNull(),
  title: text('title').notNull(),
  sourceFileName: text('source_file_name').notNull(),
  sourceFilePath: text('source_file_path').notNull(),
  sourceMimeType: text('source_mime_type').notNull().default('application/pdf'),
  sourceFileSize: integer('source_file_size').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  status: plattsReportStatusEnum('status').notNull().default('UPLOADED'),
  parserVersion: text('parser_version'),
  parseError: text('parse_error'),
  commentary: jsonb('commentary').$type<string[]>().default([]),
  isCanonical: boolean('is_canonical').notNull().default(false),
  supersededByReportId: uuid('superseded_by_report_id'),
  parsedAt: timestamp('parsed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const plattsReportSections = pgTable('platts_report_sections', {
  id: uuid('id').defaultRandom().primaryKey(),
  reportId: uuid('report_id').notNull().references(() => plattsReports.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
  type: plattsSectionTypeEnum('type').notNull().default('OTHER'),
  heading: text('heading').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const plattsReportEntries = pgTable('platts_report_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  reportId: uuid('report_id').notNull().references(() => plattsReports.id, { onDelete: 'cascade' }),
  sectionId: uuid('section_id').notNull().references(() => plattsReportSections.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
  rawText: text('raw_text').notNull(),
  entryKind: text('entry_kind'),
  marketRegion: text('market_region'),
  marketBasis: text('market_basis'),
  instrument: text('instrument'),
  product: text('product'),
  windowLabel: text('window_label'),
  company: text('company'),
  counterparty: text('counterparty'),
  action: text('action'),
  priceRaw: text('price_raw'),
  priceValue: doublePrecision('price_value'),
  priceUnit: text('price_unit'),
  quantityRaw: text('quantity_raw'),
  quantityValue: doublePrecision('quantity_value'),
  quantityUnit: text('quantity_unit'),
  timestampText: text('timestamp_text'),
  confidence: doublePrecision('confidence'),
  metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const plattsReportImports = pgTable('platts_report_imports', {
  id: uuid('id').defaultRandom().primaryKey(),
  reportId: uuid('report_id').notNull().references(() => plattsReports.id, { onDelete: 'cascade' }),
  importMode: text('import_mode').notNull().default('single'),
  importBatchId: text('import_batch_id'),
  sha256Hex: text('sha256_hex').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
//  16c. CREDIT APPLICATIONS (trader → credit manager approval workflow)
// ═══════════════════════════════════════════════════════════════════════

export const creditApplicationStatusEnum = pgEnum('credit_application_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
]);

export const creditApplicationReviewDecisionEnum = pgEnum('credit_application_review_decision', [
  'APPROVED',
  'REJECTED',
]);

export const creditApplications = pgTable('credit_applications', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  type: creditLineTypeEnum('type').notNull(),                                           // SUPPLIER or CUSTOMER
  counterpartyId: uuid('counterparty_id').notNull().references(() => counterparties.id),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),      // optional: initiated from an order
  creditLineId: uuid('credit_line_id').references(() => creditLines.id, { onDelete: 'set null' }), // optional: increase existing line
  requestedAmount: numeric('requested_amount', { precision: 14, scale: 2 }).notNull(),
  requestedCurrency: text('requested_currency').notNull().default('USD'),
  requestedDays: integer('requested_days'),
  reason: text('reason'),
  status: creditApplicationStatusEnum('status').notNull().default('PENDING'),
  requestedByUserId: uuid('requested_by_user_id').notNull().references(() => users.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const creditApplicationRelations = relations(creditApplications, ({ one, many }) => ({
  tenant: one(tenants, { fields: [creditApplications.tenantId], references: [tenants.id] }),
  counterparty: one(counterparties, { fields: [creditApplications.counterpartyId], references: [counterparties.id] }),
  order: one(orders, { fields: [creditApplications.orderId], references: [orders.id] }),
  creditLine: one(creditLines, { fields: [creditApplications.creditLineId], references: [creditLines.id] }),
  requestedBy: one(users, { fields: [creditApplications.requestedByUserId], references: [users.id] }),
  reviews: many(creditApplicationReviews),
}));

export type CreditApplication = typeof creditApplications.$inferSelect;
export type NewCreditApplication = typeof creditApplications.$inferInsert;

export const creditApplicationReviews = pgTable('credit_application_reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  applicationId: uuid('application_id').notNull().references(() => creditApplications.id, { onDelete: 'cascade' }),
  reviewerUserId: uuid('reviewer_user_id').notNull().references(() => users.id),
  decision: creditApplicationReviewDecisionEnum('decision').notNull(),
  comment: text('comment'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});

export const creditApplicationReviewRelations = relations(creditApplicationReviews, ({ one }) => ({
  application: one(creditApplications, { fields: [creditApplicationReviews.applicationId], references: [creditApplications.id] }),
  reviewer: one(users, { fields: [creditApplicationReviews.reviewerUserId], references: [users.id] }),
}));

export type CreditApplicationReview = typeof creditApplicationReviews.$inferSelect;
export type NewCreditApplicationReview = typeof creditApplicationReviews.$inferInsert;

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

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  requestedBy: uuid('requested_by').references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
//  COMPANY OFFICES (branch offices / addresses per company)
// ═══════════════════════════════════════════════════════════════════════

export const companyOffices = pgTable('company_offices', {
  id: uuid('id').defaultRandom().primaryKey(),
  counterpartyId: uuid('counterparty_id').notNull().references(() => counterparties.id, { onDelete: 'cascade' }),
  city: text('city').notNull(),
  country: text('country'),
  countryCode: text('country_code'),
  address: text('address'),
  phone: text('phone'),
  email: text('email'),
  source: text('source').notNull().default('manual'),   // 'manual' | 'seasearcher'
  seasearcherOfficeId: integer('seasearcher_office_id'),  // for dedup on re-sync
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
  followUpDate: date('follow_up_date'),
  followUpCompleted: boolean('follow_up_completed').notNull().default(false),
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
  plattsReports: many(plattsReports),
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
  uploadedPlattsReports: many(plattsReports),
  plattsImports: many(plattsReportImports),
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
  parent: one(counterparties, { fields: [counterparties.parentId], references: [counterparties.id], relationName: 'parentChild' }),
  children: many(counterparties, { relationName: 'parentChild' }),
  clientOrders: many(orders),
  suppliedItems: many(orderItems),
  teamCompanies: many(teamCompanies),
  userOverrides: many(userCompanyOverrides),
  groupMemberships: many(companyGroupMembers),
  creditLineCompanies: many(creditLineCompanies),
  creditLineCounterparties: many(creditLineCounterparties),
  contacts: many(companyContacts),
  emails: many(companyEmails),
  offices: many(companyOffices),
  vesselAssociations: many(vesselCompanies),
}));

export const companyContactsRelations = relations(companyContacts, ({ one }) => ({
  counterparty: one(counterparties, { fields: [companyContacts.counterpartyId], references: [counterparties.id] }),
}));

export const companyEmailsRelations = relations(companyEmails, ({ one }) => ({
  counterparty: one(counterparties, { fields: [companyEmails.counterpartyId], references: [counterparties.id] }),
  addedBy: one(users, { fields: [companyEmails.addedById], references: [users.id] }),
}));

export const companyOfficesRelations = relations(companyOffices, ({ one }) => ({
  counterparty: one(counterparties, { fields: [companyOffices.counterpartyId], references: [counterparties.id] }),
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
  broker: one(counterparties, { fields: [orders.brokerId], references: [counterparties.id] }),
  customerContact: one(companyContacts, { fields: [orders.customerContactId], references: [companyContacts.id] }),
  supplierContact: one(companyContacts, { fields: [orders.supplierContactId], references: [companyContacts.id] }),
  brokerContact: one(companyContacts, { fields: [orders.brokerContactId], references: [companyContacts.id] }),
  invoicingCompany: one(counterparties, {
    fields: [orders.invoicingCompanyId],
    references: [counterparties.id],
    relationName: 'invoicingOrders',
  }),
  bankAccount: one(bankAccounts, { fields: [orders.bankAccountId], references: [bankAccounts.id] }),
  items: many(orderItems),
  invoices: many(invoices),
  attachments: many(orderAttachments),
  documentRevisions: many(documentRevisions),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  costPlattsEntry: one(plattsReportEntries, {
    fields: [orderItems.costPlattsEntryId],
    references: [plattsReportEntries.id],
    relationName: 'costPlattsSignal',
  }),
  salesPlattsEntry: one(plattsReportEntries, {
    fields: [orderItems.salesPlattsEntryId],
    references: [plattsReportEntries.id],
    relationName: 'salesPlattsSignal',
  }),
}));

export const orderAttachmentsRelations = relations(orderAttachments, ({ one }) => ({
  order: one(orders, { fields: [orderAttachments.orderId], references: [orders.id] }),
  uploader: one(users, { fields: [orderAttachments.uploadedBy], references: [users.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  order: one(orders, { fields: [invoices.orderId], references: [orders.id] }),
  comments: many(invoiceComments),
  documentRevisions: many(documentRevisions),
}));

export const documentRevisionsRelations = relations(documentRevisions, ({ one }) => ({
  tenant: one(tenants, { fields: [documentRevisions.tenantId], references: [tenants.id] }),
  order: one(orders, { fields: [documentRevisions.orderId], references: [orders.id] }),
  invoice: one(invoices, { fields: [documentRevisions.invoiceId], references: [invoices.id] }),
  generatedByUser: one(users, { fields: [documentRevisions.generatedBy], references: [users.id] }),
}));

export const plattsReportsRelations = relations(plattsReports, ({ one, many }) => ({
  tenant: one(tenants, { fields: [plattsReports.tenantId], references: [tenants.id] }),
  uploader: one(users, { fields: [plattsReports.uploadedBy], references: [users.id] }),
  sections: many(plattsReportSections),
  entries: many(plattsReportEntries),
  imports: many(plattsReportImports),
}));

export const plattsReportSectionsRelations = relations(plattsReportSections, ({ one, many }) => ({
  report: one(plattsReports, { fields: [plattsReportSections.reportId], references: [plattsReports.id] }),
  entries: many(plattsReportEntries),
}));

export const plattsReportEntriesRelations = relations(plattsReportEntries, ({ one, many }) => ({
  report: one(plattsReports, { fields: [plattsReportEntries.reportId], references: [plattsReports.id] }),
  section: one(plattsReportSections, { fields: [plattsReportEntries.sectionId], references: [plattsReportSections.id] }),
  costLinkedOrderItems: many(orderItems, { relationName: 'costPlattsSignal' }),
  salesLinkedOrderItems: many(orderItems, { relationName: 'salesPlattsSignal' }),
}));

export const plattsReportImportsRelations = relations(plattsReportImports, ({ one }) => ({
  report: one(plattsReports, { fields: [plattsReportImports.reportId], references: [plattsReports.id] }),
  uploader: one(users, { fields: [plattsReportImports.uploadedBy], references: [users.id] }),
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
  intermediaryBank: text('intermediary_bank'),  // e.g. "SWIFT BSUIFRPP / CACIB"
  isDefault: boolean('is_default').notNull().default(false),
  notes: text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bankAccountsRelations = relations(bankAccounts, ({ one }) => ({
  company: one(counterparties, { fields: [bankAccounts.counterpartyId], references: [counterparties.id] }),
}));

// ═══════════════════════════════════════════════════════════════════════
//  INCOMING RFQs (parsed from WhatsApp DMs or manual paste)
// ═══════════════════════════════════════════════════════════════════════

export const rfqStatusEnum = pgEnum('rfq_status', [
  'PENDING',     // awaiting review
  'ACCEPTED',    // converted to inquiry
  'DISMISSED',   // trader dismissed it
]);

export const incomingRfqs = pgTable('incoming_rfqs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull().references(() => users.id),

  // Source info
  source: text('source').notNull().default('whatsapp'),    // 'whatsapp' | 'manual'
  senderPhone: text('sender_phone'),
  senderName: text('sender_name'),
  rawText: text('raw_text').notNull(),

  // Parsed fields
  vesselName: text('vessel_name'),
  imo: text('imo'),
  port: text('port'),
  products: jsonb('products').$type<Array<{ name: string; quantity: number | null; unit: string }>>().default([]),
  eta: timestamp('eta', { withTimezone: true }),
  confidence: doublePrecision('confidence').notNull().default(0),

  // Workflow
  status: rfqStatusEnum('status').notNull().default('PENDING'),
  orderId: uuid('order_id').references(() => orders.id),     // set when converted to inquiry

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const incomingRfqsRelations = relations(incomingRfqs, ({ one }) => ({
  tenant: one(tenants, { fields: [incomingRfqs.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [incomingRfqs.userId], references: [users.id] }),
  order: one(orders, { fields: [incomingRfqs.orderId], references: [orders.id] }),
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

export type IncomingRfq = typeof incomingRfqs.$inferSelect;
export type NewIncomingRfq = typeof incomingRfqs.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════
//  EMAIL LOG (outbound document emails)
// ═══════════════════════════════════════════════════════════════════════

export const emailLog = pgTable('email_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  documentType: text('document_type').notNull(),        // 'OFFER' | 'NOMINATION' | 'PROFORMA' | 'INVOICE'
  sentByUserId: uuid('sent_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  sentFromEmail: text('sent_from_email').notNull(),
  sentTo: text('sent_to').notNull(),
  ccEmails: text('cc_emails'),                           // comma-separated
  bccEmails: text('bcc_emails'),                         // comma-separated
  subject: text('subject').notNull(),
  pdfFileName: text('pdf_file_name'),
  channel: text('channel').notNull().default('SMTP'),     // 'SMTP' | 'GRAPH'
  status: text('status').notNull().default('SENT'),       // 'SENT' | 'FAILED'
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const emailLogRelations = relations(emailLog, ({ one }) => ({
  tenant: one(tenants, { fields: [emailLog.tenantId], references: [tenants.id] }),
  order: one(orders, { fields: [emailLog.orderId], references: [orders.id] }),
  sentByUser: one(users, { fields: [emailLog.sentByUserId], references: [users.id] }),
}));

export type EmailLog = typeof emailLog.$inferSelect;
export type NewEmailLog = typeof emailLog.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════
//  EMAIL TEMPLATES (global per tenant × document type)
// ═══════════════════════════════════════════════════════════════════════

export const emailTemplates = pgTable('email_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  documentType: text('document_type').notNull(),          // 'OFFER' | 'NOMINATION' | 'PROFORMA' | 'INVOICE'
  subjectTemplate: text('subject_template').notNull().default(''),
  bodyTemplate: text('body_template').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // DB-level UNIQUE(tenant_id, document_type) enforced by migration
});

export const emailTemplatesRelations = relations(emailTemplates, ({ one }) => ({
  tenant: one(tenants, { fields: [emailTemplates.tenantId], references: [tenants.id] }),
}));

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════
//  EMAIL RULES (default CC/BCC per own company × document type)
// ═══════════════════════════════════════════════════════════════════════

export const emailRules = pgTable('email_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  ownCompanyId: uuid('own_company_id').references(() => counterparties.id, { onDelete: 'cascade' }),  // NULL = all own companies
  documentType: text('document_type'),                    // NULL = all document types
  ruleType: text('rule_type').notNull(),                  // 'CC' | 'BCC'
  email: text('email').notNull(),
  label: text('label'),                                    // optional display label
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const emailRulesRelations = relations(emailRules, ({ one }) => ({
  tenant: one(tenants, { fields: [emailRules.tenantId], references: [tenants.id] }),
  ownCompany: one(counterparties, { fields: [emailRules.ownCompanyId], references: [counterparties.id] }),
}));

export type EmailRule = typeof emailRules.$inferSelect;
export type NewEmailRule = typeof emailRules.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════
//  SUPPLIER INQUIRIES (outbound inquiry emails sent to suppliers per order)
// ═══════════════════════════════════════════════════════════════════════

export const supplierInquiries = pgTable('supplier_inquiries', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  supplierId: uuid('supplier_id').notNull().references(() => counterparties.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => companyContacts.id, { onDelete: 'set null' }),
  email: text('email').notNull(),
  subject: text('subject').notNull(),
  status: text('status').notNull().default('SENT'),  // 'SENT' | 'QUOTED' | 'DECLINED' | 'NO_REPLY'
  quoteTokenHash: text('quote_token_hash'),
  quoteTokenExpiresAt: timestamp('quote_token_expires_at', { withTimezone: true }),
  responseDeadlineAt: timestamp('response_deadline_at', { withTimezone: true }),
  reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
  reminderCount: integer('reminder_count').notNull().default(0),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  quotedAt: timestamp('quoted_at', { withTimezone: true }),
  canDeliver: boolean('can_deliver'),
  declineReason: text('decline_reason'),
  quoteValidUntil: timestamp('quote_valid_until', { withTimezone: true }),
  deliveryWindow: text('delivery_window'),
  supplierPaymentTerms: text('supplier_payment_terms'),
  supplierComment: text('supplier_comment'),
  sentByUserId: uuid('sent_by_user_id').references(() => users.id),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const supplierInquiryItemQuotes = pgTable('supplier_inquiry_item_quotes', {
  id: uuid('id').defaultRandom().primaryKey(),
  supplierInquiryId: uuid('supplier_inquiry_id').notNull().references(() => supplierInquiries.id, { onDelete: 'cascade' }),
  orderItemId: uuid('order_item_id').notNull().references(() => orderItems.id, { onDelete: 'cascade' }),
  price: numeric('price', { precision: 12, scale: 4 }),
  currency: text('currency').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const supplierInquiriesRelations = relations(supplierInquiries, ({ one, many }) => ({
  order: one(orders, { fields: [supplierInquiries.orderId], references: [orders.id] }),
  supplier: one(counterparties, { fields: [supplierInquiries.supplierId], references: [counterparties.id] }),
  contact: one(companyContacts, { fields: [supplierInquiries.contactId], references: [companyContacts.id] }),
  sentByUser: one(users, { fields: [supplierInquiries.sentByUserId], references: [users.id] }),
  itemQuotes: many(supplierInquiryItemQuotes),
}));

export const supplierInquiryItemQuotesRelations = relations(supplierInquiryItemQuotes, ({ one }) => ({
  supplierInquiry: one(supplierInquiries, { fields: [supplierInquiryItemQuotes.supplierInquiryId], references: [supplierInquiries.id] }),
  orderItem: one(orderItems, { fields: [supplierInquiryItemQuotes.orderItemId], references: [orderItems.id] }),
}));

export type SupplierInquiry = typeof supplierInquiries.$inferSelect;
export type NewSupplierInquiry = typeof supplierInquiries.$inferInsert;
export type SupplierInquiryItemQuote = typeof supplierInquiryItemQuotes.$inferSelect;
export type NewSupplierInquiryItemQuote = typeof supplierInquiryItemQuotes.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════
//  RISK MONITORING
// ═══════════════════════════════════════════════════════════════════════

export const riskChecks = pgTable('risk_checks', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  counterpartyId: uuid('counterparty_id').notNull().references(() => counterparties.id, { onDelete: 'cascade' }),
  providerClass: riskProviderClassEnum('provider_class').notNull(),
  providerName: text('provider_name').notNull(),             // e.g. 'opensanctions', 'companies_house', 'seasearcher'
  status: riskCheckStatusEnum('status').notNull(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  rawResponse: jsonb('raw_response'),                        // full provider response for audit
  errorMessage: text('error_message'),                       // populated when status = ERROR
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const riskHits = pgTable('risk_hits', {
  id: uuid('id').defaultRandom().primaryKey(),
  riskCheckId: uuid('risk_check_id').notNull().references(() => riskChecks.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  counterpartyId: uuid('counterparty_id').notNull().references(() => counterparties.id, { onDelete: 'cascade' }),
  providerClass: riskProviderClassEnum('provider_class').notNull(),
  severity: riskHitSeverityEnum('severity').notNull(),
  signalType: text('signal_type').notNull(),                 // e.g. 'SANCTION', 'PEP', 'SEIZURE', 'INSOLVENCY', 'DISSOLUTION'
  title: text('title').notNull(),
  detail: text('detail'),
  sourceUrl: text('source_url'),
  matchScore: doublePrecision('match_score'),                // provider-reported confidence 0..1
  isActive: boolean('is_active').notNull().default(true),    // false when resolved/superseded
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const riskOverrides = pgTable('risk_overrides', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  counterpartyId: uuid('counterparty_id').notNull().references(() => counterparties.id, { onDelete: 'cascade' }),
  status: riskOverrideStatusEnum('status').notNull().default('PENDING'),
  reason: text('reason').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  requestedByUserId: uuid('requested_by_user_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const riskOverrideApprovals = pgTable('risk_override_approvals', {
  id: uuid('id').defaultRandom().primaryKey(),
  overrideId: uuid('override_id').notNull().references(() => riskOverrides.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  decision: text('decision').notNull(),                      // 'APPROVED' | 'REJECTED'
  comment: text('comment'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Risk Monitoring Relations ──

export const riskChecksRelations = relations(riskChecks, ({ one, many }) => ({
  counterparty: one(counterparties, { fields: [riskChecks.counterpartyId], references: [counterparties.id] }),
  hits: many(riskHits),
}));

export const riskHitsRelations = relations(riskHits, ({ one }) => ({
  riskCheck: one(riskChecks, { fields: [riskHits.riskCheckId], references: [riskChecks.id] }),
  counterparty: one(counterparties, { fields: [riskHits.counterpartyId], references: [counterparties.id] }),
  resolvedByUser: one(users, { fields: [riskHits.resolvedByUserId], references: [users.id] }),
}));

export const riskOverridesRelations = relations(riskOverrides, ({ one, many }) => ({
  counterparty: one(counterparties, { fields: [riskOverrides.counterpartyId], references: [counterparties.id] }),
  requestedByUser: one(users, { fields: [riskOverrides.requestedByUserId], references: [users.id] }),
  approvals: many(riskOverrideApprovals),
}));

export const riskOverrideApprovalsRelations = relations(riskOverrideApprovals, ({ one }) => ({
  override: one(riskOverrides, { fields: [riskOverrideApprovals.overrideId], references: [riskOverrides.id] }),
  user: one(users, { fields: [riskOverrideApprovals.userId], references: [users.id] }),
}));

export type RiskCheck = typeof riskChecks.$inferSelect;
export type NewRiskCheck = typeof riskChecks.$inferInsert;
export type RiskHit = typeof riskHits.$inferSelect;
export type NewRiskHit = typeof riskHits.$inferInsert;
export type RiskOverride = typeof riskOverrides.$inferSelect;
export type NewRiskOverride = typeof riskOverrides.$inferInsert;
export type RiskOverrideApproval = typeof riskOverrideApprovals.$inferSelect;
export type NewRiskOverrideApproval = typeof riskOverrideApprovals.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════
//  VESSEL SANCTION CHECKS
// ═══════════════════════════════════════════════════════════════════════

export const vesselSanctionChecks = pgTable('vessel_sanction_checks', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  vesselId: uuid('vessel_id').notNull().references(() => vessels.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),                  // 'CLEAR' | 'SANCTIONED' | 'ERROR'
  source: text('source').notNull().default('TANKERTRACKERS'),
  matchedOn: text('matched_on'),                     // 'IMO' | 'NAME' | null
  rawData: jsonb('raw_data'),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const vesselSanctionChecksRelations = relations(vesselSanctionChecks, ({ one }) => ({
  vessel: one(vessels, { fields: [vesselSanctionChecks.vesselId], references: [vessels.id] }),
}));

export type VesselSanctionCheck = typeof vesselSanctionChecks.$inferSelect;
export type NewVesselSanctionCheck = typeof vesselSanctionChecks.$inferInsert;
