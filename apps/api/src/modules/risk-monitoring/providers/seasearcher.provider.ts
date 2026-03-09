// ═══════════════════════════════════════════════════════════════════════
//  SeaSearcher Provider (Maritime Context)
//
//  Wraps existing LLI client for sanctions & seizures data.
// ═══════════════════════════════════════════════════════════════════════

import type { RiskProvider, CompanyForCheck, ProviderSettings, ProviderCheckResult, ProviderHit } from './types';
import {
  seasearcherCompanySanctions,
  seasearcherCompanySeizures,
  isLLIConfigured,
} from '../../lloyds/lli.client';

interface SeasearcherSanction {
  sanctionType?: string;
  sanctionListName?: string;
  sanctionListUrl?: string;
  entryText?: string;
  [key: string]: unknown;
}

interface SeasearcherSeizure {
  vesselName?: string;
  detentionPort?: string;
  detentionDate?: string;
  releaseDate?: string;
  deficiencyCount?: number;
  [key: string]: unknown;
}

export const seasearcherProvider: RiskProvider = {
  providerClass: 'MARITIME_CONTEXT',
  providerName: 'seasearcher',

  isEnabled(settings: ProviderSettings): boolean {
    return settings.seasearcherEnabled;
  },

  async check(company: CompanyForCheck, settings: ProviderSettings): Promise<ProviderCheckResult> {
    if (!company.seasearcherId) {
      return {
        providerClass: 'MARITIME_CONTEXT',
        providerName: 'seasearcher',
        status: 'NO_COVERAGE',
        hits: [],
      };
    }

    try {
      const [sanctions, seizuresResult] = await Promise.all([
        seasearcherCompanySanctions<SeasearcherSanction[]>(company.seasearcherId),
        seasearcherCompanySeizures<{ results: SeasearcherSeizure[]; totalMatches: number }>(company.seasearcherId),
      ]);

      const hits: ProviderHit[] = [];

      // Process sanctions
      if (Array.isArray(sanctions)) {
        for (const s of sanctions) {
          hits.push({
            severity: 'CRITICAL',
            signalType: 'SANCTION',
            title: s.sanctionListName || s.sanctionType || 'Sanctions match',
            detail: s.entryText || `Listed on ${s.sanctionListName ?? 'unknown sanctions list'}`,
            sourceUrl: s.sanctionListUrl,
            matchScore: 1.0,
          });
        }
      }

      // Process seizures (recent open seizures are HIGH; released = INFO)
      const seizures = seizuresResult?.results ?? [];
      for (const sz of seizures) {
        const isReleased = !!sz.releaseDate;
        hits.push({
          severity: isReleased ? 'INFO' : 'HIGH',
          signalType: 'SEIZURE',
          title: `Vessel seizure: ${sz.vesselName ?? 'unknown vessel'}`,
          detail: `Port: ${sz.detentionPort ?? 'N/A'}, Date: ${sz.detentionDate ?? 'N/A'}${isReleased ? `, Released: ${sz.releaseDate}` : ' (active)'}`,
          matchScore: 1.0,
        });
      }

      return {
        providerClass: 'MARITIME_CONTEXT',
        providerName: 'seasearcher',
        status: hits.some((h) => h.severity !== 'INFO') ? 'HIT' : (hits.length > 0 ? 'CLEAR' : 'CLEAR'),
        rawResponse: { sanctions, seizures: seizuresResult },
        hits: hits.filter((h) => h.severity !== 'INFO'), // only report active signals as hits
      };
    } catch (err: any) {
      return {
        providerClass: 'MARITIME_CONTEXT',
        providerName: 'seasearcher',
        status: 'ERROR',
        errorMessage: err?.message ?? String(err),
        hits: [],
      };
    }
  },
};
