// ═══════════════════════════════════════════════════════════════════════
//  Company Types — internal types for company service
// ═══════════════════════════════════════════════════════════════════════

export interface SyncResult {
  synced: boolean;
  vesselCompanies?: any[];
  errors?: string[];
}

export interface SyncConflict {
  field: string;
  localValue: any;
  seasearcherValue: any;
  dismissed: boolean;
}

export const COMPANY_PLACE_SUPPLY_RULE_TYPES = ['POR', 'PSP', 'ANC', 'TER', 'FIL'] as const;
export type CompanyPlaceSupplyRulePlaceType = (typeof COMPANY_PLACE_SUPPLY_RULE_TYPES)[number];
export const COMPANY_PLACE_SUPPLY_RULE_SOURCE = 'company_place_supply_rule';

export function isMissingCompanyRegistrationColumnError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /company_registration_number/i.test(error.message);
}

export function buildSeasearcherContactFingerprint(contact: {
  name?: string | null;
  role?: string | null;
  email?: string | null;
}): string {
  return [contact.name, contact.role, contact.email]
    .map((value) => (value ?? '').trim().toLowerCase())
    .join('|');
}

export function normalizeSeasearcherCompanyTypes(input: string | string[] | null | undefined): string[] {
  if (!input) return [];
  const raw = Array.isArray(input) ? input : [input];
  const typeSet = new Set<string>();
  for (const value of raw) {
    const trimmed = value.trim().toUpperCase();
    if (trimmed === 'CLIENT' || trimmed === 'BUYER' || trimmed === 'BUYERS') {
      typeSet.add('CLIENT');
    } else if (trimmed === 'SUPPLIER' || trimmed === 'SELLER' || trimmed === 'SELLERS') {
      typeSet.add('SUPPLIER');
    } else if (trimmed === 'BROKER') {
      typeSet.add('BROKER');
    }
  }
  return Array.from(typeSet);
}
