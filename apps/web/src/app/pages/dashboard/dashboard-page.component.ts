import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { JsonPipe, NgClass } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { switchMap, of, delay, Subscription } from 'rxjs';
import type { CollectionsResponseDto, OverdueInvoiceDto, TeamStatsResponseDto } from '@fueld/types';

import { CollectionsWidgetComponent } from '../../features/dashboard/components/collections-widget/collections-widget.component';
import { AuthService } from '../../core/auth/auth.service';

// ═══════════════════════════════════════════════════════════════════════
//  Dashboard Page — Manager view with collections and team stats
// ═══════════════════════════════════════════════════════════════════════

const API_URL = 'http://localhost:3000';

@Component({
  selector: 'app-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, JsonPipe, RouterLink, CollectionsWidgetComponent],
  template: `
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p class="mt-1 text-sm text-gray-500">Overview of your bunker trading operations.</p>

      <!-- Team View Toggle -->
      @if (auth.isAdmin()) {
        <div class="mt-6 flex items-center justify-end gap-3">
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
        <app-collections-widget [overdueInvoices]="collections()?.overdueInvoices ?? []" />
      </div>

      <!-- Pipeline & Team Stats (placeholders for now) -->
      <div class="mt-8 grid gap-6 lg:grid-cols-2">
        <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">Pipeline Summary</h3>
          <p class="text-gray-500">[Funnel chart and pipeline stages will go here]</p>
          <a routerLink="/analytics" class="mt-4 inline-block text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors">View Analytics</a>
        </div>
        <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">Team Performance</h3>
          <p class="text-gray-500">[Team stats, trader-specific metrics]</p>
          <pre>{{ teamStats() | json }}</pre>
        </div>
      </div>
    </div>
  `,
})
export class DashboardPageComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private subscriptions = new Subscription();

  // ─── State ───────────────────────────────────────────────────────
  readonly teamView = signal(false);
  readonly collections = signal<CollectionsResponseDto>({ overdueInvoices: [] });
  readonly teamStats = signal<TeamStatsResponseDto>({
    totalTraders: 0,
    activeOrders: 0,
    totalRevenueYTD: '—',
    avgDealSize: '—',
    traderPerformance: [],
  });

  // ─── Data fetches (will use a proper service in Phase 7) ────────

  // Mock data for overdue invoices
  private mockOverdueInvoices: OverdueInvoiceDto[] = [
    {
      id: 'inv-001',
      invoiceNumber: 'INV-2026-0001',
      clientName: 'Oceanic Logistics',
      amountDue: '125,000.00',
      dueDate: '2026-01-15',
      daysOverdue: 22,
      comments: [
        { id: 'cmt-1', invoiceId: 'inv-001', userId: 'u-2', userInitials: 'JS', comment: 'Followed up with client, awaiting payment approval.', createdAt: '2026-02-01' }
      ]
    },
    {
      id: 'inv-002',
      invoiceNumber: 'INV-2026-0005',
      clientName: 'Global Shipping Corp.',
      amountDue: '75,500.00',
      dueDate: '2026-01-20',
      daysOverdue: 17,
      comments: []
    },
    {
      id: 'inv-003',
      invoiceNumber: 'INV-2026-0012',
      clientName: 'Apex Maritime Solutions',
      amountDue: '210,000.00',
      dueDate: '2026-01-05',
      daysOverdue: 32,
      comments: [
        { id: 'cmt-2', invoiceId: 'inv-003', userId: 'u-1', userInitials: 'PN', comment: 'Client requesting partial payment plan. Pending approval.', createdAt: '2026-01-30' },
        { id: 'cmt-3', invoiceId: 'inv-003', userId: 'u-1', userInitials: 'PN', comment: 'Sent reminder 3 days ago.', createdAt: '2026-01-28' }
      ]
    },
  ];

  ngOnInit(): void {
    this.subscriptions.add(
      this.teamView().pipe(
        delay(200),
        switchMap((teamView) => {
          const mockData: CollectionsResponseDto = {
            overdueInvoices: this.mockOverdueInvoices,
          };
          return of(mockData);
        }),
      ).subscribe((data) => this.collections.set(data))
    );

    this.subscriptions.add(
      this.teamView().pipe(
        delay(300),
        switchMap((teamView) => {
          const mockStats: TeamStatsResponseDto = {
            totalTraders: teamView ? 4 : 1,
            activeOrders: teamView ? 25 : 7,
            totalRevenueYTD: teamView ? 'USD 12,345,678' : 'USD 3,210,987',
            avgDealSize: teamView ? 'USD 250,000' : 'USD 180,000',
            traderPerformance: teamView ? [
              { name: 'Patrick Nielsen', orders: 7, revenue: '2.3M', margin: '3.1%' },
              { name: 'Jane Smith', orders: 8, revenue: '3.5M', margin: '3.0%' },
              { name: 'John Doe', orders: 6, revenue: '2.8M', margin: '3.2%' },
              { name: 'Emily White', orders: 4, revenue: '3.7M', margin: '2.9%' },
            ] : [
              { name: 'Patrick Nielsen', orders: 7, revenue: '2.3M', margin: '3.1%' },
            ],
          };
          return of(mockStats);
        }),
      ).subscribe((data) => this.teamStats.set(data))
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  // ─── Computed ────────────────────────────────────────────────────

  readonly kpiCards = computed(() => [
    { label: 'Total Orders', value: this.teamStats().activeOrders.toString() },
    { label: 'Total Revenue YTD', value: this.teamStats().totalRevenueYTD },
    { label: 'Avg. Deal Size', value: this.teamStats().avgDealSize },
    { label: 'Overdue Invoices', value: this.collections().overdueInvoices.length.toString() },
  ]);

  // ─── Actions ─────────────────────────────────────────────────────

  toggleTeamView(): void {
    this.teamView.update((current) => !current);
  }
}
