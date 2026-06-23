import { Component, ChangeDetectionStrategy, input, output, signal, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import type { CounterpartyDto, CompanyChildSummaryDto, CompanyParentSummaryDto } from '@fueld/types';
import { AuthService } from '@app/core/auth/auth.service';

@Component({
  selector: 'app-group-structure-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DecimalPipe],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm min-[900px]:order-[12]">
      <div class="border-b border-gray-100 dark:border-line px-5 py-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">Group Structure</h2>
        <div class="flex items-center gap-2">
          @if (isParent()) {
            <span class="inline-flex items-center rounded-full bg-brand-50 dark:bg-brand-700/15 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-400">
              Parent · {{ childCompanies().length }} {{ childCompanies().length === 1 ? 'child' : 'children' }}
            </span>
          }
          @if (!isChild()) {
            <button (click)="showLinkModal.set(true)"
              class="rounded-md bg-brand-50 dark:bg-brand-700/15 px-2 py-1 text-[11px] font-medium text-brand-700 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-500/20 transition-colors">
              + Add child
            </button>
          }
        </div>
      </div>
      <div class="px-5 py-4">
        @if (isChild()) {
          <!-- Show as child -->
          <div class="space-y-1">
            <div class="flex items-center gap-2 rounded-lg bg-gray-50 dark:bg-bg-2 px-3 py-2">
              <div class="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-700/15 text-brand-700 dark:text-brand-400 text-[10px] font-bold">P</div>
              <a [routerLink]="['/companies', parentCompany()!.id]"
                 class="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline">{{ parentCompany()!.name }}</a>
              @if (parentCompany()!.country) {
                <span class="text-xs text-gray-400 dark:text-muted">{{ parentCompany()!.country }}</span>
              }
            </div>
            <div class="ml-6 flex items-center gap-2 rounded-lg border border-brand-200 dark:border-brand-500/30 bg-brand-50/50 px-3 py-2">
              <div class="h-4 border-l-2 border-gray-300 dark:border-line-strong mr-1"></div>
              <div class="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 dark:bg-surface-3 text-gray-600 dark:text-ink-dim text-[10px] font-bold">C</div>
              <span class="text-sm font-medium text-gray-900 dark:text-ink">{{ company().name }}</span>
              <span class="text-[10px] text-gray-400 dark:text-muted">(this company)</span>
            </div>
          </div>
        } @else if (isParent()) {
          <div class="space-y-1">
            <div class="flex items-center gap-2 rounded-lg border border-brand-200 dark:border-brand-500/30 bg-brand-50/50 px-3 py-2">
              <div class="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-700/15 text-brand-700 dark:text-brand-400 text-[10px] font-bold">P</div>
              <span class="text-sm font-medium text-gray-900 dark:text-ink">{{ company().name }}</span>
              @if (company().country) { <span class="text-xs text-gray-400 dark:text-muted">{{ company().country }}</span> }
              @if (auth.canSeePrices()) { <span class="ml-auto text-xs text-gray-500 dark:text-muted">Credit: {{ company().creditLimit | number:'1.0-0' }}</span> }
              @if (company().fleetSize) { <span class="text-xs text-gray-500 dark:text-muted">Fleet: {{ company().fleetSize }}</span> }
            </div>
            @for (child of childCompanies(); track child.id) {
              <div class="ml-6 flex items-center gap-2 rounded-lg bg-gray-50 dark:bg-bg-2 px-3 py-2 group hover:bg-gray-100 dark:hover:bg-surface-tint-strong transition-colors">
                <div class="h-4 border-l-2 border-gray-300 dark:border-line-strong mr-1"></div>
                <div class="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 dark:bg-surface-3 text-gray-600 dark:text-ink-dim text-[10px] font-bold">C</div>
                <a [routerLink]="['/companies', child.id]" class="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline">{{ child.name }}</a>
                @if (child.country) { <span class="text-xs text-gray-400 dark:text-muted">{{ child.country }}</span> }
                @if (auth.canSeePrices()) { <span class="ml-auto text-xs text-gray-500 dark:text-muted">Credit: {{ child.creditLimit | number:'1.0-0' }}</span> }
                @if (child.fleetSize) { <span class="text-xs text-gray-500 dark:text-muted">Fleet: {{ child.fleetSize }}</span> }
                @if (child.isSanctioned) { <span class="text-[10px] text-red-600 dark:text-red-400">⚠️</span> }
                <button
                  (click)="unlinkChild.emit(child.id); $event.stopPropagation()"
                  [disabled]="unlinkingChildId() === child.id"
                  class="invisible group-hover:visible rounded px-1.5 py-0.5 text-[10px] text-red-500 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors disabled:opacity-50"
                >
                  @if (unlinkingChildId() === child.id) { … } @else { Unlink }
                </button>
              </div>
            }
          </div>
        } @else {
          <p class="text-sm text-gray-400 dark:text-muted">No child companies linked yet. Click "+ Add child" to create a group.</p>
        }
      </div>
    </div>

    <!-- Link Child Modal -->
    @if (showLinkModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" (click)="showLinkModal.set(false)">
        <div class="w-full max-w-md rounded-xl bg-white dark:bg-surface p-6 shadow-xl" (click)="$event.stopPropagation()">
          <h3 class="text-base font-semibold text-gray-900 dark:text-ink mb-4">Add Child Company</h3>
          <p class="text-xs text-gray-500 dark:text-muted mb-3">Search for an existing company to link as a child of <strong>{{ company().name }}</strong>.</p>
          <input type="text"
            [value]="localSearch()"
            (input)="onLinkSearch($any($event.target).value)"
            placeholder="Search companies..."
            class="w-full rounded-lg border border-gray-200 dark:border-line px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
          />
          @if (linkChildResults().length) {
            <div class="mt-2 max-h-48 overflow-y-auto divide-y divide-gray-50 rounded-lg border border-gray-100 dark:border-line">
              @for (r of linkChildResults(); track r.id) {
                <button
                  (click)="linkChildRequest.emit(r.id)"
                  [disabled]="linkingChildId() === r.id"
                  class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-surface-tint transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  <span class="font-medium text-gray-900 dark:text-ink">{{ r.name }}</span>
                  @if (r.country) { <span class="text-xs text-gray-400 dark:text-muted">{{ r.country }}</span> }
                  @if (linkingChildId() === r.id) {
                    <svg class="ml-auto h-4 w-4 animate-spin text-brand-500 dark:text-brand-300" viewBox="0 0 24 24" fill="none">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  }
                </button>
              }
            </div>
          } @else if (localSearch().length >= 2) {
            <div class="mt-2 text-center text-xs text-gray-400 dark:text-muted py-3">No matching companies found</div>
          }
          <div class="mt-4 flex justify-end">
            <button (click)="showLinkModal.set(false)" class="rounded-md px-3 py-1.5 text-sm text-gray-500 dark:text-muted hover:bg-gray-50 dark:hover:bg-surface-tint transition-colors">Cancel</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class GroupStructureCardComponent {
  protected readonly auth = inject(AuthService);
  readonly company = input.required<CounterpartyDto>();
  readonly childCompanies = input<CompanyChildSummaryDto[]>([]);
  readonly parentCompany = input<CompanyParentSummaryDto | null>(null);
  readonly isParent = input<boolean>(false);
  readonly isChild = input<boolean>(false);
  readonly linkingChildId = input<string | null>(null);
  readonly unlinkingChildId = input<string | null>(null);
  readonly linkChildSearch = input<string>('');
  readonly linkChildResults = input<{ id: string; name: string; country: string | null; parentId: string | null }[]>([]);

  readonly linkChildRequest = output<string>();
  readonly unlinkChild = output<string>();
  readonly linkSearchChange = output<string>();

  readonly showLinkModal = signal(false);
  readonly localSearch = signal('');

  onLinkSearch(term: string): void {
    this.localSearch.set(term);
    this.linkSearchChange.emit(term);
  }
}
