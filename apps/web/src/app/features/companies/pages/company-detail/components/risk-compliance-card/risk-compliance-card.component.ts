import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { RiskSummaryDto, RiskHitDto, RiskOverrideDto } from '@fueld/types';

interface CompanyEnrichment {
  isSanctioned: boolean;
  counterpartyRiskReportMetadata: {
    ratingDate: string;
    creditOpinion: string;
    overallPerformance: { text: string; textAbbreviation: string } | null;
    overallRating: { text: string } | null;
    paymentPerformance: { text: string } | null;
  } | null;
}

interface VesselCompanyDto {
  id: string;
  vesselId: string;
  vesselName?: string | null;
  vesselImo?: string | null;
  ignoreForCreditEnforcement?: boolean;
  [key: string]: any;
}

@Component({
  selector: 'app-risk-compliance-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:order-2 flex flex-col overflow-hidden">
      <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-gray-700">Risk & Compliance</h2>
        <div class="flex gap-1">
          <button type="button"
            class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
            [class]="tab() === 'monitoring'
              ? (riskSummary()?.isFrozen ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200' : 'bg-brand-50 text-brand-700')
              : (riskSummary()?.isFrozen ? 'text-red-600 hover:text-red-700' : 'text-gray-400 hover:text-gray-600')"
            (click)="tabChange.emit('monitoring')">
            Monitoring
            @if (riskSummary()?.isFrozen) {
              <span class="ml-1 inline-flex items-center rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">{{ riskSummary()!.activeHitCount || 1 }}</span>
            } @else if ((riskSummary()?.activeHitCount ?? 0) > 0) {
              <span class="ml-1 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{{ riskSummary()!.activeHitCount }}</span>
            }
          </button>
          @if (enrichment()?.counterpartyRiskReportMetadata) {
            <button type="button"
              class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
              [class]="tab() === 'risk' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'"
              (click)="tabChange.emit('risk')">Counterparty Risk</button>
          }
          <button type="button"
            class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
            [class]="tab() === 'sanctions' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'"
            (click)="tabChange.emit('sanctions')">Sanctions</button>
          <button type="button"
            class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
            [class]="tab() === 'seizures' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'"
            (click)="tabChange.emit('seizures')">Seizures / Arrests</button>
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3 text-sm">
        @if (tab() === 'risk') {
          @if (enrichment()?.counterpartyRiskReportMetadata; as meta) {
            <div class="space-y-3">
              <div class="flex justify-between">
                <span class="text-gray-500">Overall Rating</span>
                <span class="font-medium text-gray-900">{{ meta.overallRating?.text ?? '—' }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-500">Overall Performance</span>
                <span class="font-medium text-gray-900">{{ meta.overallPerformance?.text ?? '—' }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-500">Payment Performance</span>
                <span class="font-medium text-gray-900">{{ meta.paymentPerformance?.text ?? '—' }}</span>
              </div>
              @if (meta.creditOpinion) {
                <div>
                  <span class="text-gray-500">Credit Opinion</span>
                  <p class="mt-1 text-gray-700">{{ meta.creditOpinion }}</p>
                </div>
              }
              <div class="text-xs text-gray-400">Rated {{ meta.ratingDate | date:'mediumDate' }}</div>
              <a [href]="'https://www.seasearcher.com/company/' + seasearcherId() + '/counterparty-risk-report'"
                target="_blank" rel="noopener noreferrer"
                class="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-brand-600" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                  <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                </svg>
                View Full Report
              </a>
            </div>
          }
        } @else if (tab() === 'sanctions') {
          @if (sanctionsLoading()) {
            <div class="flex items-center justify-center py-6"><svg class="h-4 w-4 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg></div>
          } @else if (sanctions()?.length) {
            <div class="divide-y divide-gray-50">
              @for (s of sanctions()!; track $index) {
                <div class="px-5 py-3 text-sm">
                  <div class="flex items-center gap-2">
                    <span class="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">{{ s.sanctionSource ?? s.source ?? 'Sanction' }}</span>
                    @if (s.listedDate ?? s.startDate) { <span class="text-xs text-gray-400">{{ (s.listedDate ?? s.startDate) | date:'mediumDate' }}</span> }
                  </div>
                  @if (s.sanctionType ?? s.type ?? s.description) {
                    <p class="mt-1 text-xs text-gray-600">{{ s.sanctionType ?? s.type ?? s.description }}</p>
                  }
                </div>
              }
            </div>
          } @else {
            <div class="px-5 py-5 text-center"><span class="inline-flex items-center rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">No sanctions on record</span></div>
          }
        } @else if (tab() === 'seizures') {
          @if (seizuresLoading()) {
            <div class="flex items-center justify-center py-6"><svg class="h-4 w-4 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg></div>
          } @else if (seizures()?.results?.length) {
            <div class="divide-y divide-gray-50">
              @for (s of seizures()!.results; track $index) {
                <div class="px-5 py-3 text-sm">
                  <div class="flex items-center justify-between">
                    <span class="font-medium text-gray-900">{{ s.vesselName ?? s.name ?? 'Unknown vessel' }}</span>
                    @if (s.imo) { <span class="text-xs text-gray-400 font-mono">{{ s.imo }}</span> }
                  </div>
                  <div class="flex items-center gap-2 mt-1 text-xs text-gray-500">
                    @if (s.port ?? s.location) { <span>{{ s.port ?? s.location }}</span> }
                    @if (s.seizureDate ?? s.date) { <span>&middot; {{ (s.seizureDate ?? s.date) | date:'mediumDate' }}</span> }
                    @if (s.releaseDate) { <span>&middot; Released {{ s.releaseDate | date:'mediumDate' }}</span> }
                  </div>
                </div>
              }
            </div>
          } @else {
            <div class="px-5 py-5 text-center"><span class="inline-flex items-center rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">No seizures on record</span></div>
          }
        } @else if (tab() === 'monitoring') {
          @if (riskSummaryLoading()) {
            <div class="flex items-center justify-center py-6"><svg class="h-4 w-4 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg></div>
          } @else if (riskSummary()) {
            <div class="space-y-4">
              @if (riskSummary()!.isFrozen) {
                <div class="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                  <div class="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-red-600 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
                    </svg>
                    <div>
                      <p class="text-sm font-semibold text-red-800">Credit Frozen</p>
                      <p class="text-xs text-red-600">{{ riskSummary()!.activeHitCount }} active risk signal(s) detected.</p>
                    </div>
                  </div>
                </div>
              }
              @if (riskSummary()!.hasActiveOverride) {
                <div class="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                  <p class="text-sm font-medium text-amber-800">Override Active</p>
                  <p class="text-xs text-amber-600">Credit temporarily unfrozen until {{ riskSummary()!.overrideExpiresAt | date:'medium' }}</p>
                </div>
              }
              @if (ignoredCreditVessels().length) {
                <div class="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3">
                  <p class="text-sm font-medium text-sky-900">Ignored Vessel Credit Exceptions</p>
                  <p class="mt-1 text-xs text-sky-700">Linked vessel(s) excluded from maritime credit enforcement.</p>
                  <div class="mt-2 flex flex-wrap gap-2">
                    @for (v of ignoredCreditVessels(); track v.id) {
                      <span class="inline-flex items-center rounded-full border border-sky-200 bg-white px-2.5 py-1 text-xs font-medium text-sky-800">
                        {{ v.vesselName || v.vesselImo || 'Unknown vessel' }}
                        @if (v.vesselImo) { <span class="ml-1 text-sky-600">IMO {{ v.vesselImo }}</span> }
                      </span>
                    }
                  </div>
                </div>
              }
              @if (pendingOverride()) {
                <div class="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 space-y-3">
                  <div>
                    <p class="text-sm font-medium text-blue-900">Override Pending Approval</p>
                    <p class="text-xs text-blue-700">Requested by {{ pendingOverride()!.requestedByUserName }} on {{ pendingOverride()!.createdAt | date:'medium' }}.</p>
                    <p class="mt-1 text-sm text-blue-900">{{ pendingOverride()!.reason }}</p>
                  </div>
                  @if (pendingOverride()!.approvals.length) {
                    <div class="space-y-1">
                      <p class="text-[11px] font-semibold uppercase tracking-wide text-blue-700">Recorded Decisions</p>
                      @for (approval of pendingOverride()!.approvals; track approval.id) {
                        <div class="flex items-center justify-between gap-3 rounded-md border border-blue-100 bg-white/70 px-3 py-2">
                          <div>
                            <p class="text-xs font-medium text-gray-900">{{ approval.userName }}</p>
                            @if (approval.comment) { <p class="text-xs text-gray-500">{{ approval.comment }}</p> }
                          </div>
                          <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold"
                            [class]="approval.decision === 'APPROVED' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'">{{ approval.decision }}</span>
                        </div>
                      }
                    </div>
                  }
                  @if (canManageRiskOverrides()) {
                    <div class="flex items-center gap-2 pt-1">
                      @if (!hasVotedOnOverride()) {
                        <button type="button"
                          class="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-medium text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50"
                          [disabled]="overrideDecisionLoading()"
                          (click)="decideOverride.emit({ override: pendingOverride()!, decision: 'APPROVED' })">Approve Override</button>
                        <button type="button"
                          class="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                          [disabled]="overrideDecisionLoading()"
                          (click)="decideOverride.emit({ override: pendingOverride()!, decision: 'REJECTED' })">Reject Override</button>
                      } @else {
                        <p class="text-xs text-blue-700">You have already recorded a decision for this override.</p>
                      }
                    </div>
                  }
                </div>
              }
              <div class="space-y-2">
                <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Provider Checks</h4>
                @for (ps of riskSummary()!.providerStatuses; track ps.providerName) {
                  <div class="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                    <div class="flex items-center gap-2">
                      <span class="inline-flex h-2 w-2 rounded-full"
                        [class]="ps.status === 'CLEAR' ? 'bg-green-400' : ps.status === 'HIT' ? 'bg-red-400' : ps.status === 'ERROR' ? 'bg-yellow-400' : 'bg-gray-300'"></span>
                      <span class="text-sm font-medium text-gray-700">{{ ps.providerName }}</span>
                    </div>
                    <div class="flex items-center gap-2">
                      @if (ps.hitCount > 0) { <span class="text-xs font-medium text-red-600">{{ ps.hitCount }} hit(s)</span> }
                      @if (ps.checkedAt) { <span class="text-xs text-gray-400">{{ ps.checkedAt | date:'short' }}</span> }
                    </div>
                  </div>
                }
                @if (!riskSummary()!.providerStatuses.length) { <p class="text-xs text-gray-400">No checks have run yet.</p> }
              </div>
              @if (riskSummary()!.activeHits.length) {
                <div class="space-y-2">
                  <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Signals</h4>
                  @for (hit of riskSummary()!.activeHits; track hit.id) {
                    <div class="rounded-lg border px-3 py-2"
                      [class]="hit.severity === 'CRITICAL' ? 'border-red-200 bg-red-50' : hit.severity === 'HIGH' ? 'border-orange-200 bg-orange-50' : 'border-yellow-200 bg-yellow-50'">
                      <div class="flex items-center gap-2">
                        <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold"
                          [class]="hit.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' : hit.severity === 'HIGH' ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-700'">{{ hit.severity }}</span>
                        <span class="text-xs font-medium text-gray-500">{{ hit.signalType }}</span>
                      </div>
                      @if (canNavigateRiskHitVessel(hit)) {
                        <button type="button"
                          class="mt-1 text-left text-sm font-medium text-brand-700 hover:text-brand-900 hover:underline disabled:opacity-60"
                          [disabled]="navigatingRiskHitId() === hit.id"
                          (click)="openRiskHitVessel.emit(hit)">
                          @if (navigatingRiskHitId() === hit.id) { Opening vessel... } @else { {{ hit.title }} }
                        </button>
                      } @else {
                        <p class="mt-1 text-sm font-medium text-gray-900">{{ hit.title }}</p>
                      }
                      @if (hit.detail) { <p class="mt-0.5 text-xs text-gray-600">{{ hit.detail }}</p> }
                      @if (hit.sourceUrl) { <a [href]="hit.sourceUrl" target="_blank" rel="noopener noreferrer" class="mt-1 inline-flex text-xs text-brand-600 hover:underline">View source</a> }
                    </div>
                  }
                </div>
              }
              <div class="flex items-center gap-2 pt-2 border-t border-gray-100">
                @if (canManageRiskOverrides()) {
                  <button type="button"
                    class="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                    [disabled]="riskCheckRunning()"
                    (click)="runCheck.emit()">
                    @if (riskCheckRunning()) {
                      <svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                      Checking…
                    } @else { Re-check Now }
                  </button>
                }
                @if (riskSummary()!.isFrozen && canManageRiskOverrides()) {
                  <button type="button"
                    class="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
                    [disabled]="overrideRequesting()"
                    (click)="requestOverride.emit()">Request Override</button>
                }
              </div>
            </div>
          } @else {
            <div class="px-5 py-5 text-center">
              <p class="text-sm text-gray-400">Risk monitoring not yet checked for this company.</p>
              <button type="button"
                class="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                [disabled]="riskCheckRunning()"
                (click)="runCheck.emit()">Run First Check</button>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class RiskComplianceCardComponent {
  readonly tab = input<string>('monitoring');
  readonly enrichment = input<CompanyEnrichment | null>(null);
  readonly seasearcherId = input<string | null | undefined>(null);
  readonly riskSummary = input<RiskSummaryDto | null>(null);
  readonly riskSummaryLoading = input<boolean>(false);
  readonly riskCheckRunning = input<boolean>(false);
  readonly overrideRequesting = input<boolean>(false);
  readonly overrideDecisionLoading = input<boolean>(false);
  readonly pendingOverride = input<RiskOverrideDto | null>(null);
  readonly canManageRiskOverrides = input<boolean>(false);
  readonly hasVotedOnOverride = input<boolean>(false);
  readonly ignoredCreditVessels = input<VesselCompanyDto[]>([]);
  readonly navigatingRiskHitId = input<string | null>(null);
  readonly sanctions = input<any[] | null>(null);
  readonly sanctionsLoading = input<boolean>(false);
  readonly seizures = input<any | null>(null);
  readonly seizuresLoading = input<boolean>(false);

  readonly tabChange = output<string>();
  readonly runCheck = output<void>();
  readonly requestOverride = output<void>();
  readonly decideOverride = output<{ override: RiskOverrideDto; decision: 'APPROVED' | 'REJECTED' }>();
  readonly openRiskHitVessel = output<RiskHitDto>();

  canNavigateRiskHitVessel(hit: RiskHitDto): boolean {
    if (hit.signalType !== 'SEIZURE') return false;
    const prefix = 'Vessel seizure:';
    return hit.title.startsWith(prefix) && hit.title.slice(prefix.length).trim().length > 0;
  }
}
