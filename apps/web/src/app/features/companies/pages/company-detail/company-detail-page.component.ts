import { Component, ChangeDetectionStrategy, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { CompanyDetailStore } from './company-detail.store';
import { CompanyHeaderComponent } from './components/company-header/company-header.component';
import { CreditApplicationModalComponent } from '@app/features/credit/components/credit-application-modal.component';

import { CompanyTabsNavComponent } from './company-tabs-nav.component';

@Component({
  selector: 'app-company-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    CompanyTabsNavComponent,
    CompanyHeaderComponent,
    CreditApplicationModalComponent,
  ],
  providers: [CompanyDetailStore],
  styles: [`
    :host { display: block; }
    :host ::ng-deep .leaflet-container { font-family: inherit; }
    .fleet-map-fullscreen {
      position: fixed !important;
      inset: 0 !important;
      z-index: 9999 !important;
      width: 100vw !important;
      height: 100vh !important;
      border-radius: 0 !important;
      border: none !important;
    }
    .fleet-map-fullscreen .fleet-map-container {
      border-radius: 0 !important;
    }
    @media (min-width: 900px) {
      .company-card-grid > div > .rounded-xl,
      .company-card-grid > div > app-comments-card {
        max-height: 449px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
    }
  `],
  template: `
    <div>
      <button
        (click)="store.goBack()"
        class="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-muted hover:text-gray-700 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
        </svg>
        Back to Companies
      </button>

      @if (store.loading()) {
        <div class="flex items-center justify-center py-20">
          <svg class="h-6 w-6 animate-spin text-gray-400 dark:text-muted" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (store.company(); as company) {
        <app-company-header
          [company]="company"
          [companyFlag]="store.companyFlag()"
          [companyTypes]="store.companyTypes()"
          [riskSummary]="store.riskSummary()"
          [syncing]="store.syncing()"
          [canDeleteEntity]="store.canDeleteEntity()"
          [teamUsers]="store.teamUsers()"
          [responsibleUserId]="store.responsibleUserId()"
          [savingResponsible]="store.savingResponsible()"
          [parentCompany]="store.parentCompany()"
          [groupAggregate]="store.groupAggregate()"
          [unlinkingChildId]="store.unlinkingChildId()"
          (responsibleUserChange)="store.onResponsibleUserChange($event)"
          (deleteClick)="store.deleteError.set(''); confirmDeleteOpen.set(true)"
          (monitoringClick)="navigateToTab('risk')"
          (syncClick)="store.syncFromSeasearcher()"
          (seasearcherClick)="store.syncFromSeasearcher()"
          (unlinkParentClick)="store.removeOwnParent()"
        />

        <!-- Delete confirmation modal -->
        @if (confirmDeleteOpen() && store.canDeleteEntity()) {
          <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="confirmDeleteOpen.set(false)">
            <div class="rounded-xl bg-white dark:bg-surface p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">Delete company?</h3>
              <p class="mt-2 text-sm text-gray-500 dark:text-muted">
                Are you sure you want to delete <strong>{{ company.name }}</strong>?
                This cannot be undone.
              </p>
              @if (store.deleteError()) {
                <p class="mt-2 text-sm text-red-600 dark:text-red-400">{{ store.deleteError() }}</p>
              }
              <div class="mt-4 flex justify-end gap-2">
                <button
                  (click)="confirmDeleteOpen.set(false)"
                  class="rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint"
                >Cancel</button>
                <button
                  (click)="store.executeDelete()"
                  [disabled]="store.deleting()"
                  class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  @if (store.deleting()) { Deleting… } @else { Delete }
                </button>
              </div>
            </div>
          </div>
        }

        <!-- Delete Vessel Association Confirmation -->
        @if (store.confirmDeleteVesselAssoc()) {
          <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="store.confirmDeleteVesselAssoc.set(null)">
            <div class="rounded-xl bg-white dark:bg-surface p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">Remove vessel association?</h3>
              <p class="mt-2 text-sm text-gray-500 dark:text-muted">
                Are you sure you want to remove the <strong>{{ store.confirmDeleteVesselAssoc()!.role }}</strong> association for
                <strong>{{ store.confirmDeleteVesselAssoc()!.vesselName ?? 'this vessel' }}</strong>?
              </p>
              <div class="mt-4 flex justify-end gap-2">
                <button (click)="store.confirmDeleteVesselAssoc.set(null)"
                  class="rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint">Cancel</button>
                <button (click)="store.executeDeleteVesselAssoc()"
                  class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Remove</button>
              </div>
            </div>
          </div>
        }

        @if (store.toast()) {
          <div
            class="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg transition-all"
            [class]="store.toast()!.type === 'success'
              ? 'border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/15 text-green-800 dark:text-green-300'
              : 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 text-red-800 dark:text-red-300'"
          >
            @if (store.toast()!.type === 'success') {
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-500 dark:text-green-300" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd" />
              </svg>
            } @else {
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-red-500 dark:text-red-300" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd" />
              </svg>
            }
            {{ store.toast()!.message }}
          </div>
        }

        <!-- Credit Application Modal -->
        <app-credit-application-modal
          [open]="store.showCreditApplicationModal()"
          [counterpartyId]="company.id"
          [counterpartyName]="company.name"
          [defaultType]="company.types.includes('CLIENT') ? 'CUSTOMER' : 'SUPPLIER'"
          (closed)="store.showCreditApplicationModal.set(false)"
          (submitted)="store.onCreditApplicationSubmitted()"
        />
      } @else {
        <div class="text-center py-20 text-gray-400 dark:text-muted">Company not found</div>
      }

      <!-- Tab navigation + router-outlet live OUTSIDE the loading/company @if
           blocks. If the outlet is inside a signal-controlled block, any
           loading/company flicker destroys and recreates it while the router
           is mid-activation, orphaning the child component in the DOM with
           0×0 dimensions (blank tabs bug). The tab components render their
           own loading spinners until store.company() is available.
           The nav is a separate component (no inline <svg> here): an Angular
           compiler quirk marked elements following inline <svg> markup with
           the SVG namespace in production builds, creating the router-outlet's
           child hosts as SVGElement (never lays out → 0×0 blank tabs). -->
      @if (!store.loading()) {
        <app-company-tabs-nav />

        <router-outlet />
      }
    </div>
  `,
})
export class CompanyDetailPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly store = inject(CompanyDetailStore);

  readonly confirmDeleteOpen = signal(false);

  private routeSub: Subscription | null = null;


  private loadedCompanyId: string | null = null;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadedCompanyId = id;
      void this.store.loadCompany(id);
    }

    this.routeSub = this.route.paramMap.subscribe((params) => {
      const newId = params.get('id');
      // Skip the initial emission — ngOnInit already handled it from the
      // snapshot. Calling loadCompany twice for the same id races two HTTP
      // requests whose resetState()/loading flips tear down the @if block
      // (and the router-outlet inside it) mid-activation, leaving the child
      // route component in the DOM with 0×0 dimensions.
      if (newId && newId !== this.loadedCompanyId) {
        this.loadedCompanyId = newId;
        void this.store.loadCompany(newId);
      }
    });
  }

  ngOnDestroy(): void {
    this.store.destroy();
    this.routeSub?.unsubscribe();
  }

  navigateToTab(tab: string): void {
    void this.router.navigate([tab], { relativeTo: this.route });
  }


}
