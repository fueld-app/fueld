// ═══════════════════════════════════════════════════════════════════════
//  Companies House Provider (Business Distress — UK only)
//
//  Free API: https://developer.company-information.service.gov.uk/
//  Checks insolvency, dissolution, and liquidation status.
//  Returns NO_COVERAGE for non-UK companies (no companiesHouseNumber).
// ═══════════════════════════════════════════════════════════════════════

import type { RiskProvider, CompanyForCheck, ProviderSettings, ProviderCheckResult, ProviderHit } from './types';

const API_BASE = 'https://api.company-information.service.gov.uk';

interface CompanyProfile {
  company_name: string;
  company_status: string;           // 'active', 'dissolved', 'liquidation', 'receivership', etc.
  has_insolvency_history: boolean;
  has_charges: boolean;
  type: string;
}

interface InsolvencyResource {
  cases: InsolvencyCase[];
}

interface InsolvencyCase {
  type: string;
  dates: { type: string; date: string }[];
  notes: string[];
  status: string;
  practitioners: { name: string; role: string }[];
}

export const companiesHouseProvider: RiskProvider = {
  providerClass: 'BUSINESS_DISTRESS',
  providerName: 'companies_house',

  isEnabled(settings: ProviderSettings): boolean {
    return settings.companiesHouseEnabled && !!settings.companiesHouseApiKey;
  },

  async check(company: CompanyForCheck, settings: ProviderSettings): Promise<ProviderCheckResult> {
    if (!company.companiesHouseNumber) {
      return {
        providerClass: 'BUSINESS_DISTRESS',
        providerName: 'companies_house',
        status: 'NO_COVERAGE',
        hits: [],
      };
    }

    const authHeader = 'Basic ' + btoa(settings.companiesHouseApiKey + ':');

    try {
      // Fetch company profile
      const profileRes = await fetch(
        `${API_BASE}/company/${encodeURIComponent(company.companiesHouseNumber)}`,
        {
          headers: { Authorization: authHeader },
          signal: AbortSignal.timeout(15_000),
        },
      );

      if (profileRes.status === 404) {
        return {
          providerClass: 'BUSINESS_DISTRESS',
          providerName: 'companies_house',
          status: 'NO_COVERAGE',
          errorMessage: 'Company not found at Companies House',
          hits: [],
        };
      }

      if (!profileRes.ok) {
        return {
          providerClass: 'BUSINESS_DISTRESS',
          providerName: 'companies_house',
          status: 'ERROR',
          errorMessage: `Companies House returned ${profileRes.status}`,
          hits: [],
        };
      }

      const profile = (await profileRes.json()) as CompanyProfile;
      const hits: ProviderHit[] = [];

      // Check company status
      const dangerStatuses = ['dissolved', 'liquidation', 'receivership', 'administration', 'voluntary-arrangement', 'insolvency-proceedings'];
      if (dangerStatuses.includes(profile.company_status)) {
        hits.push({
          severity: profile.company_status === 'dissolved' ? 'CRITICAL' : 'HIGH',
          signalType: profile.company_status === 'dissolved' ? 'DISSOLUTION' : 'INSOLVENCY',
          title: `Company status: ${profile.company_status}`,
          detail: `${profile.company_name} is currently listed as "${profile.company_status}" at Companies House.`,
          sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(company.companiesHouseNumber)}`,
          matchScore: 1.0,
        });
      }

      // If company has insolvency history, fetch details
      if (profile.has_insolvency_history) {
        try {
          const insolvencyRes = await fetch(
            `${API_BASE}/company/${encodeURIComponent(company.companiesHouseNumber)}/insolvency`,
            {
              headers: { Authorization: authHeader },
              signal: AbortSignal.timeout(15_000),
            },
          );

          if (insolvencyRes.ok) {
            const insolvencyData = (await insolvencyRes.json()) as InsolvencyResource;
            for (const ic of insolvencyData.cases ?? []) {
              // Only flag active cases
              if (ic.status && ic.status.toLowerCase() !== 'closed') {
                hits.push({
                  severity: 'HIGH',
                  signalType: 'INSOLVENCY',
                  title: `Active insolvency: ${ic.type}`,
                  detail: ic.notes?.join('; ') || `Insolvency case type: ${ic.type}`,
                  sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(company.companiesHouseNumber)}/insolvency`,
                  matchScore: 1.0,
                });
              }
            }
          }
        } catch {
          // Insolvency detail fetch failed — profile-level flag is enough
        }
      }

      return {
        providerClass: 'BUSINESS_DISTRESS',
        providerName: 'companies_house',
        status: hits.length > 0 ? 'HIT' : 'CLEAR',
        rawResponse: profile,
        hits,
      };
    } catch (err: any) {
      return {
        providerClass: 'BUSINESS_DISTRESS',
        providerName: 'companies_house',
        status: 'ERROR',
        errorMessage: err?.message ?? String(err),
        hits: [],
      };
    }
  },
};
