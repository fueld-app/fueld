import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { VesselDto, RiskHitDto } from '@fueld/types';

interface VesselCreditImpact {
  companyId: string;
  companyName: string;
  hits: RiskHitDto[];
}

@Component({
  selector: 'app-vessel-enforcement-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (variant() === 'seizure') {
      <div class="rounded-xl border border-orange-200 bg-orange-50 px-4 py-4">
        <p class="text-sm font-semibold text-orange-900">Active Seizure / Arrest Impact</p>
        <p class="mt-1 text-sm text-orange-800">
          This vessel is currently referenced by one or more active maritime seizure or arrest hits that can freeze linked company credit.
        </p>
        <div class="mt-3 space-y-2">
          @for (impact of linkedCreditImpacts(); track impact.companyId) {
              @if (seizureHitsForImpact()!(impact).length) {
              <div class="rounded-lg border border-orange-200 bg-white/70 px-3 py-2">
                <a [routerLink]="['/companies', impact.companyId]" class="text-xs font-semibold text-orange-900 hover:underline">
                  {{ impact.companyName }}
                </a>
                <div class="mt-1 space-y-1">
                    @for (hit of seizureHitsForImpact()!(impact); track hit.id) {
                    <p class="text-xs text-orange-800">
                      <span class="font-semibold">{{ hit.title }}</span>
                      @if (hit.detail) {
                        <span class="ml-1">{{ hit.detail }}</span>
                      }
                    </p>
                  }
                </div>
              </div>
            }
          }
        </div>
      </div>
    } @else {
      <div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p class="text-sm font-semibold text-amber-900">Credit Enforcement Exception</p>
            @if (isSanctioned()) {
              <p class="mt-1 text-xs font-semibold uppercase tracking-wide text-red-700">
                This vessel is currently marked sanctioned.
              </p>
            }
            @if (linkedCreditImpacts().length) {
              <p class="mt-1 text-sm text-amber-800">
                This vessel is currently referenced by active company monitoring hits. You can exclude those vessel-related maritime hits from credit enforcement without hiding the vessel.
              </p>
            } @else {
              <p class="mt-1 text-sm text-amber-800">
                Exclude vessel-related maritime risk hits from company credit enforcement without removing the vessel from the system.
              </p>
            }
            <p class="mt-1 text-xs text-amber-700">
              After enabling this, open each linked company and run Monitoring → Re-check Now to clear any existing freeze caused by this vessel.
            </p>

            @if (creditImpactLoading()) {
              <p class="mt-2 text-xs text-amber-700">Checking linked company monitoring hits...</p>
            } @else if (linkedCreditImpacts().length) {
              <div class="mt-3 space-y-2">
                @for (impact of linkedCreditImpacts(); track impact.companyId) {
                  <div class="rounded-lg border border-amber-200 bg-white/70 px-3 py-2">
                    <a [routerLink]="['/companies', impact.companyId]" class="text-xs font-semibold text-amber-900 hover:underline">
                      {{ impact.companyName }}
                    </a>
                    <div class="mt-1 space-y-1">
                      @for (hit of impact.hits; track hit.id) {
                        <p class="text-xs text-amber-800">
                          <span class="font-semibold">{{ hit.signalType }}</span>
                          <span class="ml-1">{{ hit.title }}</span>
                        </p>
                      }
                    </div>
                  </div>
                }
              </div>
            }
          </div>
          <button
            type="button"
            [disabled]="creditEnforcementSaving() || !canManageCreditEnforcement()"
            (click)="toggleCreditEnforcement.emit(!vessel()!.ignoreForCreditEnforcement)"
            class="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            [class]="vessel()!.ignoreForCreditEnforcement ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100' : 'border-amber-300 bg-white text-amber-800 hover:bg-amber-100'"
          >
            @if (creditEnforcementSaving()) {
              <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            }
            {{ vessel()!.ignoreForCreditEnforcement ? 'Ignored For Credit Enforcement' : 'Ignore For Credit Enforcement' }}
          </button>
        </div>
      </div>
    }
  `,
})
export class VesselEnforcementBannerComponent {
  readonly vessel = input.required<VesselDto>();
  readonly isSanctioned = input(false);
  readonly linkedCreditImpacts = input<VesselCreditImpact[]>([]);
  readonly creditImpactLoading = input(false);
  readonly creditEnforcementSaving = input(false);
  readonly canManageCreditEnforcement = input(false);
  readonly variant = input<'credit' | 'seizure'>('credit');
  readonly seizureHitsForImpact = input<(impact: VesselCreditImpact) => RiskHitDto[]>();
  readonly toggleCreditEnforcement = output<boolean>();
}