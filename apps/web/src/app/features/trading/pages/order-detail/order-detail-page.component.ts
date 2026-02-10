import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  viewChild,
  OnInit,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import {
  OrderStatus,
  type OrderDto,
  type CounterpartyDto,
  type VesselDto,
  type PlaceDto,
  type ApiResponse,
  type OwnCompanyDto,
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
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { CommentsCardComponent } from '../../../../shared/components/comments-card/comments-card.component';
import { PdfPreviewModalComponent } from '../../../../shared/components/pdf-preview-modal/pdf-preview-modal.component';

// ═══════════════════════════════════════════════════════════════════════
//  Order Detail Page — Full order view with editable items grid
// ═══════════════════════════════════════════════════════════════════════

import { API_URL } from '@app/core/config/api';

@Component({
  selector: 'app-order-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormsModule,
    StatusBadgeComponent,
    OrderItemsComponent,
    HeaderActionsComponent,
    SendEmailModalComponent,
    CommentsCardComponent,
    PdfPreviewModalComponent,
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
        <span class="text-gray-900 font-medium">{{ order()?.orderNumber ?? orderId().slice(0, 8) + '...' }}</span>
      </nav>

      <!-- Title row -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div class="flex items-center gap-3">
            <h1 class="text-2xl font-bold text-gray-900">Order Detail</h1>
            <app-status-badge [status]="order()?.status ?? 'INQUIRY'" />
          </div>
          <p class="mt-1 text-sm text-gray-500">
            @if (order()?.orderNumber) {
              <span class="font-mono text-gray-600">{{ order()!.orderNumber }}</span>
              <span class="mx-1.5">·</span>
            }
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
    <div class="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p class="text-xs font-medium uppercase tracking-wider text-gray-500">Client</p>
        <p class="mt-1 text-sm font-semibold text-gray-900">{{ clientName() }}</p>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p class="text-xs font-medium uppercase tracking-wider text-gray-500">Vessel</p>
        <p class="mt-1 text-sm font-semibold text-gray-900">{{ vesselName() }}</p>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p class="text-xs font-medium uppercase tracking-wider text-gray-500">Place</p>
        <p class="mt-1 text-sm font-semibold text-gray-900">{{ portName() }}</p>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p class="text-xs font-medium uppercase tracking-wider text-gray-500">ETA</p>
        <p class="mt-1 text-sm font-semibold text-gray-900">{{ order()?.eta ?? '—' }}</p>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p class="text-xs font-medium uppercase tracking-wider text-gray-500">Invoicing Company</p>
        @if (isReadonly()) {
          <p class="mt-1 text-sm font-semibold text-gray-900">{{ invoicingCompanyName() }}</p>
        } @else {
          <select [ngModel]="order()?.invoicingCompanyId ?? ''" (ngModelChange)="onInvoicingCompanyChange($event)"
            class="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-semibold text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white">
            <option value="">— Select —</option>
            @for (co of ownCompanies(); track co.id) {
              <option [value]="co.id">{{ co.name }}</option>
            }
          </select>
        }
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

    <!-- Comments -->
    @if (orderId()) {
      <div class="mt-6">
        <app-comments-card entityType="order" [entityId]="orderId()" />
      </div>
    }

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

    <!-- PDF Preview Modal -->
    <app-pdf-preview-modal />
  `,
})
export class OrderDetailPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);

  readonly emailModal = viewChild(SendEmailModalComponent);
  readonly pdfModal = viewChild(PdfPreviewModalComponent);

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
  readonly ownCompanies = signal<OwnCompanyDto[]>([]);

  // ─── Computed ────────────────────────────────────────────────────

  readonly clientName = computed(() => this.client()?.name ?? '—');
  readonly vesselName = computed(() => this.vessel()?.name ?? '—');
  readonly portName = computed(() => this.port()?.name ?? '—');
  readonly invoicingCompanyName = computed(() => {
    const id = this.order()?.invoicingCompanyId;
    if (!id) return '—';
    const co = this.ownCompanies().find((c) => c.id === id);
    return co?.name ?? '—';
  });

  readonly isReadonly = computed(() => {
    const status = this.order()?.status;
    return status === OrderStatus.Paid || status === OrderStatus.Cancelled;
  });

  readonly supplierDropdownOptions = computed<DropdownOption[]>(() =>
    this.suppliers().map((s) => ({ value: s.id, label: s.name })),
  );

  constructor() {
    this.loadOwnCompanies();
  }

  ngOnInit(): void {
    this.loadOrder();
  }

  private async loadOwnCompanies(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<OwnCompanyDto[]>>(`${API_URL}/companies/own`),
      );
      if (res.success) this.ownCompanies.set(res.data);
    } catch {
      // silently ignore — dropdown will just be empty
    }
  }

  private async loadOrder(): Promise<void> {
    const id = this.orderId();
    if (!id) return;

    try {
      const [orderRes, ownRes] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<any>>(`${API_URL}/orders/${id}`)),
        firstValueFrom(this.http.get<ApiResponse<OwnCompanyDto[]>>(`${API_URL}/companies/own`)),
      ]);

      if (orderRes.success && orderRes.data) {
        const d = orderRes.data;
        this.order.set({
          id: d.id,
          orderNumber: d.orderNumber ?? null,
          tenantId: d.tenantId,
          clientId: d.clientId,
          vesselId: d.vesselId,
          placeId: d.placeId,
          salesRepId: d.salesRepId,
          invoicingCompanyId: d.invoicingCompanyId,
          currency: d.currency ?? 'USD',
          status: d.status,
          eta: d.eta,
          etd: d.etd,
          lossReason: d.lossReason,
          closedAt: d.closedAt,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        });

        if (d.client) this.client.set(d.client);
        if (d.vessel) this.vessel.set(d.vessel);
        if (d.place) this.port.set(d.place);

        this.itemRows.set(
          (d.items ?? []).map((item: any) => ({
            id: item.id,
            productType: item.productType ?? '',
            supplierId: item.supplierId ?? '',
            quantity: parseFloat(item.quantity) || 0,
            quantityMin: item.quantityMin ? parseFloat(item.quantityMin) : null,
            quantityMax: item.quantityMax ? parseFloat(item.quantityMax) : null,
            unit: item.unit ?? 'MT',
            costPrice: parseFloat(item.costPrice) || 0,
            salesPrice: parseFloat(item.salesPrice) || 0,
            profit: parseFloat(item.profit) || 0,
            paymentTerms: item.paymentTerms ?? '',
          })),
        );

        await this.loadReferenceData();
      }

      if (ownRes.success) this.ownCompanies.set(ownRes.data);
    } catch {
      this.showToast('error', 'Failed to load order.');
    }
  }

  private async loadReferenceData(): Promise<void> {
    try {
      const suppliersRes = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
          `${API_URL}/companies/local?limit=100`,
        ),
      );
      if (suppliersRes.success) this.suppliers.set(suppliersRes.data.companies);
    } catch {
      // silently ignore
    }
  }

  // ─── Item grid events ────────────────────────────────────────────

  onItemsChange(items: OrderItemRow[]): void {
    this.itemRows.set(items);
  }

  onInvoicingCompanyChange(companyId: string): void {
    this.order.update((o) => o ? { ...o, invoicingCompanyId: companyId || null } : o);
  }

  // ─── Actions ─────────────────────────────────────────────────────

  onAction(action: HeaderAction): void {
    switch (action) {
      case 'generate-invoice':
        this.viewInvoicePdf();
        break;
      case 'view-offer':
        this.viewOfferPdf();
        break;
      case 'view-proforma':
        this.viewProformaPdf();
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
    const id = this.orderId();
    const o = this.order();
    if (!id || !o) return;

    this.saving.set(true);
    try {
      await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}`, {
          invoicingCompanyId: o.invoicingCompanyId,
          eta: o.eta,
          etd: o.etd,
        }),
      );

      const itemPayload = this.itemRows().map((r) => ({
        productType: r.productType,
        quantity: String(r.quantity),
        quantityMin: r.quantityMin != null ? String(r.quantityMin) : null,
        quantityMax: String(r.quantityMax ?? r.quantity),
        unit: r.unit,
        supplierId: r.supplierId || null,
        costPrice: r.costPrice ? String(r.costPrice) : null,
        salesPrice: r.salesPrice ? String(r.salesPrice) : null,
        paymentTerms: r.paymentTerms || null,
      }));

      await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}/items`, { items: itemPayload }),
      );

      this.showToast('success', 'Order saved successfully.');
    } catch {
      this.showToast('error', 'Failed to save order.');
    } finally {
      this.saving.set(false);
    }
  }

  private async viewInvoicePdf(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    const modal = this.pdfModal();
    if (!modal) return;
    modal.showLoading('Invoice');
    try {
      const blob = await firstValueFrom(
        this.http.get(`${API_URL}/orders/${id}/invoice/pdf`, { responseType: 'blob' }),
      );
      modal.setBlob(blob, `Fueld_Invoice_${this.invoiceNumber()}.pdf`);
    } catch {
      modal.showError();
      this.showToast('error', 'Failed to generate invoice PDF.');
    }
  }

  private async viewOfferPdf(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    const modal = this.pdfModal();
    if (!modal) return;
    modal.showLoading('Offer');
    try {
      const blob = await firstValueFrom(
        this.http.get(`${API_URL}/orders/${id}/offer/pdf`, { responseType: 'blob' }),
      );
      modal.setBlob(blob, `Offer_${this.order()?.orderNumber ?? id}.pdf`);
    } catch {
      modal.showError();
      this.showToast('error', 'Failed to generate offer PDF.');
    }
  }

  private async viewProformaPdf(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    const modal = this.pdfModal();
    if (!modal) return;
    modal.showLoading('Proforma Invoice');
    try {
      const blob = await firstValueFrom(
        this.http.get(`${API_URL}/orders/${id}/proforma/pdf`, { responseType: 'blob' }),
      );
      modal.setBlob(blob, `Proforma_${this.order()?.orderNumber ?? id}.pdf`);
    } catch {
      modal.showError();
      this.showToast('error', 'Failed to generate proforma invoice PDF.');
    }
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
