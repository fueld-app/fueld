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
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db';
import { vesselCompanies, vessels } from '../../../db/schema';

interface SeasearcherSanction {
  sanctionType?: string;
  sanctionListName?: string;
  sanctionListUrl?: string;
  entryText?: string;
  [key: string]: unknown;
}

interface SeasearcherSeizure {
  vesselName?: string;
  imo?: string | number;
  detentionPort?: string;
  detentionDate?: string;
  releaseDate?: string;
  deficiencyCount?: number;
  [key: string]: unknown;
}

interface IgnoredVesselIdentifier {
  name: string;
  normalizedName: string;
  imo: string | null;
}

function normalizeVesselText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeImo(value: string | number | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

function matchesIgnoredVessel(
  ignoredVessels: IgnoredVesselIdentifier[],
  vesselName?: string | null,
  vesselImo?: string | number | null,
  textBlob?: string | null,
): boolean {
  if (!ignoredVessels.length) return false;

  const normalizedName = normalizeVesselText(vesselName);
  const normalizedImo = normalizeImo(vesselImo);
  const normalizedBlob = normalizeVesselText(textBlob);
  const blobDigits = normalizeImo(textBlob);

  return ignoredVessels.some((ignored) => {
    const nameMatches = !!ignored.normalizedName
      && (
        normalizedName === ignored.normalizedName
        || normalizedBlob.includes(ignored.normalizedName)
      );
    const imoMatches = !!ignored.imo
      && (
        normalizedImo === ignored.imo
        || blobDigits.includes(ignored.imo)
      );
    return nameMatches || imoMatches;
  });
}

async function getIgnoredVesselsForCompany(counterpartyId: string): Promise<IgnoredVesselIdentifier[]> {
  const rows = await db
    .select({ name: vessels.name, imo: vessels.imo })
    .from(vesselCompanies)
    .innerJoin(vessels, eq(vesselCompanies.vesselId, vessels.id))
    .where(
      and(
        eq(vesselCompanies.companyId, counterpartyId),
        eq(vessels.ignoreForCreditEnforcement, true),
      ),
    );

  return rows.map((row) => ({
    name: row.name,
    normalizedName: normalizeVesselText(row.name),
    imo: normalizeImo(row.imo),
  }));
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
      const ignoredVessels = await getIgnoredVesselsForCompany(company.id);

      const hits: ProviderHit[] = [];

      // Process sanctions
      if (Array.isArray(sanctions)) {
        for (const s of sanctions) {
          const sanctionText = [s.entryText, s.sanctionListName, s.sanctionType]
            .filter(Boolean)
            .join(' ');
          if (matchesIgnoredVessel(ignoredVessels, undefined, undefined, sanctionText)) {
            continue;
          }

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
        const seizureText = [sz.vesselName, sz.detentionPort, sz.detentionDate, sz.releaseDate]
          .filter(Boolean)
          .join(' ');
        if (matchesIgnoredVessel(ignoredVessels, sz.vesselName, sz.imo, seizureText)) {
          continue;
        }

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
