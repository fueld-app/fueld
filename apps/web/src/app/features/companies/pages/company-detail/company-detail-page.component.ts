import { Component, ChangeDetectionStrategy, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { Subscription } from 'rxjs';
import { CompanyDetailStore } from './company-detail.store';
import { CompanyHeaderComponent } from './components/company-header/company-header.component';
import { CreditApplicationModalComponent } from '@app/features/credit/components/credit-application-modal.component';

@Component({
  selector: 'app-company-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    CompanyHeaderComponent,
    CreditApplicationModalComponent,
  ],
  providers: [CompanyDetailStore],
  styles: [`
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

        <!-- Tab navigation -->
        <div class="mb-6 -mx-4 px-4 md:mx-0 md:px-0">
          <nav
            class="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-line pb-px scrollbar-hide"
            aria-label="Company sections"
          >
            @for (tab of tabs; track tab.key) {
              <a
                [routerLink]="[tab.key]"
                routerLinkActive
                #rla="routerLinkActive"
                role="tab"
                [attr.aria-selected]="rla.isActive"
                [attr.aria-controls]="'tab-panel-' + tab.key"
                [id]="'tab-' + tab.key"
                class="group inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none"
                [class]="rla.isActive
                  ? 'border-blue-600 text-blue-700 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-muted hover:border-gray-300 hover:text-gray-700'"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path [attr.d]="tab.icon" />
                </svg>
                {{ tab.label }}
              </a>
            }
          </nav>
        </div>

        <router-outlet />

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
    </div>
  `,
})
export class CompanyDetailPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly store = inject(CompanyDetailStore);

  readonly confirmDeleteOpen = signal(false);

  private routeSub: Subscription | null = null;

  readonly tabs = [
    { key: 'overview', label: 'Overview', icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z' },
    { key: 'commercial', label: 'Commercial', icon: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941' },
    { key: 'fleet', label: 'Fleet', icon: 'M6.75 2.994a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75zM4.094 6.75A3.094 3.094 0 017.188 3.656H9.75a.75.75 0 010 1.5H7.188a1.594 1.594 0 00-1.594 1.594v.469a.75.75 0 01-1.5 0v-.469zM2.25 10.5a.75.75 0 01.75-.75h6a.75.75 0 010 1.5H3a.75.75 0 01-.75-.75zM2.25 13.5a.75.75 0 01.75-.75h6a.75.75 0 010 1.5H3a.75.75 0 01-.75-.75zM2.25 16.5a.75.75 0 01.75-.75h6a.75.75 0 010 1.5H3a.75.75 0 01-.75-.75zM13.5 6.75a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75zM13.5 9.75a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75zM13.5 12.75a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75zM13.5 15.75a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75z' },
    { key: 'group', label: 'Group', icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.072M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z' },
    { key: 'risk', label: 'Risk', icon: 'M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285zm0 13.036h.008v.008H12v-.008z' },
  ] as const;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      void this.store.loadCompany(id);
    }

    this.routeSub = this.route.paramMap.subscribe((params) => {
      const newId = params.get('id');
      if (newId) {
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
