import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  inject,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@app/core/auth/auth.service';
import type {
  CounterpartyDto,
  CompanyParentSummaryDto,
  CompanyGroupAggregateDto,
  RiskSummaryDto,
} from '@fueld/types';
import { LastEditedBadgeComponent } from '../../../../../../shared/components/last-edited-badge/last-edited-badge.component';

interface UserOption {
  id: string;
  name: string;
  email: string;
}

@Component({
  selector: 'app-company-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DatePipe,
    DecimalPipe,
    FormsModule,
    LastEditedBadgeComponent,
  ],
  styles: [`
    :host { display: block; }
  `],
  template: `
    <div class="mb-6">
      <div class="flex items-center gap-3 mb-1">
        @if (companyFlag()) { <span class="text-2xl">{{ companyFlag() }}</span> }
        <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">{{ company().name }}</h1>
        @for (t of companyTypes(); track t) {
          <span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
            [class]="typeBadgeClass(t)">
            {{ typeLabel(t) }}
          </span>
        }
        @if (company().isSanctioned) {
          <span class="inline-flex items-center rounded-full bg-red-100 dark:bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-400">
            ⚠️ Sanctioned
          </span>
        }
        @if (riskSummary()?.isFrozen) {
          <button
            type="button"
            (click)="monitoringClick.emit()"
            class="inline-flex items-center gap-1.5 rounded-full border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
          >
            <span class="inline-flex h-2 w-2 rounded-full bg-red-500"></span>
            Credit Frozen
          </button>
        } @else if ((riskSummary()?.activeHitCount ?? 0) > 0) {
          <button
            type="button"
            (click)="monitoringClick.emit()"
            class="inline-flex items-center gap-1.5 rounded-full border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors"
          >
            <span class="inline-flex h-2 w-2 rounded-full bg-amber-500"></span>
            {{ riskSummary()!.activeHitCount }} Risk Signal{{ riskSummary()!.activeHitCount === 1 ? '' : 's' }}
          </button>
        }
        @if (syncing()) {
          <span class="inline-flex items-center gap-1.5 rounded-full bg-blue-50 dark:bg-blue-500/15 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400">
            <svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Syncing…
          </span>
        }
        <div class="ml-auto flex items-center gap-2">
          @if (company().seasearcherId) {
            <a
              [href]="'https://www.seasearcher.com/company/' + company().seasearcherId"
              target="_blank"
              rel="noopener noreferrer"
              (click)="seasearcherClick.emit()"
              class="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-line px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
              </svg>
              Seasearcher
            </a>
          }
          @if (canDeleteEntity()) {
            <button
              (click)="deleteClick.emit()"
              class="rounded-lg border border-red-200 dark:border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors"
            >
              Delete
            </button>
          }
        </div>
      </div>
      <div class="flex items-center gap-3">
        @if (company().lastSynced) {
          <span class="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-muted" title="Last synced with Seasearcher">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
            </svg>
            Synced {{ company().lastSynced | date:'short' }}
          </span>
        }
        <span class="text-xs text-gray-500 dark:text-muted">Responsible:</span>
        <select
          [ngModel]="responsibleUserId() ?? ''"
          (ngModelChange)="responsibleUserChange.emit($event)"
          [disabled]="savingResponsible()"
          class="rounded-md border border-gray-200 dark:border-line bg-white dark:bg-surface px-2 py-1 text-xs text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:ring-1 focus:ring-brand-600 disabled:opacity-50"
        >
          <option value="">— None —</option>
          @for (u of teamUsers(); track u.id) {
            <option [value]="u.id">{{ u.name }}</option>
          }
        </select>
        @if (savingResponsible()) {
          <svg class="h-3.5 w-3.5 animate-spin text-gray-400 dark:text-muted" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        }
        <app-last-edited-badge entityType="company" [entityId]="company().id" />
      </div>
      @if (riskSummary()?.isFrozen) {
        <button
          type="button"
          (click)="monitoringClick.emit()"
          class="mt-3 flex w-full items-start gap-3 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-4 py-3 text-left shadow-sm transition-colors hover:bg-red-100/70"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
          </svg>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-semibold text-red-800 dark:text-red-300">Credit frozen by monitoring</span>
              <span class="inline-flex items-center rounded-full bg-red-100 dark:bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">
                {{ riskSummary()!.activeHitCount }} active hit{{ riskSummary()!.activeHitCount === 1 ? '' : 's' }}
              </span>
            </div>
            <p class="mt-1 text-sm text-red-700 dark:text-red-400">Open Monitoring to review provider hits, override state, and re-check options.</p>
          </div>
        </button>
      }
    </div>

    <!-- Parent breadcrumb (shown when this is a child company) -->
    @if (parentCompany(); as parent) {
      <div class="mb-3 flex items-center gap-2 text-sm">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400 dark:text-muted" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M4.083 9h1.946c.089-1.546.383-2.97.837-4.118A6.004 6.004 0 004.083 9zM10 2a8 8 0 100 16 8 8 0 000-16zm0 2c-.076 0-.232.032-.465.262-.238.234-.497.623-.737 1.182-.389.907-.673 2.142-.766 3.556h3.936c-.093-1.414-.377-2.649-.766-3.556-.24-.56-.5-.948-.737-1.182C10.232 4.032 10.076 4 10 4zm3.971 5c-.089-1.546-.383-2.97-.837-4.118A6.004 6.004 0 0115.917 9h-1.946zm-2.003 2H8.032c.093 1.414.377 2.649.766 3.556.24.56.5.948.737 1.182.233.23.389.262.465.262.076 0 .232-.032.465-.262.238-.234.497-.623.737-1.182.389-.907.673-2.142.766-3.556zm1.166 4.118c.454-1.147.748-2.572.837-4.118h1.946a6.004 6.004 0 01-2.783 4.118zm-6.268 0C6.412 13.97 6.118 12.546 6.029 11H4.083a6.004 6.004 0 002.783 4.118z" clip-rule="evenodd" />
        </svg>
        <span class="text-gray-400 dark:text-muted">Child of</span>
        <a [routerLink]="['/companies', parent.id]"
           class="font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 hover:underline transition-colors">
          {{ parent.name }}
        </a>
        @if (parent.country) {
          <span class="text-xs text-gray-400 dark:text-muted">{{ parent.country }}</span>
        }
        <button
          (click)="unlinkParentClick.emit()"
          [disabled]="unlinkingChildId() === company().id"
          class="ml-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors disabled:opacity-50"
        >
          @if (unlinkingChildId() === company().id) { Unlinking… } @else { Unlink }
        </button>
      </div>
    }

    <!-- Aggregated stats bar (shown when this is a parent with children) -->
    @if (groupAggregate(); as agg) {
      <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        @if (auth.canSeePrices()) {
        <div class="rounded-lg border border-gray-200 dark:border-line bg-white dark:bg-surface px-4 py-3 shadow-sm">
          <div class="text-xs font-medium text-gray-500 dark:text-muted mb-0.5">Group Credit Limit</div>
          <div class="text-lg font-bold text-gray-900 dark:text-ink">{{ agg.totalCreditLimit | number:'1.0-0' }}</div>
        </div>
        <div class="rounded-lg border border-gray-200 dark:border-line bg-white dark:bg-surface px-4 py-3 shadow-sm">
          <div class="text-xs font-medium text-gray-500 dark:text-muted mb-0.5">Group Credit Used</div>
          <div class="text-lg font-bold text-gray-900 dark:text-ink">{{ agg.totalCreditUsed | number:'1.0-0' }}</div>
        </div>
        }
        <div class="rounded-lg border border-gray-200 dark:border-line bg-white dark:bg-surface px-4 py-3 shadow-sm">
          <div class="text-xs font-medium text-gray-500 dark:text-muted mb-0.5">Group Fleet</div>
          <div class="text-lg font-bold text-gray-900 dark:text-ink">{{ agg.totalFleetSize }} vessels</div>
        </div>
        <div class="rounded-lg border border-gray-200 dark:border-line bg-white dark:bg-surface px-4 py-3 shadow-sm">
          <div class="text-xs font-medium text-gray-500 dark:text-muted mb-0.5">Group Orders</div>
          <div class="text-lg font-bold text-gray-900 dark:text-ink">{{ agg.totalOrders }}</div>
        </div>
      </div>
    }
  `,
})
export class CompanyHeaderComponent {
  protected readonly auth = inject(AuthService);
  readonly company = input.required<CounterpartyDto>();
  readonly companyFlag = input.required<string>();
  readonly companyTypes = input.required<string[]>();
  readonly riskSummary = input<RiskSummaryDto | null>(null);
  readonly syncing = input<boolean>(false);
  readonly canDeleteEntity = input<boolean>(false);
  readonly teamUsers = input<UserOption[]>([]);
  readonly responsibleUserId = input<string | null>(null);
  readonly savingResponsible = input<boolean>(false);
  readonly parentCompany = input<CompanyParentSummaryDto | null>(null);
  readonly groupAggregate = input<CompanyGroupAggregateDto | null>(null);
  readonly unlinkingChildId = input<string | null>(null);

  readonly responsibleUserChange = output<string>();
  readonly deleteClick = output<void>();
  readonly monitoringClick = output<void>();
  readonly syncClick = output<void>();
  readonly seasearcherClick = output<void>();
  readonly unlinkParentClick = output<void>();

  typeLabel(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  }

  typeBadgeClass(type: string): string {
    switch (type) {
      case 'CLIENT': return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400';
      case 'SUPPLIER': return 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400';
      case 'BROKER': return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-400';
      case 'AGENT': return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400';
      default: return 'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-400';
    }
  }
}
