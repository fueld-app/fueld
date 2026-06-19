// ═══════════════════════════════════════════════════════════════════════
//  Document Utils — formatting/utility helpers for PDF generation
// ═══════════════════════════════════════════════════════════════════════

import { and, eq } from 'drizzle-orm';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { db } from '../../db';
import { bankAccounts } from '../../db/schema';
import { isIanaTimezone } from '../../utils/timezone';
import type { BankDetails } from './document.types';

export function formatIssuedAtUtc(date: Date, dateFormat?: string): string {
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  switch (dateFormat) {
    case 'AMERICAN':  return `${m}/${d}/${y}`;
    case 'EUROPEAN':  return `${d}/${m}/${y}`;
    case 'ISO':
    default:          return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getPublicApiBaseUrl(): string {
  const explicit = process.env['VERIFY_BASE_URL']
    ?? process.env['PUBLIC_API_URL']
    ?? process.env['API_URL'];
  if (explicit?.trim()) return trimTrailingSlash(explicit.trim());

  const appUrl = process.env['APP_URL'];
  if (appUrl?.trim()) {
    try {
      const parsed = new URL(appUrl.trim());
      const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (isLocal) return `${parsed.protocol}//${parsed.hostname}:3000`;
      return `${parsed.origin}/api`;
    } catch { /* fall through */ }
  }
  return 'http://localhost:3000';
}

export function formatNumber(val: string | null | undefined, decimals = 2, precision?: number): string {
  if (!val) return '';
  const num = Number(val);
  const dp = precision != null ? precision : decimals;
  return Number.isFinite(num) ? num.toFixed(dp) : val;
}

export function formatNumberCompact(val: string | null | undefined, maxDecimals = 3): string {
  if (!val) return '';
  const num = Number(val);
  return Number.isFinite(num) ? parseFloat(num.toFixed(maxDecimals)).toString() : val;
}

export function normalizeCountryName(name: string): string {
  if (!name) return '';
  const upper = name.trim().toUpperCase();
  if (upper === 'UK' || upper === 'ENGLAND' || upper === 'GREAT BRITAIN') return 'United Kingdom';
  if (upper === 'USA' || upper === 'U.S.A.' || upper === 'US' || upper === 'U.S.') return 'United States';
  if (upper === 'UAE' || upper === 'U.A.E.') return 'United Arab Emirates';
  return name.trim();
}

export function countryAlreadyInAddress(lines: string[], country: string): boolean {
  const normalized = normalizeCountryName(country).toUpperCase();
  return lines.some((line) => normalizeCountryName(line).toUpperCase() === normalized);
}

export function formatPhoneDisplay(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  return phone.trim();
}

export function phoneToTelUri(phone: string): string {
  return `tel:${phone.replace(/\s+/g, '')}`;
}

export function formatCustomerPaymentTerms(
  termType: string | null | undefined,
  creditDays: number | null | undefined,
): string {
  switch (termType) {
    case 'PREPAY': return 'Prepayment';
    case 'COD': return 'Cash on Delivery';
    case 'CREDIT': return creditDays ? `${creditDays} days from invoice date` : 'Credit terms';
    default: return 'Not specified';
  }
}

export function splitAddressLines(address: string): string[] {
  return address.split(/\n/).map((line) => line.trim()).filter(Boolean);
}

export function formatStoredDateOnlyForDisplay(value: string | Date | null | undefined, tz?: string | null): string | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: isIanaTimezone(tz) ? tz! : 'UTC' });
}

export function parseTimezoneOffset(tz: string | null | undefined): number | null {
  if (!isIanaTimezone(tz)) return null;
  const d = new Date();
  const localeString = d.toLocaleString('en-US', { timeZone: tz ?? undefined });
  const utcString = d.toUTCString();
  const localeDate = new Date(localeString).getTime();
  const utcDate = new Date(utcString).getTime();
  return Math.round((localeDate - utcDate) / 60000);
}

export function computeDueDate(
  issuedAt: Date,
  termType: string | null | undefined,
  creditDays: number | null | undefined,
): Date | null {
  if (termType !== 'CREDIT' || !creditDays) return null;
  const due = new Date(issuedAt);
  due.setUTCDate(due.getUTCDate() + creditDays);
  return due;
}

export function formatDateTimeForDisplay(value: string | null, tz: string | null | undefined, _omitTz = false): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZoneName: _omitTz ? undefined : 'short', timeZone: isIanaTimezone(tz) ? tz! : 'UTC',
  });
}

export function replaceCompanyNamePlaceholder(
  body: string,
  vendorName: string,
  clientName: string,
  vesselName: string,
  placeName: string,
) {
  return body
    .replace(/\{VENDOR\}/g, vendorName)
    .replace(/\{CLIENT\}/g, clientName)
    .replace(/\{VESSEL\}/g, vesselName)
    .replace(/\{PLACE\}/g, placeName);
}

export function tryLoadLogoDataUrl(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  try {
    const logoBasePath = logoUrl.startsWith('/') ? join(process.cwd(), 'public', logoUrl) : logoUrl;
    if (!existsSync(logoBasePath)) return null;
    const ext = extname(logoBasePath).slice(1).toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
    const logoBase64 = readFileSync(logoBasePath).toString('base64');
    return `data:${mime};base64,${logoBase64}`;
  } catch {
    return null;
  }
}

export const DEFAULT_STATIC_BANK_DETAILS: BankDetails = {
  bankName: 'HSBC Bank Plc',
  accountName: 'Fueld Pte Ltd',
  accountNumber: null,
  iban: 'GB80HBUK40156712345678',
  swift: 'HBUKGB4B',
  currency: 'USD',
  branchAddress: 'London, United Kingdom',
  sortCode: null,
  routingNumber: null,
  intermediaryBank: null,
};

export async function loadBankDetails(tenantId: string, invoicingCompanyId: string | null): Promise<BankDetails | null> {
  if (!invoicingCompanyId) return DEFAULT_STATIC_BANK_DETAILS;

  const bankRows = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.counterpartyId, invoicingCompanyId), eq(bankAccounts.isDefault, true)))
    .limit(1);
  const bank = bankRows[0];
  if (!bank) return DEFAULT_STATIC_BANK_DETAILS;

  return {
    bankName: bank.bankName ?? bank.label ?? '',
    accountName: bank.accountName ?? null,
    accountNumber: bank.accountNumber ?? null,
    iban: bank.iban ?? null,
    swift: bank.swift ?? null,
    currency: bank.currency ?? 'USD',
    branchAddress: bank.branchAddress ?? null,
    sortCode: bank.sortCode ?? null,
    routingNumber: bank.routingNumber ?? null,
    intermediaryBank: bank.intermediaryBank ?? null,
  };
}

export function getCompanyRegistrationNumber(company: unknown): string | null {
  if (!company || typeof company !== 'object') return null;
  const c = company as Record<string, unknown>;
  const raw = c.companyRegistrationNumber;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return null;
}

