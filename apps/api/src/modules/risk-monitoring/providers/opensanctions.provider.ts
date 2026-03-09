// ═══════════════════════════════════════════════════════════════════════
//  OpenSanctions Provider (Watchlist)
//
//  Uses self-hosted yente API for sanctions, PEP, and watchlist screening.
//  Docs: https://www.opensanctions.org/docs/yente/
// ═══════════════════════════════════════════════════════════════════════

import type { RiskProvider, CompanyForCheck, ProviderSettings, ProviderCheckResult, ProviderHit } from './types';

interface YenteMatchResult {
  results: YenteMatch[];
}

interface YenteMatch {
  id: string;
  caption: string;
  schema: string;
  properties: Record<string, string[]>;
  datasets: string[];
  score: number;
  features: Record<string, number>;
  match: boolean;
}

const SIGNAL_TYPE_MAP: Record<string, string> = {
  sanction: 'SANCTION',
  debarment: 'SANCTION',
  crime: 'CRIMINAL',
  poi: 'PEP',
  pep: 'PEP',
  default: 'WATCHLIST',
};

function classifySignalType(datasets: string[]): string {
  for (const ds of datasets) {
    const lower = ds.toLowerCase();
    for (const [key, val] of Object.entries(SIGNAL_TYPE_MAP)) {
      if (lower.includes(key)) return val;
    }
  }
  return 'WATCHLIST';
}

function scoreSeverity(score: number, signalType: string): ProviderHit['severity'] {
  if (signalType === 'SANCTION' && score >= 0.7) return 'CRITICAL';
  if (signalType === 'PEP' && score >= 0.7) return 'HIGH';
  if (score >= 0.8) return 'HIGH';
  if (score >= 0.5) return 'MEDIUM';
  return 'LOW';
}

export const openSanctionsProvider: RiskProvider = {
  providerClass: 'WATCHLIST',
  providerName: 'opensanctions',

  isEnabled(settings: ProviderSettings): boolean {
    return settings.openSanctionsEnabled && !!settings.openSanctionsBaseUrl;
  },

  async check(company: CompanyForCheck, settings: ProviderSettings): Promise<ProviderCheckResult> {
    const baseUrl = settings.openSanctionsBaseUrl.replace(/\/$/, '');

    try {
      const url = new URL(`${baseUrl}/match/default`);
      const body = {
        queries: {
          q: {
            schema: 'Company',
            properties: {
              name: [company.name],
              ...(company.countryIso ? { country: [company.countryIso] } : {}),
            },
          },
        },
      };

      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          providerClass: 'WATCHLIST',
          providerName: 'opensanctions',
          status: 'ERROR',
          errorMessage: `yente returned ${res.status}: ${text.slice(0, 200)}`,
          hits: [],
        };
      }

      const data = (await res.json()) as { responses: Record<string, YenteMatchResult> };
      const matches = data.responses?.q?.results ?? [];

      // Filter to high-confidence matches only (score >= 0.5)
      const relevantMatches = matches.filter((m) => m.score >= 0.5);

      if (relevantMatches.length === 0) {
        return {
          providerClass: 'WATCHLIST',
          providerName: 'opensanctions',
          status: 'CLEAR',
          rawResponse: data,
          hits: [],
        };
      }

      const hits: ProviderHit[] = relevantMatches.map((m) => {
        const signalType = classifySignalType(m.datasets);
        return {
          severity: scoreSeverity(m.score, signalType),
          signalType,
          title: m.caption || m.properties?.name?.[0] || 'Unknown entity',
          detail: `Matched on datasets: ${m.datasets.join(', ')}. Schema: ${m.schema}.`,
          sourceUrl: `https://www.opensanctions.org/entities/${encodeURIComponent(m.id)}/`,
          matchScore: m.score,
        };
      });

      return {
        providerClass: 'WATCHLIST',
        providerName: 'opensanctions',
        status: 'HIT',
        rawResponse: data,
        hits,
      };
    } catch (err: any) {
      return {
        providerClass: 'WATCHLIST',
        providerName: 'opensanctions',
        status: 'ERROR',
        errorMessage: err?.message ?? String(err),
        hits: [],
      };
    }
  },
};
