import type {
  OrderStatus,
  ProductType,
  PaymentTerms,
  PaymentTermType,
  CounterpartyType,
  InvoiceStatus,
  Role,
  CreditApplicationStatus,
  CreditApplicationReviewDecision,
  RiskProviderClass,
  RiskCheckStatus,
  RiskHitSeverity,
  RiskOverrideStatus,
  PricingModel,
  PlattsReportStatus,
  PlattsReportFamily,
  PlattsSectionType,
} from './enums';

// ═══════════════════════════════════════════════════════════════════════
//  GENERIC WRAPPERS
// ═══════════════════════════════════════════════════════════════════════

/** Standard API response wrapper. */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** Paginated list response. */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BackupManifestDto {
  backupFormatVersion: number;
  createdAt: string;
  appVersion: string;
  deployVersion: string;
  gitSha: string;
  gitBranch: string;
  schemaVersion: string;
  database: {
    engine: 'postgresql';
    dumpFile: string;
    migrationTags: string[];
    latestMigrationTag: string | null;
  };
  contents: {
    uploadsIncluded: boolean;
    promptsIncluded: boolean;
    llmModelsIncluded: boolean;
    managedPaths: string[];
    uploadFileCount?: number;
    uploadBytes?: number;
    promptFileCount?: number;
    promptBytes?: number;
  };
  restorePolicy: {
    mode: 'replace-all';
    deleteTargetOnlyFiles: boolean;
    requiresConfirmationPhrase: boolean;
    confirmationPhrase: string;
  };
  crypto: {
    passwordRequired: boolean;
    algorithm: 'aes-256-gcm';
    kdf: 'scrypt';
  };
}

export interface BackupCapabilitiesDto {
  ready: boolean;
  runtime: {
    mode: 'production' | 'development' | 'test' | 'unknown';
  };
  commands: {
    pgDump: boolean;
    psql: boolean;
    tar: boolean;
  };
  current: {
    appVersion: string;
    deployVersion: string;
    backupFormatVersion: number;
    schemaVersion: string;
    latestMigrationTag: string | null;
  };
  paths: {
    promptsDir: string;
    uploadsRoot: string;
  };
  prerequisites: {
    credentialsEncryptionKeyConfigured: boolean;
    credentialsEncryptionKeyRequired: boolean;
    credentialEncryptionAvailable: boolean;
    databaseUrlConfigured: boolean;
  };
}

export interface BackupValidationDto {
  fileName: string;
  fileSize: number;
  compatible: boolean;
  issues: string[];
  warnings: string[];
  manifest: BackupManifestDto | null;
}

export interface BackupStatusDto {
  restoreInProgress: boolean;
  startedAt: string | null;
  message: string | null;
  confirmationPhrase: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  USER
// ═══════════════════════════════════════════════════════════════════════

/** Minimal user representation (public-safe, no secrets). */
export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string | null;
  teamId: string | null;
  teamName?: string | null;
  is2faEnabled: boolean;
  isActive: boolean;
  isOnLeave: boolean;
  leaveEndDate: string | null;
  delegateId: string | null;
  avatarUrl?: string | null;
  phone?: string | null;
  createdAt?: string;
}

/** Admin-facing user list item. */
export interface AdminUserDto {
  id: string;
  email: string;
  name: string;
  role: Role;
  teamId: string | null;
  teamName: string | null;
  is2faEnabled: boolean;
  hasPasskeys: boolean;
  hasMicrosoftSso: boolean;
  isActive: boolean;
  phone?: string | null;
  allowedIps: string[] | null;
  createdAt: string;
}

/** Invite a new user via email. */
export interface CreateInvitationDto {
  email: string;
  role: Role;
  name: string;
}

/** Invitation record. */
export interface InvitationDto {
  id: string;
  email: string;
  name: string;
  role: Role;
  invitedByName: string;
  inviteLink: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

/** Response when accepting an invitation. */
export interface InviteAcceptResponseDto {
  user: UserDto;
  accessToken: string;
  refreshToken: string;
  requiresMfaSetup?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
//  TENANT
// ═══════════════════════════════════════════════════════════════════════

export interface TenantDto {
  id: string;
  name: string;
  domain: string;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  COUNTERPARTY
// ═══════════════════════════════════════════════════════════════════════

export interface CounterpartyDto {
  id: string;
  tenantId: string;
  name: string;
  type: CounterpartyType;
  types: string[];
  creditLimit: string;
  creditUsed: string;
  country: string | null;
  isOwnCompany: boolean;
  seasearcherId: string | null;
  companyImo: string | null;
  countryIso: string | null;
  yearFormed: number | null;
  companyRoles: string[] | null;
  fleetSize: number | null;
  headOfficeAddress: string | null;
  headOfficePhone: string | null;
  headOfficeEmail: string | null;
  website: string | null;
  isSanctioned: boolean;
  lastSynced: string | null;
  manualOverrides: string[];
  /** Terms templates used when this counterparty is marked as an own company. May include ${companyName} and ${documentName}. */
  customerTerms?: string | null;
  supplierTerms?: string | null;
  responsibleUserId?: string | null;
  responsibleUserName?: string | null;
  vatNumber?: string | null;
  companyRegistrationNumber?: string | null;
  fraudPreventionText?: string | null;
  contactsCount?: number | null;
  /** Company segmentation (key→selected option keys) */
  segments?: Record<string, string | string[]> | null;
  /** Parent/child hierarchy — single-level only */
  parentId?: string | null;
  parentName?: string | null;
}

/** Lightweight child summary returned alongside a parent company detail. */
export interface CompanyChildSummaryDto {
  id: string;
  name: string;
  country: string | null;
  creditLimit: string;
  creditUsed: string;
  fleetSize: number | null;
  isSanctioned: boolean;
}

/** Lightweight parent reference returned alongside a child company detail. */
export interface CompanyParentSummaryDto {
  id: string;
  name: string;
  country: string | null;
}

/** Aggregated figures across the parent and all its children. */
export interface CompanyGroupAggregateDto {
  totalCreditLimit: string;
  totalCreditUsed: string;
  totalFleetSize: number;
  totalOrders: number;
  childCount: number;
}

export interface CreateCounterpartyDto {
  name: string;
  types: string[];
  creditLimit?: string;
  country?: string;
  countryIso?: string;
  companyImo?: string;
  seasearcherId?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  PLACE  (ports, anchorages, sub-ports, terminals, fields)
// ═══════════════════════════════════════════════════════════════════════

export type PlaceType = 'POR' | 'PSP' | 'ANC' | 'TER' | 'FIL';

export interface PlaceDto {
  id: string;
  lliPlaceId: string | null;
  unlocode: string | null;
  name: string;
  country: string;
  countryIso: string | null;
  area: string | null;
  subRegion: string | null;
  placeType: PlaceType | null;
  timezone: string | null;
  lat: number | null;
  long: number | null;
  admiraltyChart: string | null;
  parentPlaceId: string | null;
  parentPlaceName: string | null;
  responsibleUserId: string | null;
  responsibleUserName: string | null;
  lliLastUpdated: string | null;
  /** Default remark applied to all orders in this place (shown on order + included in confirmation PDF). */
  orderRemark?: string | null;
  orderCount?: number;
  activeOrderCount?: number;
}

export interface CreatePlaceDto {
  name: string;
  country: string;
  countryIso?: string;
  area?: string;
  subRegion?: string;
  placeType?: PlaceType;
  timezone?: string;
  lat?: number;
  long?: number;
  unlocode?: string;
  admiraltyChart?: string;
  parentPlaceId?: string;
  parentPlaceName?: string;
}

/** @deprecated Use PlaceDto instead */
export type PortDto = PlaceDto;
/** @deprecated Use CreatePlaceDto instead */
export type CreatePortDto = CreatePlaceDto;

// ═══════════════════════════════════════════════════════════════════════
//  PORT SUPPLIER
// ═══════════════════════════════════════════════════════════════════════

export interface PortSupplierDto {
  id: string;
  placeId: string;
  companyId: string;
  companyName: string;
  contactId: string | null;
  contactName: string | null;
  products: string[];
  note: string | null;
  addedById: string | null;
  addedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePortSupplierDto {
  companyId: string;
  contactId?: string | null;
  products?: string[];
  note?: string;
}

export interface SupplyPortDto {
  id: string;
  placeId: string;
  placeName: string;
  placeCountry: string | null;
  products: string[];
  note: string | null;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  VESSEL COMPANIES (associations between vessels and companies)
// ═══════════════════════════════════════════════════════════════════════

export type VesselCompanyRole =
  | 'REGISTERED_OWNER'
  | 'NOMINAL_OWNER'
  | 'BENEFICIAL_OWNER'
  | 'GROUP_BENEFICIAL_OWNER'
  | 'COMMERCIAL_OPERATOR'
  | 'THIRD_PARTY_OPERATOR'
  | 'DISPONENT_OWNER'
  | 'BAREBOAT_CHARTERER'
  | 'TECHNICAL_MANAGER'
  | 'ISM_MANAGER'
  | 'SHIP_MANAGER'
  | (string & {});

export type VesselCompanySource = 'manual' | 'seasearcher';

export interface VesselCompanyDto {
  id: string;
  vesselId: string;
  vesselName?: string | null;
  vesselImo?: string | null;
  companyId: string;
  companyName: string;
  companyCountryIso?: string | null;
  role: VesselCompanyRole;
  source: VesselCompanySource;
  contactId: string | null;
  contactName: string | null;
  note: string | null;
  addedById: string | null;
  addedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVesselCompanyDto {
  companyId: string;
  role: VesselCompanyRole;
  contactId?: string | null;
  note?: string;
}

export interface UpdateVesselCompanyDto {
  role?: VesselCompanyRole;
  contactId?: string | null;
  note?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  COMPANY EMAILS (flexible email types per company)
// ═══════════════════════════════════════════════════════════════════════

export type CompanyEmailType = 'sales' | 'invoice' | 'inquiry' | 'general' | string;

export interface CompanyEmailDto {
  id: string;
  counterpartyId: string;
  emailType: CompanyEmailType;
  email: string;
  label: string | null;
  isPrimary: boolean;
  addedById: string | null;
  addedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCompanyEmailDto {
  emailType: CompanyEmailType;
  email: string;
  label?: string;
  isPrimary?: boolean;
}

export interface UpdateCompanyEmailDto {
  emailType?: CompanyEmailType;
  email?: string;
  label?: string;
  isPrimary?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
//  EXPECTED ARRIVALS
// ═══════════════════════════════════════════════════════════════════════

export interface ExpectedArrivalDto {
  id: string;
  name: string;
  imo: string | null;
  mmsi: string | null;
  flag: string | null;
  flagCode: string | null;
  vesselType: string | null;
  dwt: number | null;
  grossTonnage: number | null;
  eta: string | null;
  commercialOperator: string | null;
  lastPort: string | null;
  destination: string | null;
}

// ═══════════════════════════════════════════════════════════════════════
//  VESSEL
// ═══════════════════════════════════════════════════════════════════════

export interface VesselDto {
  id: string;
  name: string;
  imo: string | null;
  mmsi: string | null;
  seasearcherId: string | null;
  flag: string | null;
  flagCode: string | null;
  type: string | null;
  status: string | null;
  loa: number | null;
  breadth: number | null;
  depth: number | null;
  draught: number | null;
  deadWeightTonnage: number | null;
  grossTonnage: number | null;
  buildYear: number | null;
  builder: string | null;
  classificationSociety: string | null;
  lastSynced: string | null;
  sanctionStatus: string | null;
  lastSanctionCheck: string | null;
}

export interface CreateVesselDto {
  name: string;
  imo?: string;
  mmsi?: string;
  flag?: string;
  flagCode?: string;
  type?: string;
  status?: string;
  loa?: number;
  breadth?: number;
  depth?: number;
  draught?: number;
  deadWeightTonnage?: number;
  grossTonnage?: number;
  buildYear?: number;
}

// ═══════════════════════════════════════════════════════════════════════
//  ORDER (Trading Aggregate)
// ═══════════════════════════════════════════════════════════════════════

export interface OrderDto {
  id: string;
  orderNumber: string | null;
  tenantId: string;
  clientId: string;
  vesselId: string;
  placeId: string;
  salesRepId: string | null;
  invoicingCompanyId: string | null;
  invoicingCompanyName?: string | null;
  bankAccountId: string | null;
  currency: string;
  status: OrderStatus;
  eta: string | null;
  etd: string | null;
  deliveredAt: string | null;
  customerPaymentTermType?: PaymentTermType | null;
  customerCreditDays?: number | null;
  customerNote?: string | null;
  customerContactId?: string | null;
  supplierId?: string | null;
  supplierPaymentTermType?: PaymentTermType | null;
  supplierCreditDays?: number | null;
  supplierNote?: string | null;
  supplierContactId?: string | null;
  brokerId?: string | null;
  brokerContactId?: string | null;
  brokerGetsAll?: boolean;
  termsAndConditions?: string | null;
  placeRemark?: string | null;
  lossReason: string | null;
  financingRateAnnual?: number;
  financingDayCountConvention?: number;
  financingDays?: number;
  totalFinancingCost?: string;
  financingCostPerMt?: string | null;
  totalNetProfit?: string;
  netMarginPct?: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderDto {
  clientId: string;
  vesselId: string;
  placeId: string;
  salesRepId?: string;
  invoicingCompanyId?: string;
  bankAccountId?: string;
  currency?: string;
  eta?: string;
  etd?: string;
  customerPaymentTermType?: PaymentTermType;
  customerCreditDays?: number;
  customerNote?: string;
  customerContactId?: string;
  supplierId?: string;
  supplierPaymentTermType?: PaymentTermType;
  supplierCreditDays?: number;
  supplierNote?: string;
  supplierContactId?: string;
  termsAndConditions?: string;
}

export interface UpdateOrderDto {
  clientId?: string;
  vesselId?: string;
  placeId?: string;
  salesRepId?: string | null;
  invoicingCompanyId?: string | null;
  bankAccountId?: string | null;
  currency?: string;
  status?: OrderStatus;
  eta?: string | null;
  etd?: string | null;
  deliveredAt?: string | null;
  customerPaymentTermType?: PaymentTermType | null;
  customerCreditDays?: number | null;
  customerNote?: string | null;
  customerContactId?: string | null;
  supplierId?: string | null;
  supplierPaymentTermType?: PaymentTermType | null;
  supplierCreditDays?: number | null;
  supplierNote?: string | null;
  supplierContactId?: string | null;
  brokerId?: string | null;
  brokerContactId?: string | null;
  brokerGetsAll?: boolean;
  termsAndConditions?: string | null;
  placeRemark?: string | null;
  lossReason?: string | null;
}

/** Order with joined relations — returned by GET /orders/:id */
export interface OrderDetailDto extends OrderDto {
  client: CounterpartyDto | null;
  vessel: VesselDto | null;
  place: PlaceDto | null;
  salesRep: { id: string; name: string; email: string } | null;
  invoicingCompany: CounterpartyDto | null;
  customerContact: CompanyContactDto | null;
  supplierContact: CompanyContactDto | null;
  broker: CounterpartyDto | null;
  brokerContact: CompanyContactDto | null;
  items: OrderItemDto[];
  attachments?: OrderAttachmentDto[];
}

/** Lightweight row for the orders/inquiries list */
export interface OrderListRowDto {
  id: string;
  orderNumber: string | null;
  status: OrderStatus;
  clientName: string;
  vesselName: string;
  placeName: string;
  salesRepName: string | null;
  eta: string | null;
  totalValue: number;
  totalProfit: number;
  totalFinancingCost?: number;
  totalNetProfit?: number;
  netMarginPct?: number | null;
  /** Display currency for totals — matches item currencies when uniform, otherwise USD. */
  displayCurrency?: string;
  createdAt: string;
  updatedAt: string;
}

/** Admin settings for order number template */
export interface OrderNumberSettingsDto {
  template: string;
  prefix: string;
  nextSeq: number;
  preview: string;
}

/** Admin settings for configurable vessel-company roles */
export interface VesselCompanyRoleOption {
  key: string;         // e.g. 'REGISTERED_OWNER', 'COMMERCIAL_OPERATOR'
  label: string;       // Human-readable label, e.g. 'Registered Owner'
  group: string;       // Category: 'Legal & Financial', 'Operational & Commercial', 'Technical & Safety'
  description?: string; // Tooltip description of the role
  seasearcherCode?: string; // Seasearcher type code mapping (e.g. 'RO', 'CO')
}

export interface VesselCompanyRoleSettingsDto {
  roles: VesselCompanyRoleOption[];
}

/** Admin settings for configurable product options */
export interface ProductSettingsDto {
  products: string[];
}

/** Admin settings for configurable unit options */
export interface UnitSettingsDto {
  units: string[];
}

/** Admin settings for configurable currency options */
export interface CurrencySettingsDto {
  currencies: string[];
}

export interface FinancingSettingsDto {
  annualRate: number;
  dayCountConvention: number;
}

export interface UpdateFinancingSettingsDto {
  annualRate: number;
}

/** Admin settings for configurable company types */
export interface CompanyTypeSettingsDto {
  companyTypes: string[];
}

/** Admin settings for configurable attachment types */
export interface AttachmentTypeSettingsDto {
  attachmentTypes: string[];
}

/** Admin settings for configurable inquiry cancellation reasons */
export interface InquiryCancelReasonSettingsDto {
  reasons: string[];
}

/** Admin settings for default unit conversion factors */
export interface UnitConversionSettingsDto {
  conversions: { productType?: string; fromUnit: string; toUnit: string; factor: number }[];
}

/** Price reference source (e.g. Aramco OSP, Platts) */
export interface PriceReferenceDto {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PriceReferenceSettingsDto {
  references: PriceReferenceDto[];
}

export interface PlattsReportImportDto {
  id: string;
  reportId: string;
  importMode: string;
  importBatchId: string | null;
  sha256Hex: string;
  notes: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

export interface PlattsReportDto {
  id: string;
  tenantId: string;
  family: PlattsReportFamily;
  publicationDate: string;
  title: string;
  sourceFileName: string;
  sourceMimeType: string;
  sourceFileSize: number;
  uploadedBy: string | null;
  uploadedByName: string | null;
  status: PlattsReportStatus;
  parserVersion: string | null;
  parseError: string | null;
  isCanonical: boolean;
  supersededByReportId: string | null;
  parsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlattsReportEntryDto {
  id: string;
  reportId: string;
  sectionId: string;
  sortOrder: number;
  rawText: string;
  entryKind: string | null;
  marketRegion: string | null;
  marketBasis: string | null;
  instrument: string | null;
  product: string | null;
  windowLabel: string | null;
  company: string | null;
  counterparty: string | null;
  action: string | null;
  priceRaw: string | null;
  priceValue: number | null;
  priceUnit: string | null;
  quantityRaw: string | null;
  quantityValue: number | null;
  quantityUnit: string | null;
  timestampText: string | null;
  confidence: number | null;
  metadata: Record<string, unknown> | null;
}

export interface PlattsReportSectionDto {
  id: string;
  reportId: string;
  sortOrder: number;
  type: PlattsSectionType;
  heading: string;
  entries: PlattsReportEntryDto[];
}

export interface PlattsReportDetailDto extends PlattsReportDto {
  commentary: string[];
  sections: PlattsReportSectionDto[];
  imports: PlattsReportImportDto[];
}

export interface CreatePlattsReportResponseDto {
  report: PlattsReportDto;
  warnings: string[];
}

export interface PlattsSuggestionRequestItemDto {
  key: string;
  productType: ProductType;
  description?: string | null;
}

export interface PlattsSuggestionMatchDto {
  entryId: string;
  reportId: string;
  reportTitle: string;
  reportPublicationDate: string;
  sectionType: PlattsSectionType;
  sectionHeading: string;
  rawText: string;
  company: string | null;
  counterparty: string | null;
  action: string | null;
  instrument: string | null;
  windowLabel: string | null;
  marketRegion: string | null;
  product: string | null;
  priceRaw: string | null;
  priceValue: number | null;
  quantityRaw: string | null;
  quantityValue: number | null;
  timestampText: string | null;
  confidence: number | null;
  score: number;
}

export interface PlattsSuggestionItemDto {
  key: string;
  productType: ProductType;
  description: string | null;
  matches: PlattsSuggestionMatchDto[];
}

export interface PlattsSuggestionsResponseDto {
  family: PlattsReportFamily;
  requestedPublicationDate: string;
  matchedPublicationDate: string | null;
  reportId: string | null;
  reportTitle: string | null;
  usedFallbackReport: boolean;
  items: PlattsSuggestionItemDto[];
}

// ═══════════════════════════════════════════════════════════════════════
//  ORDER ITEM (line items)
// ═══════════════════════════════════════════════════════════════════════

export interface OrderItemDto {
  id: string;
  orderId: string;
  productType: ProductType;
  quantity: string;
  unit: string;
  costUnit: string;
  salesUnit: string;
  costConversionFactor: string;
  unitConversionFactor: string;
  description: string | null;
  costPrice: string | null;
  costCurrency: string;
  salesPrice: string | null;
  salesCurrency: string;
  profit: string | null;
  financingCost?: string | null;
  netProfit?: string | null;
  paymentTerms: PaymentTerms | null;
  customerNote?: string | null;
  deliveredQuantity?: string | null;
  // Formula pricing (cost side)
  costPricingModel: PricingModel;
  costReferenceId?: string | null;
  costPlattsEntryId?: string | null;
  costReferenceName?: string | null;
  costPremium?: string | null;
  costBarging?: string | null;
  costBargingUnit?: string | null;
  costCreditDays?: number | null;
  costPriceFinalized?: boolean;
  // Formula pricing (sell side)
  salesPricingModel: PricingModel;
  salesReferenceId?: string | null;
  salesPlattsEntryId?: string | null;
  salesReferenceName?: string | null;
  salesPremium?: string | null;
  salesBarging?: string | null;
  salesBargingUnit?: string | null;
  salesCreditDays?: number | null;
  salesPriceFinalized?: boolean;
}

export interface SupplierInquiryItemQuoteDto {
  orderItemId: string;
  productType: ProductType;
  quantity: string;
  unit: string;
  description: string | null;
  price: string | null;
  currency: string;
  marketSignal?: string | null;
  note?: string | null;
}

export interface PublicSupplierInquiryDto {
  supplierName: string;
  contactName: string | null;
  vesselName: string;
  vesselImo: string | null;
  portName: string;
  eta: string | null;
  etd: string | null;
  orderNumber: string | null;
  status: string;
  canDeliver: boolean | null;
  declineReason: string | null;
  responseDeadlineAt: string | null;
  quoteSubmittedAt: string | null;
  quoteValidUntil: string | null;
  deliveryWindow: string | null;
  supplierPaymentTerms: string | null;
  supplierComment: string | null;
  currency: string;
  items: SupplierInquiryItemQuoteDto[];
}

export interface SubmitSupplierInquiryQuoteDto {
  canDeliver: boolean;
  declineReason?: string | null;
  quoteValidUntil?: string | null;
  deliveryWindow?: string | null;
  supplierPaymentTerms?: string | null;
  supplierComment?: string | null;
  items: Array<{
    orderItemId: string;
    price?: string | null;
    note?: string | null;
  }>;
}

export interface CreateOrderItemDto {
  productType: ProductType;
  quantity: string;
  unit?: string;
  costUnit?: string;
  description?: string;
  costPrice?: string;
  costCurrency?: string;
  salesPrice?: string;
  salesCurrency?: string;
  paymentTerms?: PaymentTerms;
  customerNote?: string;
  deliveredQuantity?: string;
}

export interface OrderAttachmentDto {
  id: string;
  orderId: string;
  type: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: string | null;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  INVOICE
// ═══════════════════════════════════════════════════════════════════════

export interface InvoiceDto {
  id: string;
  orderId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  dueDate: string;
  pdfPath: string | null;
  amount: string | null;
  amountPaid: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInvoiceDto {
  orderId: string;
  invoiceNumber: string;
  dueDate: string;
  amount?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  CUSTOMER PAYMENTS (ledger entries)
// ═══════════════════════════════════════════════════════════════════════

export interface CustomerPaymentDto {
  id: string;
  tenantId: string;
  customerId: string;
  orderId: string | null;
  invoiceId: string | null;
  amount: string;
  currency: string;
  receivedAt: string;
  method: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface CreateCustomerPaymentDto {
  amount: string;
  currency: string;
  receivedAt?: string;
  method?: string | null;
  note?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════
//  INVOICE COMMENTS (collections)
// ═══════════════════════════════════════════════════════════════════════

export interface InvoiceCommentDto {
  id: string;
  invoiceId: string;
  userId: string;
  comment: string;
  nextActionDate: string | null;
  createdAt: string;
}

export interface CreateInvoiceCommentDto {
  comment: string;
  nextActionDate?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  AUDIT LOG
// ═══════════════════════════════════════════════════════════════════════

export interface AuditLogDto {
  id: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  changesJson: unknown;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  ACTIVITY LOG (comprehensive user activity tracking)
// ═══════════════════════════════════════════════════════════════════════

export interface ActivityLogDto {
  id: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: string; // VIEW, CREATE, UPDATE, DELETE
  entityType: string;
  entityId: string | null;
  entityName: string | null;
  httpMethod: string | null;
  httpPath: string | null;
  pageTitle: string | null;
  clientIp: string | null;
  userAgent: string | null;
  platform: string | null;
  timezone: string | null;
  language: string | null;
  country: string | null;
  city: string | null;
  metadata: unknown;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  USER SESSION (real-time WebSocket session)
// ═══════════════════════════════════════════════════════════════════════

export interface UserSessionDto {
  socketId: string;
  userId: string;
  userEmail: string;
  userName: string;
  clientIp: string | null;
  userAgent: string | null;
  platform: string | null;
  timezone: string | null;
  language: string | null;
  country: string | null;
  city: string | null;
  currentUrl: string | null;
  pageTitle: string | null;
  connectedAt: string;
  lastActivity: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  RETENTION SETTINGS
// ═══════════════════════════════════════════════════════════════════════

export interface RetentionSettingsDto {
  retentionDays: number;
}

// ═══════════════════════════════════════════════════════════════════════
//  VACATION / DELEGATION
// ═══════════════════════════════════════════════════════════════════════

export interface SetLeaveDto {
  isOnLeave: boolean;
  leaveEndDate?: string;
  delegateId?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  AUTH DTOs (kept from Phase 2)
// ═══════════════════════════════════════════════════════════════════════

/** Tokens returned after a successful authentication. */
export interface AuthTokensDto {
  accessToken: string;
  refreshToken: string;
  requiresMfaSetup?: boolean;
}

/** Full login response (when 2FA is NOT required). */
export interface LoginResponseDto {
  requires2fa: false;
  user: UserDto;
  accessToken: string;
  refreshToken: string;
  /** Indicates the user must set up 2FA or passkey before proceeding. */
  requiresMfaSetup?: boolean;
}

/** Partial login response (when 2FA IS required). */
export interface Login2faPendingDto {
  requires2fa: true;
  tempToken: string;
  /** Whether the user has registered passkeys (to show "Use Passkey" on 2FA page). */
  hasPasskeys?: boolean;
}

/** Response after successful registration. */
export interface RegisterResponseDto {
  user: UserDto;
  accessToken: string;
  refreshToken: string;
}

/** 2FA setup response with QR code. */
export interface TwoFactorSetupDto {
  secret: string;
  qrDataUrl: string;
}

/** Passkey credential record (returned from API). */
export interface PasskeyDto {
  id: string;
  credentialId: string;
  friendlyName: string;
  deviceType: string | null;
  backedUp: boolean;
  transports: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Request bodies */
export interface LoginRequestDto {
  email: string;
  password: string;
}

export interface RegisterRequestDto {
  email: string;
  password: string;
  name: string;
}

export interface Verify2faRequestDto {
  tempToken: string;
  code: string;
}

export interface SsoLoginRequestDto {
  microsoftAccessToken: string;
}

export interface RefreshTokenRequestDto {
  refreshToken: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════════

/** An invoice that is past its due date and not fully paid. */
export interface OverdueInvoiceDto {
  invoiceId: string;
  invoiceNumber: string;
  orderId: string;
  clientName: string;
  vesselName: string;
  amount: string | null;
  amountPaid: string | null;
  dueDate: string;
  daysOverdue: number;
  status: string;
  comments: InvoiceCommentDto[];
}

/** Profit / volume stats for a single trader. */
export interface TraderStatsDto {
  traderId: string;
  traderName: string;
  traderEmail: string;
  orderCount: number;
  totalVolume: string;
  totalRevenue: string;
  totalCost: string;
  totalProfit: string;
  totalFinancingCost: string;
  totalNetProfit: string;
}

/** A single stage in the order pipeline summary. */
export interface PipelineStageDto {
  status: string;
  count: number;
  totalValue: string;
}

/** Collections dashboard response. */
export interface CollectionsResponseDto {
  items: OverdueInvoiceDto[];
  count: number;
}

/** Team stats dashboard response. */
export interface TeamStatsResponseDto {
  totalTraders: number;
  activeOrders: number;
  totalRevenueYTD: string;
  totalGrossProfitYTD?: string;
  totalNetProfitYTD?: string;
  avgDealSize: string;
  traderPerformance: { name: string; orders: number; revenue: string; margin: string; }[];
}

/** Pipeline summary response. */
export interface PipelineResponseDto {
  stages: PipelineStageDto[];
}

/** A single loss / cancel reason with its count and percentage. */
export interface LossReasonDto {
  reason: string;
  count: number;
  percentage: number;
}

/** Loss analysis response (cancel reason breakdown). */
export interface LossAnalysisResponseDto {
  reasons: LossReasonDto[];
  totalCancelled: number;
}

/** Conversion metrics for the selected period. */
export interface ConversionMetricsDto {
  /** Total inquiries created in the period. */
  totalInquiries: number;
  /** Inquiries that progressed to at least CONFIRMED. */
  totalWon: number;
  /** Inquiries that were CANCELLED. */
  totalLost: number;
  /** Win rate (totalWon / (totalWon + totalLost)), 0–1. */
  winRate: number;
  /** Average days from INQUIRY creation to closedAt for won orders. */
  avgDaysToClose: number | null;
}

export type ReportVisibilityScope = 'SELF' | 'TEAM' | 'ALL';

/** Effective reporting access for the current user. */
export interface ReportsAccessDto {
  role: Role;
  scope: ReportVisibilityScope;
  canExport: boolean;
  canViewFinance: boolean;
  canViewTeamPerformance: boolean;
  canViewCollections: boolean;
  canManageSharedViews: boolean;
  canManageSchedules: boolean;
}

/** Report filter state shared between the UI, saved views, and schedules. */
export interface ReportFiltersDto {
  from?: string;
  to?: string;
  traderId?: string | null;
  teamId?: string | null;
  customerId?: string | null;
  productType?: string | null;
}

export type ReportComparisonMode =
  | 'NONE'
  | 'PREVIOUS_PERIOD'
  | 'PREVIOUS_MONTH'
  | 'PREVIOUS_QUARTER'
  | 'PREVIOUS_YEAR';

export type ReportVarianceDirection = 'UP' | 'DOWN' | 'FLAT';

export interface ReportComparisonWindowDto {
  mode: ReportComparisonMode;
  label: string;
  currentFrom?: string;
  currentTo?: string;
  previousFrom?: string;
  previousTo?: string;
}

export interface ReportVarianceValueDto {
  currentValue: string;
  previousValue: string;
  deltaValue: string;
  deltaPct: number | null;
  direction: ReportVarianceDirection;
}

export interface ReportVarianceRowDto {
  key: string;
  label: string;
  currentValue: string;
  previousValue: string;
  deltaValue: string;
  deltaPct: number | null;
  direction: ReportVarianceDirection;
}

export interface ReportsVarianceDto {
  comparison: ReportComparisonWindowDto | null;
  summary: {
    totalRevenue: ReportVarianceValueDto;
    totalNetProfit: ReportVarianceValueDto;
    totalOutstanding: ReportVarianceValueDto;
    winRate: ReportVarianceValueDto;
    avgDealSize: ReportVarianceValueDto;
  } | null;
  topTraderMovers: ReportVarianceRowDto[];
  topCustomerMovers: ReportVarianceRowDto[];
  topProductMovers: ReportVarianceRowDto[];
}

export type ReportDrilldownDataset = 'ORDERS' | 'INVOICES';
export type ReportDrilldownTarget = 'TRADER' | 'CUSTOMER' | 'PRODUCT' | 'AGING_BUCKET';

export interface ReportDrilldownOrderRowDto {
  orderId: string;
  traderId: string;
  traderName: string;
  clientId: string;
  clientName: string;
  vesselId: string;
  vesselName: string;
  status: string;
  createdAt: string;
  totalQuantity: string;
  totalRevenue: string;
  totalGrossProfit: string;
  totalFinancingCost: string;
  totalNetProfit: string;
  netMarginPct: number | null;
}

export interface ReportDrilldownInvoiceRowDto {
  invoiceId: string;
  invoiceNumber: string;
  orderId: string;
  clientName: string;
  vesselName: string;
  traderName: string | null;
  dueDate: string;
  status: InvoiceStatus;
  outstandingAmount: string;
  daysOverdue: number;
  agingBucket: string;
}

export interface ReportDrilldownResponseDto {
  title: string;
  dataset: ReportDrilldownDataset;
  target: ReportDrilldownTarget;
  totalCount: number;
  orders: ReportDrilldownOrderRowDto[];
  invoices: ReportDrilldownInvoiceRowDto[];
}

export type ReportExceptionType =
  | 'NEGATIVE_NET_PROFIT_ORDER'
  | 'SEVERELY_OVERDUE_INVOICE'
  | 'LOW_MARGIN_CUSTOMER';

export type ReportExceptionSeverity = 'HIGH' | 'MEDIUM';

export interface ReportExceptionRowDto {
  type: ReportExceptionType;
  severity: ReportExceptionSeverity;
  entityType: 'order' | 'invoice' | 'customer';
  entityId: string;
  title: string;
  description: string;
  primaryValue: string;
  secondaryValue?: string | null;
}

export interface ReportsExceptionsDto {
  totalCount: number;
  byType: Array<{ type: ReportExceptionType; count: number }>;
  rows: ReportExceptionRowDto[];
}

/** Generic select option used by report filter dropdowns. */
export interface ReportFilterOptionDto {
  id: string;
  label: string;
  subtitle?: string | null;
}

/** Available filter options for the current reporting scope. */
export interface ReportFilterOptionsDto {
  traders: ReportFilterOptionDto[];
  teams: ReportFilterOptionDto[];
  customers: ReportFilterOptionDto[];
  products: ReportFilterOptionDto[];
}

/** Trader performance row for the Release 1 reports section. */
export interface TraderPerformanceReportRowDto {
  traderId: string;
  traderName: string;
  traderEmail: string;
  teamName: string | null;
  orderCount: number;
  wonCount: number;
  lostCount: number;
  winRate: number;
  totalVolume: string;
  totalRevenue: string;
  totalGrossProfit: string;
  totalFinancingCost: string;
  totalNetProfit: string;
  avgDealSize: string;
}

/** Trader performance report payload. */
export interface TraderPerformanceReportDto {
  rows: TraderPerformanceReportRowDto[];
  totals: {
    orderCount: number;
    wonCount: number;
    lostCount: number;
    winRate: number;
    totalVolume: string;
    totalRevenue: string;
    totalGrossProfit: string;
    totalFinancingCost: string;
    totalNetProfit: string;
    avgDealSize: string;
  };
}

/** Invoice aging row for the Release 1 reports section. */
export interface InvoiceAgingReportRowDto {
  invoiceId: string;
  invoiceNumber: string;
  orderId: string;
  clientName: string;
  vesselName: string;
  traderName: string | null;
  dueDate: string;
  status: InvoiceStatus;
  amount: string;
  amountPaid: string;
  outstandingAmount: string;
  daysOverdue: number;
  agingBucket: string;
}

/** Summary bucket for invoice aging. */
export interface InvoiceAgingBucketDto {
  label: string;
  count: number;
  outstandingAmount: string;
}

/** Invoice aging report payload. */
export interface InvoiceAgingReportDto {
  rows: InvoiceAgingReportRowDto[];
  buckets: InvoiceAgingBucketDto[];
  totalInvoices: number;
  totalOutstanding: string;
}

/** Commercial summary report payload. */
export interface CommercialSummaryReportDto {
  conversion: ConversionMetricsDto;
  lossAnalysis: LossAnalysisResponseDto;
  pipeline: PipelineStageDto[];
}

/** Margin analysis row grouped by a commercial dimension. */
export interface MarginAnalysisRowDto {
  key: string;
  label: string;
  orderCount: number;
  totalVolume: string;
  totalRevenue: string;
  totalGrossProfit: string;
  totalFinancingCost: string;
  totalNetProfit: string;
  netMarginPct: number | null;
}

/** Monthly trend point for margin analysis. */
export interface MarginTrendPointDto {
  month: string;
  orderCount: number;
  totalRevenue: string;
  totalNetProfit: string;
  netMarginPct: number | null;
}

/** Margin analysis report payload. */
export interface MarginAnalysisReportDto {
  byCustomer: MarginAnalysisRowDto[];
  byProduct: MarginAnalysisRowDto[];
  byVessel: MarginAnalysisRowDto[];
  monthlyTrend: MarginTrendPointDto[];
}

/** Shared saved report preset. */
export interface SavedReportViewDto {
  id: string;
  name: string;
  description: string | null;
  filters: ReportFiltersDto;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
}

export type ReportScheduleType = 'SUMMARY' | 'MARGIN_ANALYSIS';
export type ReportScheduleDeliveryMode = 'HTML' | 'CSV' | 'XLSX' | 'CSV_XLSX';
export type ReportScheduleBodyMode = 'HTML_SUMMARY' | 'ATTACHMENT_ONLY';
export type ReportScheduleMode = 'SUMMARY' | 'EXCEPTIONS';

/** Scheduled report delivery configuration. */
export interface ReportScheduleDto {
  id: string;
  name: string;
  description: string | null;
  reportMode: ReportScheduleMode;
  reportType: ReportScheduleType;
  deliveryMode: ReportScheduleDeliveryMode;
  bodyMode: ReportScheduleBodyMode;
  hourUtc: number;
  recipientRoles: Role[];
  extraEmails: string[];
  exceptionTypes: ReportExceptionType[];
  sendOnlyWhenNonEmpty: boolean;
  filters: ReportFiltersDto;
  isActive: boolean;
  lastSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Release 1 reports landing payload. */
export interface ReleaseOneReportsDto {
  generatedAt: string;
  access: ReportsAccessDto;
  traderPerformance: TraderPerformanceReportDto;
  invoiceAging: InvoiceAgingReportDto;
  commercialSummary: CommercialSummaryReportDto;
}

/** Release 2 reports payload with richer filters and margin analysis. */
export interface ReleaseTwoReportsDto extends ReleaseOneReportsDto {
  filtersApplied: ReportFiltersDto;
  filterOptions: ReportFilterOptionsDto;
  savedViews: SavedReportViewDto[];
  schedules: ReportScheduleDto[];
  marginAnalysis: MarginAnalysisReportDto;
  variance: ReportsVarianceDto;
  exceptions: ReportsExceptionsDto;
}

/** Request to send an invoice email. */
export interface SendInvoiceRequestDto {
  accessToken: string;
  recipientEmail: string;
  vesselName?: string;
  portName?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  CREDIT LINES (supplier & customer credit)
// ═══════════════════════════════════════════════════════════════════════

export type CreditLineType = 'SUPPLIER' | 'CUSTOMER';

export interface CreditLineDto {
  id: string;
  tenantId: string;
  type: CreditLineType;
  // Counterparties (external side: suppliers or customers)
  counterpartyIds: string[];
  counterpartyNames: string[];
  // Our own companies on this credit line
  ownCompanyIds: string[];
  ownCompanyNames: string[];
  creditAmount: string;
  currency: string;
  usedAmount: string;
  availableAmount: string;
  expires: string | null;
  periodDays: number;
  fromDelivery: boolean;
  qualified: boolean;
  performanceDays: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCreditLineDto {
  counterpartyIds: string[];
  type: CreditLineType;
  creditAmount: string;
  currency: string;
  expires?: string;
  periodDays: number;
  fromDelivery?: boolean;
  qualified?: boolean;
  notes?: string;
  ownCompanyIds?: string[];
}

export interface UpdateCreditLineDto {
  creditAmount?: string;
  currency?: string;
  expires?: string | null;
  periodDays?: number;
  fromDelivery?: boolean;
  qualified?: boolean;
  notes?: string | null;
  counterpartyIds?: string[];
  ownCompanyIds?: string[];
}

// ═══════════════════════════════════════════════════════════════════════
//  CREDIT APPLICATIONS (trader → credit manager approval workflow)
// ═══════════════════════════════════════════════════════════════════════

export interface CreditApplicationReviewDto {
  id: string;
  applicationId: string;
  reviewerUserId: string;
  reviewerName: string;
  decision: CreditApplicationReviewDecision;
  comment: string | null;
  decidedAt: string;
}

export interface CreditApplicationDto {
  id: string;
  tenantId: string;
  type: CreditLineType;
  counterpartyId: string;
  counterpartyName: string;
  orderId: string | null;
  orderReference: string | null;
  creditLineId: string | null;
  requestedAmount: string;
  requestedCurrency: string;
  requestedDays: number | null;
  reason: string | null;
  status: CreditApplicationStatus;
  requestedByUserId: string;
  requestedByName: string;
  reviews: CreditApplicationReviewDto[];
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCreditApplicationDto {
  type: CreditLineType;
  counterpartyId: string;
  orderId?: string;
  creditLineId?: string;
  requestedAmount: string;
  requestedCurrency: string;
  requestedDays?: number;
  reason?: string;
}

export interface ReviewCreditApplicationDto {
  decision: CreditApplicationReviewDecision;
  comment?: string;
}

export interface CreditApplicationSettingsDto {
  requiredApprovals: number;
  autoApplyOnApproval: boolean;
  immediateRejection: boolean;
  notifyCreditManagers: boolean;
  notifyPush: boolean;
  notifyEmail: boolean;
  notifyWhatsApp: boolean;
  notifyTraderPush: boolean;
  notifyTraderEmail: boolean;
  notifyTraderWhatsApp: boolean;
}

export interface UpdateCreditApplicationSettingsDto {
  requiredApprovals?: number;
  autoApplyOnApproval?: boolean;
  immediateRejection?: boolean;
  notifyCreditManagers?: boolean;
  notifyPush?: boolean;
  notifyEmail?: boolean;
  notifyWhatsApp?: boolean;
  notifyTraderPush?: boolean;
  notifyTraderEmail?: boolean;
  notifyTraderWhatsApp?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
//  TEAMS
// ═══════════════════════════════════════════════════════════════════════

export interface TeamDto {
  id: string;
  tenantId: string;
  name: string;
  companyIds: string[];
  companyNames: string[];
  memberCount: number;
  memberIds: string[];
  memberNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeamDto {
  name: string;
  companyIds: string[];
}

export interface UpdateTeamDto {
  name?: string;
  companyIds?: string[];
}

// ═══════════════════════════════════════════════════════════════════════
//  COMPANY GROUPS (named reusable groups of companies)
// ═══════════════════════════════════════════════════════════════════════

export interface CompanyGroupDto {
  id: string;
  tenantId: string;
  name: string;
  companyIds: string[];
  companyNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateCompanyGroupDto {
  name: string;
  companyIds: string[];
}

export interface UpdateCompanyGroupDto {
  name?: string;
  companyIds?: string[];
}

// ═══════════════════════════════════════════════════════════════════════
//  OWN COMPANY (simplified view of a counterparty marked as own)
// ═══════════════════════════════════════════════════════════════════════

export interface OwnCompanyDto {
  id: string;
  name: string;
  country: string | null;
  countryIso: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  customerTerms: string | null;
  supplierTerms: string | null;
  vatNumber: string | null;
  companyRegistrationNumber: string | null;
  fraudPreventionText: string | null;
  latePaymentInterest: string | null;
}

// ═══════════════════════════════════════════════════════════════════════
//  BANK ACCOUNTS
// ═══════════════════════════════════════════════════════════════════════

export interface BankAccountDto {
  id: string;
  counterpartyId: string;
  label: string;
  bankName: string;
  accountName: string | null;
  accountNumber: string | null;
  iban: string | null;
  swiftBic: string | null;
  currency: string;
  branchAddress: string | null;
  sortCode: string | null;
  routingNumber: string | null;
  intermediaryBank: string | null;
  isDefault: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBankAccountDto {
  label: string;
  bankName: string;
  accountName?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  swiftBic?: string | null;
  currency: string;
  branchAddress?: string | null;
  sortCode?: string | null;
  routingNumber?: string | null;
  intermediaryBank?: string | null;
  isDefault?: boolean;
  notes?: string | null;
}

export interface UpdateBankAccountDto extends Partial<CreateBankAccountDto> {}

// ═══════════════════════════════════════════════════════════════════════
//  INTEGRATION CREDENTIALS
// ═══════════════════════════════════════════════════════════════════════

export interface IntegrationStatusDto {
  provider: string;
  configured: boolean;
  username: string | null;       // LLI: email, QB: company name
  updatedAt: string | null;
  updatedBy: string | null;      // user email

  // SMTP-specific (optional)
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUser?: string | null;
  smtpFrom?: string | null;
  smtpSecure?: boolean;

  // QuickBooks-specific (optional, only present for QB provider)
  connectionType?: 'online' | 'desktop' | null;
  realmId?: string | null;
  companyName?: string | null;
  tokenExpiresAt?: string | null;

  // Push-specific (optional)
  pushPublicKey?: string | null;
  pushSubject?: string | null;

  // Microsoft 365 / Entra ID (optional)
  msClientId?: string | null;
  msTenantId?: string | null;
}

export interface SetIntegrationCredentialsDto {
  provider: string;
  username: string;
  password: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  QUICKBOOKS
// ═══════════════════════════════════════════════════════════════════════

export interface QuickBooksAuthUrlDto {
  authUrl: string;
}

export interface QuickBooksDesktopConfigDto {
  companyName: string;
  username: string;
  password: string;
}

export interface QuickBooksSyncStatusDto {
  lastSyncAt: string | null;
  syncDirection: 'bidirectional';
  autoSyncEnabled: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
//  SECURITY SETTINGS
// ═══════════════════════════════════════════════════════════════════════

export interface SecuritySettingsDto {
  ssoProvider: 'microsoft' | 'google' | 'none';
  ssoClientId: string;
  ssoTenantId: string;           // Microsoft Entra tenant ID
  ssoEnabled: boolean;
  enforce2FA: boolean;
  passkeyEnabled: boolean;
  passkeyAllowPasswordless: boolean;
  tokenExpirationMinutes: number;
  sessionTimeoutMinutes: number;
  documentVerificationLinkExpiryDays: number; // 0 = never expires
  approvedEmailDomains: string[];             // Restrict Microsoft connect to these domains
  microsoftConnectForceUserEmail: boolean;    // Force Microsoft connect to match Fueld email
}

export interface UpdateSecuritySettingsDto {
  ssoProvider?: 'microsoft' | 'google' | 'none';
  ssoClientId?: string;
  ssoClientSecret?: string;      // write-only, never returned
  ssoTenantId?: string;
  ssoEnabled?: boolean;
  enforce2FA?: boolean;
  passkeyEnabled?: boolean;
  passkeyAllowPasswordless?: boolean;
  tokenExpirationMinutes?: number;
  sessionTimeoutMinutes?: number;
  documentVerificationLinkExpiryDays?: number;
  approvedEmailDomains?: string[];
  microsoftConnectForceUserEmail?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
//  COMPANY CONTACTS
// ═══════════════════════════════════════════════════════════════════════

export interface CompanyContactDto {
  id: string;
  counterpartyId: string;
  name: string;
  role: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
  notes: string | null;
  source: 'manual' | 'seasearcher';
  createdAt: string;
  updatedAt: string;
}

export interface CreateCompanyContactDto {
  name: string;
  role?: string;
  phone?: string;
  fax?: string;
  email?: string;
  notes?: string;
}

export interface UpdateCompanyContactDto {
  name?: string;
  role?: string;
  phone?: string;
  fax?: string;
  email?: string;
  notes?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  RISK MONITORING
// ═══════════════════════════════════════════════════════════════════════

export interface RiskCheckDto {
  id: string;
  counterpartyId: string;
  providerClass: RiskProviderClass;
  providerName: string;
  status: RiskCheckStatus;
  checkedAt: string;
  errorMessage: string | null;
  hitCount: number;
  createdAt: string;
}

export interface RiskHitDto {
  id: string;
  riskCheckId: string;
  counterpartyId: string;
  providerClass: RiskProviderClass;
  severity: RiskHitSeverity;
  signalType: string;
  title: string;
  detail: string | null;
  sourceUrl: string | null;
  matchScore: number | null;
  isActive: boolean;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolvedByUserName: string | null;
  createdAt: string;
}

export interface RiskOverrideDto {
  id: string;
  counterpartyId: string;
  counterpartyName: string;
  status: RiskOverrideStatus;
  reason: string;
  expiresAt: string;
  requestedByUserId: string;
  requestedByUserName: string;
  approvals: RiskOverrideApprovalDto[];
  createdAt: string;
  updatedAt: string;
}

export interface RiskOverrideApprovalDto {
  id: string;
  userId: string;
  userName: string;
  decision: 'APPROVED' | 'REJECTED';
  comment: string | null;
  decidedAt: string;
}

export interface RiskSummaryDto {
  counterpartyId: string;
  counterpartyName: string;
  isFrozen: boolean;
  hasActiveOverride: boolean;
  overrideExpiresAt: string | null;
  activeHitCount: number;
  latestCheckAt: string | null;
  providerStatuses: {
    providerClass: RiskProviderClass;
    providerName: string;
    status: RiskCheckStatus;
    checkedAt: string | null;
    hitCount: number;
  }[];
  activeHits: RiskHitDto[];
}

export interface CreateRiskOverrideDto {
  counterpartyId: string;
  reason: string;
}

export interface RiskOverrideDecisionDto {
  decision: 'APPROVED' | 'REJECTED';
  comment?: string;
}

export interface RiskMonitoringSettingsDto {
  enabled: boolean;
  checkIntervalHours: number;
  openSanctionsEnabled: boolean;
  openSanctionsBaseUrl: string;
  companiesHouseEnabled: boolean;
  companiesHouseApiKey: string;
  seasearcherEnabled: boolean;
  autoEnforceOnHit: boolean;
  overrideExpiryDays: number;
  notifyPush: boolean;
  notifyEmail: boolean;
  notifyWhatsApp: boolean;
}

export interface VesselSanctionSettingsDto {
  enabled: boolean;
  checkIntervalHours: number;
  notifyPush: boolean;
  notifyEmail: boolean;
  notifyWhatsApp: boolean;
}

export interface VesselSanctionCheckDto {
  id: string;
  vesselId: string;
  vesselName: string;
  vesselImo: string | null;
  status: 'CLEAR' | 'SANCTIONED' | 'ERROR';
  source: string;
  matchedOn: string | null;
  checkedAt: string;
}
