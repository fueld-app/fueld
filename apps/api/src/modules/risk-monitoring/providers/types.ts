// ═══════════════════════════════════════════════════════════════════════
//  Risk Provider Interface
//
//  Each provider adapter implements this contract.
//  The risk-monitoring service calls providers polymorphically.
// ═══════════════════════════════════════════════════════════════════════

export type ProviderClass = 'WATCHLIST' | 'MARITIME_CONTEXT' | 'BUSINESS_DISTRESS';

export interface ProviderCheckResult {
  providerClass: ProviderClass;
  providerName: string;
  status: 'CLEAR' | 'HIT' | 'ERROR' | 'NO_COVERAGE';
  errorMessage?: string;
  rawResponse?: unknown;
  hits: ProviderHit[];
}

export interface ProviderHit {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  signalType: string;       // e.g. 'SANCTION', 'PEP', 'SEIZURE', 'INSOLVENCY', 'DISSOLUTION'
  title: string;
  detail?: string;
  sourceUrl?: string;
  matchScore?: number;       // 0..1
}

export interface RiskProvider {
  readonly providerClass: ProviderClass;
  readonly providerName: string;

  /** Return true if this provider is configured and enabled for a given tenant. */
  isEnabled(settings: ProviderSettings): boolean;

  /** Check a single company. Return NO_COVERAGE if the provider can't check this company. */
  check(company: CompanyForCheck, settings: ProviderSettings): Promise<ProviderCheckResult>;
}

export interface CompanyForCheck {
  id: string;
  tenantId: string;
  name: string;
  country?: string | null;
  countryIso?: string | null;
  seasearcherId?: string | null;
  companiesHouseNumber?: string | null;
}

export interface ProviderSettings {
  openSanctionsEnabled: boolean;
  openSanctionsBaseUrl: string;
  companiesHouseEnabled: boolean;
  companiesHouseApiKey: string;
  seasearcherEnabled: boolean;
}
