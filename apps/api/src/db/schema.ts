import { pgTable, text, boolean, timestamp, uuid, pgEnum } from 'drizzle-orm/pg-core';

// ─── PG Enums ────────────────────────────────────────────────────────

export const roleEnum = pgEnum('role', ['ADMIN', 'TRADER', 'OPERATOR', 'VIEWER']);

export const orderStatusEnum = pgEnum('order_status', [
  'DRAFT',
  'SUBMITTED',
  'CONFIRMED',
  'DELIVERED',
  'CANCELLED',
]);

export const fuelGradeEnum = pgEnum('fuel_grade', [
  'VLSFO',
  'HSFO',
  'LSMGO',
  'MGO',
]);

// ─── Users ───────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
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

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Type Inference Helpers ──────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
