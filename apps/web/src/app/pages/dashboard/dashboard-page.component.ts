import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
  ElementRef,
  ViewChild,
  OnDestroy,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import type { CollectionsResponseDto, TeamStatsResponseDto } from '@fueld/types';

import { CollectionsWidgetComponent } from '../../features/dashboard/components/collections-widget/collections-widget.component';
import { AuthService } from '../../core/auth/auth.service';

// ═══════════════════════════════════════════════════════════════════════
//  Dashboard Page — Manager view with collections and team stats
// ═══════════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, CollectionsWidgetComponent],
  template: `
    <div>
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p class="mt-1 text-sm text-gray-500">Overview of your bunker trading operations.</p>
        </div>

        <!-- Date Range Selector -->
        <div class="flex items-center gap-3 flex-shrink-0">
          <div class="relative" #dateDropdown>
            <button
              (click)="dateDropdownOpen.set(!dateDropdownOpen())"
              class="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd" />
              </svg>
              {{ dateRangeLabel() }}
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z" clip-rule="evenodd" />
              </svg>
            </button>

            @if (dateDropdownOpen()) {
              <div class="absolute right-0 z-50 mt-1 w-64 origin-top-right rounded-lg border border-gray-200 bg-white shadow-lg ring-1 ring-black/5 max-h-[calc(100vh-120px)] overflow-y-auto">
                <div class="py-1">
                  @for (preset of datePresets; track preset.key) {
                    <button
                      (click)="selectDatePreset(preset.key)"
                      class="flex w-full items-center justify-between px-4 py-2 text-sm transition-colors"
                      [class]="selectedDatePreset() === preset.key
                        ? 'bg-brand-50 text-brand-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'"
                    >
                      {{ preset.label }}
                      @if (selectedDatePreset() === preset.key) {
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-brand-600" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                        </svg>
                      }
                    </button>
                  }
                </div>
                <div class="border-t border-gray-100 px-4 py-3">
                  <p class="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Custom Range</p>
                  <div class="flex items-center gap-2">
                    <input
                      type="date"
                      [ngModel]="customDateFrom()"
                      (ngModelChange)="customDateFrom.set($event)"
                      class="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                    <span class="text-gray-400 text-xs flex-shrink-0">to</span>
                    <input
                      type="date"
                      [ngModel]="customDateTo()"
                      (ngModelChange)="customDateTo.set($event)"
                      class="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <button
                    (click)="applyCustomRange()"
                    class="mt-2 w-full rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 transition-colors"
                  >
                    Apply
                  </button>
                </div>
              </div>
            }
          </div>
        </div>
      </div>

      <!-- Team View Toggle -->
      @if (auth.isAdmin()) {
        <div class="mt-4 flex items-center justify-end gap-3">
          <span class="text-sm font-medium text-gray-600">My Orders</span>
          <button
            (click)="toggleTeamView()"
            [class.bg-brand-600]="teamView()"
            [class.bg-gray-200]="!teamView()"
            class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            role="switch"
            [attr.aria-checked]="teamView()"
          >
            <span class="sr-only">Enable notifications</span>
            <span
              aria-hidden="true"
              [class.translate-x-5]="teamView()"
              [class.translate-x-0]="!teamView()"
              class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
            ></span>
          </button>
          <span class="text-sm font-medium text-gray-600">Team View</span>
        </div>
      }

      <!-- KPI Cards -->
      <div class="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        @for (card of kpiCards(); track card.label) {
          <div class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <p class="text-sm font-medium text-gray-500">{{ card.label }}</p>
            <p class="mt-2 text-3xl font-bold text-gray-900">{{ card.value }}</p>
          </div>
        }
      </div>

      <!-- Collections Widget -->
      <div class="mt-8">
        <app-collections-widget [overdueInvoices]="collections().items" />
      </div>

      <!-- Pipeline & Loss Analysis -->
      <div class="mt-8 grid gap-6 lg:grid-cols-2">
        <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-gray-900">Sales Funnel</h3>
            <a routerLink="/analytics" class="text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors">View Analytics &rarr;</a>
          </div>
          <p class="text-sm text-gray-500">No data available yet.</p>
        </div>
        <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">Loss Analysis</h3>
          <p class="text-sm text-gray-500">No data available yet.</p>
        </div>
      </div>
    </div>
  `,
})
export class DashboardPageComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  private readonly elRef = inject(ElementRef);

  @ViewChild('dateDropdown') dateDropdownRef!: ElementRef;

  // ─── Date Range ──────────────────────────────────────────────────
  readonly dateDropdownOpen = signal(false);
  readonly selectedDatePreset = signal<string>('this_month');
  readonly customDateFrom = signal('');
  readonly customDateTo = signal('');

  readonly datePresets = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'this_week', label: 'This Week' },
    { key: 'last_7_days', label: 'Last 7 Days' },
    { key: 'this_month', label: 'This Month' },
    { key: 'last_30_days', label: 'Last 30 Days' },
    { key: 'this_quarter', label: 'This Quarter' },
    { key: 'this_year', label: 'Year to Date' },
  ];

  readonly dateRangeLabel = computed(() => {
    const preset = this.selectedDatePreset();
    if (preset === 'custom') {
      const from = this.customDateFrom();
      const to = this.customDateTo();
      if (from && to) return `${this.formatShortDate(from)} – ${this.formatShortDate(to)}`;
      return 'Custom Range';
    }
    return this.datePresets.find((p) => p.key === preset)?.label ?? 'This Month';
  });

  readonly dateRange = computed(() => {
    const preset = this.selectedDatePreset();
    const now = new Date();
    let from: Date;
    let to: Date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    switch (preset) {
      case 'today':
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'yesterday': {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        from = new Date(y.getFullYear(), y.getMonth(), y.getDate());
        to = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59);
        break;
      }
      case 'this_week': {
        const day = now.getDay();
        from = new Date(now);
        from.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
        from.setHours(0, 0, 0, 0);
        break;
      }
      case 'last_7_days':
        from = new Date(now);
        from.setDate(now.getDate() - 6);
        from.setHours(0, 0, 0, 0);
        break;
      case 'this_month':
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'last_30_days':
        from = new Date(now);
        from.setDate(now.getDate() - 29);
        from.setHours(0, 0, 0, 0);
        break;
      case 'this_quarter': {
        const q = Math.floor(now.getMonth() / 3);
        from = new Date(now.getFullYear(), q * 3, 1);
        break;
      }
      case 'this_year':
        from = new Date(now.getFullYear(), 0, 1);
        break;
      case 'custom':
        from = this.customDateFrom() ? new Date(this.customDateFrom()) : new Date(now.getFullYear(), now.getMonth(), 1);
        to = this.customDateTo() ? new Date(this.customDateTo() + 'T23:59:59') : to;
        break;
      default:
        from = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    return { from, to };
  });

  private clickOutsideHandler = (event: MouseEvent) => {
    if (this.dateDropdownRef && !this.dateDropdownRef.nativeElement.contains(event.target)) {
      this.dateDropdownOpen.set(false);
    }
  };

  // ─── State ───────────────────────────────────────────────────────
  readonly teamView = signal(false);
  readonly collections = signal<CollectionsResponseDto>({ items: [], count: 0 });
  readonly teamStats = signal<TeamStatsResponseDto>({
    totalTraders: 0,
    activeOrders: 0,
    totalRevenueYTD: '—',
    avgDealSize: '—',
    traderPerformance: [],
  });

  constructor() {}

  // ─── Lifecycle ────────────────────────────────────────────────────

  ngOnInit(): void {
    document.addEventListener('click', this.clickOutsideHandler);
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this.clickOutsideHandler);
  }

  // ─── Computed ────────────────────────────────────────────────────

  readonly kpiCards = computed(() => [
    { label: 'Total Orders', value: this.teamStats().activeOrders.toString() },
    { label: 'Total Revenue YTD', value: this.teamStats().totalRevenueYTD },
    { label: 'Avg. Deal Size', value: this.teamStats().avgDealSize },
    { label: 'Overdue Invoices', value: this.collections().items.length.toString() },
  ]);

  // ─── Actions ─────────────────────────────────────────────────────

  toggleTeamView(): void {
    this.teamView.update((current) => !current);
  }

  selectDatePreset(key: string): void {
    this.selectedDatePreset.set(key);
    this.dateDropdownOpen.set(false);
  }

  applyCustomRange(): void {
    if (this.customDateFrom() && this.customDateTo()) {
      this.selectedDatePreset.set('custom');
      this.dateDropdownOpen.set(false);
    }
  }

  private formatShortDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }

}
