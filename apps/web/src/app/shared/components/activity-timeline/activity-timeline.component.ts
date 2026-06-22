import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  input,
  OnInit,
  OnDestroy,
  effect,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse } from '@fueld/types';

import { API } from '@app/core/config/api';
import {
  extractActivityChangeRows,
  formatActivityMetadataValue,
  formatMetadataLabel,
  getActivityMetadataAction,
} from './activity-timeline.formatters';

interface ActivityItem {
  id: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  entityName: string | null;
  httpMethod: string | null;
  httpPath: string | null;
  clientIp: string | null;
  userAgent: string | null;
  platform: string | null;
  metadata: unknown;
  createdAt: string;
}

@Component({
  selector: 'app-activity-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    <div class="app-panel h-[420px] flex flex-col overflow-hidden">
      <div class="app-panel-header app-panel-header--blue justify-between px-5 py-3">
        <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">Activity History</h2>
        <div class="flex items-center gap-2">
          @if (total() > 0) {
            <span class="inline-flex items-center rounded-full bg-gray-100 dark:bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-ink-dim">{{ total() }}</span>
          }
          <button
            (click)="reload()"
            class="rounded-md p-1 text-gray-400 dark:text-muted hover:bg-gray-100 dark:hover:bg-surface-tint-strong hover:text-gray-600 transition-colors"
            title="Refresh"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto">
      @if (loading()) {
        <div class="flex items-center justify-center py-8">
          <svg class="h-5 w-5 animate-spin text-gray-400 dark:text-muted" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (items().length) {
        <div class="divide-y divide-gray-50">
          @for (item of items(); track item.id) {
            <div class="px-5 py-3 flex items-start gap-3 hover:bg-gray-50/50 transition-colors dark:hover:bg-surface-tint">
              <!-- Action icon -->
              <div class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                [class]="actionIconClass(item.action)">
                @if (item.action === 'CREATE') {
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                  </svg>
                } @else if (item.action === 'UPDATE') {
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
                  </svg>
                } @else if (item.action === 'DELETE') {
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022 1.005 11.36A2.75 2.75 0 0 0 7.765 20h4.47a2.75 2.75 0 0 0 2.742-2.53l.954-10.788c.793-.122 1.577-.221 2.367-.298a.75.75 0 0 0-.23-1.482c-.781.122-1.57.22-2.365.298v-.443A2.75 2.75 0 0 0 12.75 1h-4Z" clip-rule="evenodd" />
                  </svg>
                } @else if (item.action === 'EMAIL_SENT') {
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M3 4a2 2 0 0 0-2 2v1.161l8.441 4.221a1.25 1.25 0 0 0 1.118 0L19 7.162V6a2 2 0 0 0-2-2H3Z" />
                    <path d="m19 8.839-7.77 3.885a2.75 2.75 0 0 1-2.46 0L1 8.839V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.839Z" />
                  </svg>
                } @else {
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                    <path fill-rule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41Z" clip-rule="evenodd" />
                  </svg>
                }
              </div>

              <!-- Content -->
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 text-sm">
                  <span class="font-medium text-gray-900 dark:text-ink">{{ item.userName ?? item.userEmail ?? 'System' }}</span>
                  <span class="text-gray-400 dark:text-muted">{{ actionLabel(item.action, item.httpPath, item.metadata) }}</span>
                </div>
                @if (changeRows(item.metadata); as changes) {
                  <div class="mt-2 space-y-1 text-[11px] text-gray-600 dark:text-ink-dim">
                    @for (change of changes; track change.field) {
                      <div class="flex flex-wrap items-start gap-x-2 gap-y-1 rounded-lg border border-gray-100 dark:border-line bg-gray-50 dark:bg-bg-2 px-2.5 py-1.5">
                        <span class="font-medium text-gray-700 dark:text-ink-dim">{{ change.field }}</span>
                        <span class="text-gray-400 dark:text-muted">from</span>
                        <span class="break-words whitespace-normal text-gray-500 dark:text-muted">{{ change.from }}</span>
                        <span class="text-gray-400 dark:text-muted">to</span>
                        <span class="break-words whitespace-normal font-medium text-gray-700 dark:text-ink-dim">{{ change.to }}</span>
                      </div>
                    }
                  </div>
                } @else if (metadataEntries(item.metadata); as entries) {
                  @if (entries.length) {
                    <div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500 dark:text-muted">
                      @for (entry of entries; track entry.key) {
                        <span class="max-w-full min-w-0 break-words whitespace-normal">
                          <span class="font-medium text-gray-600 dark:text-ink-dim">{{ entry.key }}:</span>
                          <span class="break-words whitespace-normal">{{ entry.value }}</span>
                        </span>
                      }
                    </div>
                  }
                }
                <div class="mt-0.5 flex items-center gap-2 text-xs text-gray-400 dark:text-muted">
                  <span>{{ item.createdAt | date:'short' }}</span>
                  @if (item.platform) {
                    <span class="hidden sm:inline">&middot;</span>
                    <span class="hidden sm:inline">{{ item.platform }}</span>
                  }
                  @if (item.clientIp) {
                    <span class="hidden sm:inline">&middot;</span>
                    <span class="hidden sm:inline font-mono text-[10px]">{{ item.clientIp }}</span>
                  }
                </div>
              </div>

              <!-- Action badge -->
              <span class="shrink-0 mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                [class]="actionBadgeClass(item.action)">
                {{ item.action }}
              </span>
            </div>
          }
        </div>

        @if (hasMore()) {
          <div class="border-t border-gray-100 dark:border-line px-5 py-3 text-center">
            <button
              (click)="loadMore()"
              [disabled]="loadingMore()"
              class="text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 transition-colors disabled:opacity-50"
            >
              @if (loadingMore()) {
                Loading…
              } @else {
                Load more ({{ total() - items().length }} remaining)
              }
            </button>
          </div>
        }
      } @else {
        <div class="px-5 py-8 text-center text-sm text-gray-400 dark:text-muted">
          No activity recorded for this entity yet.
        </div>
      }
      </div>
    </div>
  `,
})
export class ActivityTimelineComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);

  readonly entityType = input.required<string>();
  readonly entityId = input.required<string>();

  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly items = signal<ActivityItem[]>([]);
  readonly total = signal(0);
  readonly hasMore = signal(false);

  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private currentOffset = 0;
  private readonly pageSize = 20;

  constructor() {
    // Re-fetch when entityId changes
    effect(() => {
      const id = this.entityId();
      const type = this.entityType();
      if (id && type) {
        this.currentOffset = 0;
        this.loadActivity(true);
      }
    });
  }

  ngOnInit() {
    // Auto-refresh every 30s
    this.refreshTimer = setInterval(() => this.loadActivity(false), 30_000);
  }

  ngOnDestroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  reload(): void {
    this.currentOffset = 0;
    this.loadActivity(true);
  }

  async loadActivity(showLoading: boolean): Promise<void> {
    const type = this.entityType();
    const id = this.entityId();
    if (!type || !id) return;

    if (showLoading) this.loading.set(true);

    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ items: ActivityItem[]; total: number }>>(
          `${API}/activity/${encodeURIComponent(type)}/${encodeURIComponent(id)}?limit=${this.pageSize}&offset=0`,
        ),
      );

      if (res.success && res.data) {
        const fetched = res.data.items ?? [];
        this.items.set(fetched);
        this.total.set(res.data.total ?? 0);
        this.currentOffset = fetched.length;
        this.hasMore.set(fetched.length < (res.data.total ?? 0));
      }
    } catch {
      // silently fail on refresh
    } finally {
      this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    const type = this.entityType();
    const id = this.entityId();
    if (!type || !id) return;

    this.loadingMore.set(true);

    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ items: ActivityItem[]; total: number }>>(
          `${API}/activity/${encodeURIComponent(type)}/${encodeURIComponent(id)}?limit=${this.pageSize}&offset=${this.currentOffset}`,
        ),
      );

      if (res.success && res.data) {
        const fetched = res.data.items ?? [];
        this.items.update((prev) => [...prev, ...fetched]);
        this.total.set(res.data.total ?? 0);
        this.currentOffset += fetched.length;
        this.hasMore.set(this.currentOffset < (res.data.total ?? 0));
      }
    } catch {
      // ignore
    } finally {
      this.loadingMore.set(false);
    }
  }

  actionLabel(action: string, httpPath?: string | null, metadata?: unknown): string {
    const metadataAction = getActivityMetadataAction(metadata);

    if (metadataAction?.startsWith('update_') && Array.isArray((metadata as Record<string, unknown> | null)?.['changes'])) {
      return 'updated fields';
    }
    if (metadataAction === 'save_items') return 'saved items';
    if (metadataAction === 'add_supplier_leg') return 'added a supplier';
    if (metadataAction === 'update_supplier_leg') return 'updated a supplier';
    if (metadataAction === 'delete_supplier_leg') return 'removed a supplier';
    if (metadataAction === 'finalize_price') return 'finalized item pricing';

    if (httpPath) {
      if (httpPath.includes('/suppliers') && action === 'CREATE') return 'added a supplier';
      if (httpPath.includes('/suppliers') && action === 'DELETE') return 'removed a supplier';
      if (httpPath.includes('/suppliers') && action === 'UPDATE') return 'updated a supplier';
      if (httpPath.includes('/responsible-user')) return 'changed responsible user';
    }
    switch (action) {
      case 'VIEW':
        return 'viewed this';
      case 'CREATE':
        return 'created this';
      case 'UPDATE':
        return 'updated this';
      case 'DELETE':
        return 'deleted this';
      case 'PRINT':
        return 'printed this page';
      case 'SCREENSHOT':
        return 'took a screenshot';
      case 'EMAIL_SENT':
        return 'sent an email';
      default:
        return action.toLowerCase();
    }
  }

  private readonly META_LABELS: Record<string, string> = {
    supplier: 'Supplier',
    products: 'Products',
    note: 'Note',
    field: 'Field',
    name: 'Name',
    clientId: 'Client',
    country: 'Country',
    countryIso: 'Country ISO',
    creditLimit: 'Credit limit',
    yearFormed: 'Year formed',
    fleetSize: 'Fleet size',
    headOfficeAddress: 'Head office address',
    headOfficePhone: 'Head office phone',
    headOfficeEmail: 'Head office email',
    website: 'Website',
    companyImo: 'Company IMO',
    companyRoles: 'Company roles',
    types: 'Types',
    segments: 'Segments',
    vesselId: 'Vessel',
    imo: 'IMO',
    mmsi: 'MMSI',
    flag: 'Flag',
    type: 'Type',
    status: 'Status',
    loa: 'LOA',
    breadth: 'Breadth',
    depth: 'Depth',
    draught: 'Draught',
    deadWeightTonnage: 'Deadweight tonnage',
    grossTonnage: 'Gross tonnage',
    buildYear: 'Build year',
    builder: 'Builder',
    classificationSociety: 'Classification society',
    ignoreForCreditEnforcement: 'Ignore for credit enforcement',
    placeId: 'Place',
    area: 'Area',
    subRegion: 'Sub-region',
    placeType: 'Place type',
    timezone: 'Timezone',
    lat: 'Latitude',
    long: 'Longitude',
    unlocode: 'UN/LOCODE',
    admiraltyChart: 'Admiralty chart',
    parentPlaceId: 'Parent place',
    salesRepId: 'Sales rep',
    invoicingCompanyId: 'Invoicing company',
    bankAccountId: 'Bank account',
    eta: 'ETA',
    etd: 'ETD',
    deliveredAt: 'Delivered at',
    customerPaymentTermType: 'Customer payment term',
    customerCreditDays: 'Customer credit days',
    customerNote: 'Customer note',
    customerContactId: 'Customer contact',
    supplierId: 'Supplier',
    supplierPaymentTermType: 'Supplier payment term',
    supplierCreditDays: 'Supplier credit days',
    supplierNote: 'Supplier note',
    supplierContactId: 'Supplier contact',
    brokerId: 'Broker',
    brokerContactId: 'Broker contact',
    brokerGetsAll: 'Broker gets all',
    agentId: 'Agent',
    agentContactId: 'Agent contact',
    termsAndConditions: 'Terms and conditions',
    placeRemark: 'Place remark',
    lossReason: 'Loss reason',
    responsibleUserId: 'User',
    contactId: 'Contact',
    documentType: 'Type',
    recipientEmail: 'To',
    recipients: 'Suppliers',
    channel: 'Channel',
    subject: 'Subject',
    count: 'Count',
  };

  private readonly META_SKIP = new Set(['httpMethod', 'httpPath', 'userAgent', 'clientIp', 'action', 'changes']);

  changeRows(metadata: unknown): Array<{ field: string; from: string; to: string }> | null {
    return extractActivityChangeRows(metadata, this.META_LABELS);
  }

  metadataEntries(metadata: unknown): { key: string; value: string }[] | null {
    if (!metadata || typeof metadata !== 'object') return null;
    const entries: { key: string; value: string }[] = [];
    for (const [k, v] of Object.entries(metadata as Record<string, unknown>)) {
      if (this.META_SKIP.has(k) || v == null || v === '') continue;
      const label = this.META_LABELS[k] ?? formatMetadataLabel(k);
      const value = formatActivityMetadataValue(v);
      if (value) entries.push({ key: label, value });
    }
    return entries;
  }

  actionIconClass(action: string): string {
    switch (action) {
      case 'CREATE':
        return 'bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-400';
      case 'UPDATE':
        return 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400';
      case 'DELETE':
        return 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400';
      case 'EMAIL_SENT':
        return 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400';
      default:
        return 'bg-gray-100 text-gray-500 dark:bg-gray-500/15 dark:text-gray-400';
    }
  }

  actionBadgeClass(action: string): string {
    switch (action) {
      case 'CREATE':
        return 'bg-green-50 text-green-700 dark:bg-emerald-500/15 dark:text-emerald-300';
      case 'UPDATE':
        return 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300';
      case 'DELETE':
        return 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300';
      case 'PRINT':
        return 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300';
      case 'SCREENSHOT':
        return 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300';
      case 'VIEW':
        return 'bg-gray-100 text-gray-600 dark:bg-surface-3 dark:text-ink-dim';
      case 'EMAIL_SENT':
        return 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300';
      default:
        return 'bg-gray-100 text-gray-600 dark:bg-surface-3 dark:text-ink-dim';
    }
  }
}
