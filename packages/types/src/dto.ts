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

/** Minimal user representation. */
export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: Role;
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
