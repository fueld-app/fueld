import type {
  OrderStatus,
  ProductType,
  PaymentTerms,
  CounterpartyType,
  InvoiceStatus,
  Role,
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
  is2faEnabled: boolean;
  isOnLeave: boolean;
  leaveEndDate: string | null;
  delegateId: string | null;
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
  creditLimit: string;
  creditUsed: string;
  country: string | null;
}

export interface CreateCounterpartyDto {
  name: string;
  type: CounterpartyType;
  creditLimit?: string;
  country?: string;
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
  placeType: PlaceType | null;
  lat: number | null;
  long: number | null;
  admiraltyChart: string | null;
  principalFacilities: string[] | null;
  portAuthorityName: string | null;
  parentPlaceId: string | null;
  parentPlaceName: string | null;
}

export interface CreatePlaceDto {
  name: string;
  country: string;
  countryIso?: string;
  area?: string;
  placeType?: PlaceType;
  lat?: number;
  long?: number;
  unlocode?: string;
  admiraltyChart?: string;
  principalFacilities?: string[];
  portAuthorityName?: string;
  parentPlaceId?: string;
  parentPlaceName?: string;
}

/** @deprecated Use PlaceDto instead */
export type PortDto = PlaceDto;
/** @deprecated Use CreatePlaceDto instead */
export type CreatePortDto = CreatePlaceDto;

// ═══════════════════════════════════════════════════════════════════════
//  VESSEL
// ═══════════════════════════════════════════════════════════════════════

export interface VesselDto {
  id: string;
  name: string;
  imo: string | null;
  mmsi: string | null;
  flag: string | null;
}

export interface CreateVesselDto {
  name: string;
  imo?: string;
  mmsi?: string;
  flag?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  ORDER (Trading Aggregate)
// ═══════════════════════════════════════════════════════════════════════

export interface OrderDto {
  id: string;
  tenantId: string;
  clientId: string;
  vesselId: string;
  placeId: string;
  salesRepId: string | null;
  status: OrderStatus;
  eta: string | null;
  etd: string | null;
  lossReason: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderDto {
  clientId: string;
  vesselId: string;
  placeId: string;
  salesRepId?: string;
  eta?: string;
  etd?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  ORDER ITEM (line items)
// ═══════════════════════════════════════════════════════════════════════

export interface OrderItemDto {
  id: string;
  orderId: string;
  supplierId: string | null;
  productType: ProductType;
  quantity: string;
  unit: string;
  costPrice: string | null;
  salesPrice: string | null;
  profit: string | null;
  paymentTerms: PaymentTerms | null;
}

export interface CreateOrderItemDto {
  productType: ProductType;
  quantity: string;
  unit?: string;
  supplierId?: string;
  costPrice?: string;
  salesPrice?: string;
  paymentTerms?: PaymentTerms;
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
}

/** Full login response (when 2FA is NOT required). */
export interface LoginResponseDto {
  requires2fa: false;
  user: UserDto;
  accessToken: string;
  refreshToken: string;
}

/** Partial login response (when 2FA IS required). */
export interface Login2faPendingDto {
  requires2fa: true;
  tempToken: string;
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
  avgDealSize: string;
  traderPerformance: { name: string; orders: number; revenue: string; margin: string; }[];
}

/** Pipeline summary response. */
export interface PipelineResponseDto {
  stages: PipelineStageDto[];
}

/** Request to send an invoice email. */
export interface SendInvoiceRequestDto {
  accessToken: string;
  recipientEmail: string;
  vesselName?: string;
  portName?: string;
}
