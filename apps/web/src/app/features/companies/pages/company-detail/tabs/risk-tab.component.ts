import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CompanyDetailStore } from '../company-detail.store';
import { RegistrationCardComponent } from '../components/registration-card/registration-card.component';
import { NameHistoryCardComponent } from '../components/name-history-card/name-history-card.component';
import { RiskComplianceCardComponent } from '../components/risk-compliance-card/risk-compliance-card.component';

@Component({
  selector: 'app-risk-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RegistrationCardComponent,
    NameHistoryCardComponent,
    RiskComplianceCardComponent,
  ],
  template: `
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      @if (store.enrichmentLoading()) {
        <div class="rounded-xl border border-gray-200 bg-white shadow-sm p-6 flex items-center justify-center lg:col-span-2">
          <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (store.enrichment()) {
        <app-registration-card
          [enrichment]="store.enrichment()"
          [hierarchy]="store.hierarchy()"
          [seasearcherId]="store.company()!.seasearcherId"
          [navigatingCompanyId]="store.navigatingCompanyId()"
          (navigateToCompany)="store.navigateToCompany($event)"
        />

        @if (store.enrichment()!.companyNameHistory.length) {
          <app-name-history-card [entries]="store.enrichment()!.companyNameHistory" />
        }

        <app-risk-compliance-card
          class="lg:col-span-2"
          [tab]="store.sanctionsTab()"
          [enrichment]="store.enrichment()"
          [seasearcherId]="store.company()!.seasearcherId"
          [riskSummary]="store.riskSummary()"
          [riskSummaryLoading]="store.riskSummaryLoading()"
          [riskCheckRunning]="store.riskCheckRunning()"
          [overrideRequesting]="store.overrideRequesting()"
          [overrideDecisionLoading]="!!store.overrideDecisionLoadingId()"
          [pendingOverride]="store.pendingRiskOverride()"
          [canManageRiskOverrides]="store.canManageRiskOverrides()"
          [hasVotedOnOverride]="store.pendingRiskOverride() ? store.hasVotedOnOverride(store.pendingRiskOverride()!) : false"
          [ignoredCreditVessels]="store.ignoredCreditEnforcementVessels()"
          [navigatingRiskHitId]="store.navigatingRiskHitId()"
          [sanctions]="store.sanctions()"
          [sanctionsLoading]="store.sanctionsLoading()"
          [seizures]="store.seizures()"
          [seizuresLoading]="store.seizuresLoading()"
          (tabChange)="store.onSanctionsTabChange($event)"
          (runCheck)="store.runManualCheck()"
          (requestOverride)="store.requestOverride()"
          (decideOverride)="store.decideOverride($event.override, $event.decision)"
          (openRiskHitVessel)="store.openRiskHitVessel($event)"
        />
      }
    </div>
  `,
})
export class RiskTabComponent {
  readonly store = inject(CompanyDetailStore);
}
