import type { FuelGrade, OrderStatus, Role } from './enums';

// ─── DTOs ────────────────────────────────────────────────────────────

/** Represents a single bunker order. */
export interface OrderDto {
  id: string;
  vesselName: string;
  port: string;
  fuelGrade: FuelGrade;
  quantityMt: number;
  pricePerMt: number | null;
  status: OrderStatus;
  eta: string; // ISO-8601
  createdAt: string;
  updatedAt: string;
}

/** Payload to create a new order. */
export interface CreateOrderDto {
  vesselName: string;
  port: string;
  fuelGrade: FuelGrade;
  quantityMt: number;
  eta: string;
}

/** Minimal user representation (public-safe, no secrets). */
export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: Role;
  is2faEnabled: boolean;
}

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

// ─── Auth DTOs ───────────────────────────────────────────────────────

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
