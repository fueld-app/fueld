import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import {
  OrderStatus,
  CounterpartyType,
  type OrderDto,
  type OrderItemDto,
  type CounterpartyDto,
  type VesselDto,
  type PlaceDto,
  type ApiResponse,
} from '@fueld/types';

import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';
import {
  OrderItemsComponent,
  type OrderItemRow,
} from '../../components/order-items/order-items.component';
import {
  HeaderActionsComponent,
  type HeaderAction,
} from '../../components/header-actions/header-actions.component';
import { SendEmailModalComponent } from '../../components/send-email-modal/send-email-modal.component';
import type { DropdownOption } from '../../../../shared/components/searchable-dropdown/searchable-dropdown.component';

// ═══════════════════════════════════════════════════════════════════════
//  Order Detail Page — Full order view with editable items grid
// ═══════════════════════════════════════════════════════════════════════

const API_URL = 'http://localhost:3000';

@Component({
  selector: 'app-order-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    StatusBadgeComponent,
    OrderItemsComponent,
    HeaderActionsComponent,
    SendEmailModalComponent,
  ],
  template: `
    <!-- ═════════════════════════════════════════════════════════════ -->
    <!--  Page Header                                                 -->
    <!-- ═════════════════════════════════════════════════════════════ -->
    <div class="mb-6">
      <!-- Breadcrumb -->
      <nav class="mb-4 flex items-center gap-1.5 text-sm text-gray-500">
        <a routerLink="/trading/orders" class="hover:text-brand-600 transition-colors">Orders</a>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
        </svg>
        <span class="text-gray-900 font-medium">{{ orderId().slice(0, 8) }}...</span>
      </nav>

      <!-- Title row -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div class="flex items-center gap-3">
            <h1 class="text-2xl font-bold text-gray-900">Order Detail</h1>
            <app-status-badge [status]="order()?.status ?? 'INQUIRY'" />
          </div>
          <p class="mt-1 text-sm text-gray-500">
            {{ vesselName() }} · {{ portName() }} · {{ clientName() }}
          </p>
        </div>

        <div class="flex items-center gap-3">
          <!-- Save button -->
          @if (!isReadonly()) {
            <button
              (click)="saveOrder()"
              [disabled]="saving()"
              class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold
                     text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50
                     focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            >
              @if (saving()) {
                <svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              }
              Save
            </button>
          }

          <!-- Actions dropdown -->
          <app-header-actions
            [orderId]="orderId()"
            (actionTriggered)="onAction($event)"
          />
        </div>
      </div>
    </div>

    <!-- ═════════════════════════════════════════════════════════════ -->
    <!--  Order Meta Info Cards                                       -->
    <!-- ═════════════════════════════════════════════════════════════ -->
    <div class="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p class="text-xs font-medium uppercase tracking-wider text-gray-500">Client</p>
        <p class="mt-1 text-sm font-semibold text-gray-900">{{ clientName() }}</p>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p class="text-xs font-medium uppercase tracking-wider text-gray-500">Vessel</p>
        <p class="mt-1 text-sm font-semibold text-gray-900">{{ vesselName() }}</p>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p class="text-xs font-medium uppercase tracking-wider text-gray-500">Port</p>
        <p class="mt-1 text-sm font-semibold text-gray-900">{{ portName() }}</p>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p class="text-xs font-medium uppercase tracking-wider text-gray-500">ETA</p>
        <p class="mt-1 text-sm font-semibold text-gray-900">{{ order()?.eta ?? '—' }}</p>
      </div>
    </div>

    <!-- ═════════════════════════════════════════════════════════════ -->
    <!--  Editable Items Grid                                         -->
    <!-- ═════════════════════════════════════════════════════════════ -->
    <app-order-items
      [items]="itemRows()"
      [suppliers]="supplierDropdownOptions()"
      [readonly]="isReadonly()"
      (itemsChange)="onItemsChange($event)"
    />

    <!-- Toast notification -->
    @if (toast()) {
      <div
        class="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg transition-all"
        [class]="toast()!.type === 'success'
          ? 'border-green-200 bg-green-50 text-green-800'
          : 'border-red-200 bg-red-50 text-red-800'"
      >
        @if (toast()!.type === 'success') {
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd" />
          </svg>
        } @else {
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd" />
          </svg>
        }
        {{ toast()!.message }}
      </div>
    }

    <!-- Send Email Modal -->
    <app-send-email-modal
      [invoiceNumber]="invoiceNumber()"
      [vesselName]="vesselName()"
      [portName]="portName()"
      (sendEmail)="onSendEmail($event)"
    />
  `,
})
export class OrderDetailPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly emailModal = viewChild(SendEmailModalComponent);

  // ─── Route param ─────────────────────────────────────────────────

  readonly orderId = toSignal(
    this.route.paramMap.pipe(map((p) => p.get('id') ?? '')),
    { initialValue: '' },
  );

  // ─── State ───────────────────────────────────────────────────────

  readonly order = signal<OrderDto | null>(null);
  readonly client = signal<CounterpartyDto | null>(null);
  readonly vessel = signal<VesselDto | null>(null);
  readonly port = signal<PlaceDto | null>(null);
  readonly suppliers = signal<CounterpartyDto[]>([]);
  readonly itemRows = signal<OrderItemRow[]>([]);
  readonly saving = signal(false);
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);
  readonly invoiceNumber = signal('');

  // ─── Computed ────────────────────────────────────────────────────

  readonly clientName = computed(() => this.client()?.name ?? '—');
  readonly vesselName = computed(() => this.vessel()?.name ?? '—');
  readonly portName = computed(() => this.port()?.name ?? '—');

  readonly isReadonly = computed(() => {
    const status = this.order()?.status;
    return status === OrderStatus.Paid || status === OrderStatus.Cancelled;
  });

  readonly supplierDropdownOptions = computed<DropdownOption[]>(() =>
    this.suppliers().map((s) => ({ value: s.id, label: s.name })),
  );

  // ─── Mock data (will be replaced with API calls in Phase 7) ──────

  constructor() {
    // Load mock data for demo
    this.loadMockData();
  }

  private loadMockData(): void {
    const mockOrderId = 'ord-001';

    this.order.set({
      id: mockOrderId,
      tenantId: 'tenant-1',
      clientId: 'cp-1',
      vesselId: 'v-1',
      placeId: 'p-1',
      salesRepId: 'u-1',
      status: OrderStatus.Confirmed,
      eta: '2026-02-15',
      etd: '2026-02-17',
      lossReason: null,
      closedAt: null,
      createdAt: '2026-02-01T10:00:00Z',
      updatedAt: '2026-02-06T08:00:00Z',
    });

    this.client.set({
      id: 'cp-1',
      tenantId: 'tenant-1',
      name: 'Pacific Shipping Co.',
      type: CounterpartyType.Client,
      creditLimit: '500000',
      creditUsed: '125000',
      country: 'Singapore',
    });

    this.vessel.set({
      id: 'v-1',
      name: 'MV Nordic Star',
      imo: '9834567',
      mmsi: '234567890',
      flag: 'NO',
    });

    this.port.set({
      id: 'p-1',
      lliPlaceId: null,
      unlocode: 'NL RTM',
      name: 'Rotterdam',
      country: 'Netherlands',
      countryIso: 'NLD',
      area: 'N Cont Europe',
      placeType: 'POR',
      lat: 51.9225,
      long: 4.4792,
      admiraltyChart: null,
      parentPlaceId: null,
      parentPlaceName: null,
      subRegion: null,
      timezone: null,
      lliLastUpdated: null,
    });

    this.suppliers.set([
      { id: 'sp-1', tenantId: 'tenant-1', name: 'Shell Marine Products', type: CounterpartyType.Supplier, creditLimit: '0', creditUsed: '0', country: 'Netherlands' },
      { id: 'sp-2', tenantId: 'tenant-1', name: 'TotalEnergies Marine', type: CounterpartyType.Supplier, creditLimit: '0', creditUsed: '0', country: 'France' },
      { id: 'sp-3', tenantId: 'tenant-1', name: 'Vitol Bunkers', type: CounterpartyType.Supplier, creditLimit: '0', creditUsed: '0', country: 'Switzerland' },
      { id: 'sp-4', tenantId: 'tenant-1', name: 'Trafigura Marine', type: CounterpartyType.Supplier, creditLimit: '0', creditUsed: '0', country: 'Singapore' },
    ]);

    this.itemRows.set([
      {
        id: 'item-1',
        productType: 'VLSFO',
        supplierId: 'sp-1',
        quantity: 500,
        unit: 'MT',
        costPrice: 585.50,
        salesPrice: 612.00,
        profit: (612.00 - 585.50) * 500,
        paymentTerms: 'CREDIT_30',
      },
      {
        id: 'item-2',
        productType: 'LSMGO',
        supplierId: 'sp-2',
        quantity: 150,
        unit: 'MT',
        costPrice: 780.25,
        salesPrice: 815.00,
        profit: (815.00 - 780.25) * 150,
        paymentTerms: 'ON_RECEIPT',
      },
    ]);

    this.invoiceNumber.set('INV-2026-0042');
  }

  // ─── Item grid events ────────────────────────────────────────────

  onItemsChange(items: OrderItemRow[]): void {
    this.itemRows.set(items);
  }

  // ─── Actions ─────────────────────────────────────────────────────

  onAction(action: HeaderAction): void {
    switch (action) {
      case 'generate-invoice':
        this.downloadInvoicePdf();
        break;
      case 'send-email':
        this.emailModal()?.show();
        break;
      case 'mark-paid':
        this.markPaid();
        break;
    }
  }

  async saveOrder(): Promise<void> {
    this.saving.set(true);
    // Simulate save
    await new Promise((r) => setTimeout(r, 800));
    this.saving.set(false);
    this.showToast('success', 'Order saved successfully.');
  }

  private downloadInvoicePdf(): void {
    const id = this.orderId();
    if (!id) return;

    // Trigger browser download via API
    const url = `${API_URL}/orders/${id}/invoice/pdf`;
    const link = document.createElement('a');
    link.href = url;
    link.download = `Fueld_Invoice_${this.invoiceNumber()}.pdf`;
    link.click();
    this.showToast('success', 'Invoice PDF download started.');
  }

  onSendEmail(recipientEmail: string): void {
    const id = this.orderId();
    if (!id) return;

    this.http
      .post<ApiResponse<{ success: boolean; message: string }>>(
        `${API_URL}/orders/${id}/invoice/send`,
        {
          recipientEmail,
          vesselName: this.vesselName(),
          portName: this.portName(),
          // In production, the O365 token would come from the auth layer
          accessToken: 'placeholder-o365-token',
        },
      )
      .subscribe({
        next: () => {
          this.emailModal()?.done();
          this.showToast('success', `Invoice sent to ${recipientEmail}`);
        },
        error: () => {
          this.emailModal()?.done();
          this.showToast('error', 'Failed to send email. Check O365 token.');
        },
      });
  }

  private markPaid(): void {
    this.order.update((o) => (o ? { ...o, status: OrderStatus.Paid } : o));
    this.showToast('success', 'Order marked as paid.');
  }

  // ─── Toast ───────────────────────────────────────────────────────

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
  }
}
