import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  effect,
} from '@angular/core';
import { JsonPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
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
  imports: [JsonPipe, RouterLink, CollectionsWidgetComponent],
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
        <app-collections-widget [overdueInvoices]="collections().items" />
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
export class DashboardPageComponent {
  readonly auth = inject(AuthService);

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

  // ─── Data fetches (will use a proper service in Phase 7) ────────

  // Mock data for overdue invoices
  private mockOverdueInvoices: OverdueInvoiceDto[] = [
    {
      invoiceId: 'inv-001',
      invoiceNumber: 'INV-2026-0001',
      orderId: 'ord-001',
      clientName: 'Oceanic Logistics',
      vesselName: 'MV Neptune',
      amount: '125,000.00',
      amountPaid: '0.00',
      dueDate: '2026-01-15',
      daysOverdue: 22,
      status: 'OVERDUE',
      comments: [
        { id: 'cmt-1', invoiceId: 'inv-001', userId: 'u-2', comment: 'Followed up with client, awaiting payment approval.', nextActionDate: null, createdAt: '2026-02-01' }
      ]
    },
    {
      invoiceId: 'inv-002',
      invoiceNumber: 'INV-2026-0005',
      orderId: 'ord-002',
      clientName: 'Global Shipping Corp.',
      vesselName: 'MV Horizon',
      amount: '75,500.00',
      amountPaid: '0.00',
      dueDate: '2026-01-20',
      daysOverdue: 17,
      status: 'OVERDUE',
      comments: []
    },
    {
      invoiceId: 'inv-003',
      invoiceNumber: 'INV-2026-0012',
      orderId: 'ord-003',
      clientName: 'Apex Maritime Solutions',
      vesselName: 'MV Voyager',
      amount: '210,000.00',
      amountPaid: '0.00',
      dueDate: '2026-01-05',
      daysOverdue: 32,
      status: 'OVERDUE',
      comments: [
        { id: 'cmt-2', invoiceId: 'inv-003', userId: 'u-1', comment: 'Client requesting partial payment plan. Pending approval.', nextActionDate: null, createdAt: '2026-01-30' },
        { id: 'cmt-3', invoiceId: 'inv-003', userId: 'u-1', comment: 'Sent reminder 3 days ago.', nextActionDate: null, createdAt: '2026-01-28' }
      ]
    },
  ];

  constructor() {
    // Load mock data reactively when teamView changes
    effect(() => {
      const isTeamView = this.teamView();

      this.collections.set({
        items: this.mockOverdueInvoices,
        count: this.mockOverdueInvoices.length,
      });

      this.teamStats.set({
        totalTraders: isTeamView ? 4 : 1,
        activeOrders: isTeamView ? 25 : 7,
        totalRevenueYTD: isTeamView ? 'USD 12,345,678' : 'USD 3,210,987',
        avgDealSize: isTeamView ? 'USD 250,000' : 'USD 180,000',
        traderPerformance: isTeamView ? [
          { name: 'Patrick Nielsen', orders: 7, revenue: '2.3M', margin: '3.1%' },
          { name: 'Jane Smith', orders: 8, revenue: '3.5M', margin: '3.0%' },
          { name: 'John Doe', orders: 6, revenue: '2.8M', margin: '3.2%' },
          { name: 'Emily White', orders: 4, revenue: '3.7M', margin: '2.9%' },
        ] : [
          { name: 'Patrick Nielsen', orders: 7, revenue: '2.3M', margin: '3.1%' },
        ],
      });
    });
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
}
