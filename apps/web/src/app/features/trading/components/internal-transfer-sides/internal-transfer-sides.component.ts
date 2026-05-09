// ═══════════════════════════════════════════════════════════════════════
//  Internal Transfer Sides editor.
//
//  Renders the two financial sides (SOURCE_SELL + DESTINATION_BUY) of an
//  internal-transfer order. Each side has its own DRAFT/FINALIZED lifecycle;
//  finance documents for that side are blocked until it is FINALIZED.
//
//  Endpoints used (parent supplies the order id):
//    GET    /transfers/:orderId/sides
//    PATCH  /transfers/:orderId/sides/:sideId
//    POST   /transfers/:orderId/sides/:sideId/finalize
//    POST   /transfers/:orderId/sides/:sideId/reopen
// ═══════════════════════════════════════════════════════════════════════

import {
  Component,
  ChangeDetectionStrategy,
  signal,
  input,
  effect,
  inject,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import type {
  ApiResponse,
  OrderTransferSideDto,
  PaymentTermType,
} from '@fueld/types';

import { API_URL } from '@app/core/config/api';

@Component({
  selector: 'app-internal-transfer-sides',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div class="mb-4 flex items-center justify-between">
        <div>
          <h3 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-700">
            Transfer Sides
          </h3>
          <p class="mt-0.5 text-xs text-gray-500">
            Finalize each side before generating its internal documents.
          </p>
        </div>
        <button
          (click)="reload()"
          [disabled]="loading()"
          class="rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      @if (loading()) {
        <div class="py-6 text-center text-sm text-gray-400">Loading…</div>
      } @else if (sides().length === 0) {
        <div class="py-6 text-center text-sm text-gray-400">No transfer sides yet.</div>
      } @else {
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          @for (s of sides(); track s.id) {
            <div class="rounded-xl border p-4"
              [class.border-emerald-300]="s.status === 'FINALIZED'"
              [class.bg-emerald-50/40]="s.status === 'FINALIZED'"
              [class.border-gray-200]="s.status === 'DRAFT'"
            >
              <div class="mb-3 flex items-start justify-between">
                <div>
                  <p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    {{ s.kind === 'SOURCE_SELL' ? 'Source · sell' : 'Destination · buy' }}
                  </p>
                  <p class="mt-1 text-sm font-semibold text-gray-900">{{ s.companyName }}</p>
                </div>
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                  [class]="s.status === 'FINALIZED'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-gray-100 text-gray-600'"
                >
                  {{ s.status }}
                </span>
              </div>

              <div class="space-y-2 text-xs">
                <label class="block">
                  <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500">Currency</span>
                  <input
                    type="text"
                    [ngModel]="s.currency"
                    (ngModelChange)="updateField(s, 'currency', $event)"
                    [disabled]="s.status === 'FINALIZED' || readonly()"
                    class="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 disabled:opacity-60"
                  />
                </label>

                <label class="block">
                  <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500">Payment terms</span>
                  <select
                    [ngModel]="s.paymentTermType ?? ''"
                    (ngModelChange)="updateField(s, 'paymentTermType', ($event || null))"
                    [disabled]="s.status === 'FINALIZED' || readonly()"
                    class="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 disabled:opacity-60"
                  >
                    <option value="">— Not set —</option>
                    <option value="CREDIT">Credit</option>
                    <option value="COD">Cash on delivery</option>
                    <option value="PREPAY">Cash in advance</option>
                  </select>
                </label>

                @if (s.paymentTermType === 'CREDIT') {
                  <label class="block">
                    <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500">Credit days</span>
                    <input
                      type="number"
                      min="0"
                      [ngModel]="s.creditDays ?? ''"
                      (ngModelChange)="updateField(s, 'creditDays', $event === '' ? null : Number($event))"
                      [disabled]="s.status === 'FINALIZED' || readonly()"
                      class="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 disabled:opacity-60"
                    />
                  </label>
                }

                <label class="block">
                  <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500">Note</span>
                  <textarea
                    rows="2"
                    [ngModel]="s.note ?? ''"
                    (ngModelChange)="updateField(s, 'note', $event || null)"
                    [disabled]="s.status === 'FINALIZED' || readonly()"
                    class="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 disabled:opacity-60"
                  ></textarea>
                </label>

                @if (s.status === 'FINALIZED' && s.finalizedAt) {
                  <p class="text-[11px] text-gray-500">
                    Finalized {{ s.finalizedAt | date:'short' }}
                    @if (s.finalizedByName) { · {{ s.finalizedByName }} }
                  </p>
                }
              </div>

              @if (!readonly()) {
                <div class="mt-3 flex justify-end gap-2">
                  @if (s.status === 'DRAFT') {
                    <button
                      (click)="finalize(s)"
                      [disabled]="!canFinalize(s) || acting() === s.id"
                      class="inline-flex items-center rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      Finalize
                    </button>
                  } @else {
                    <button
                      (click)="reopen(s)"
                      [disabled]="acting() === s.id"
                      class="inline-flex items-center rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                    >
                      Reopen
                    </button>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class InternalTransferSidesComponent {
  private readonly http = inject(HttpClient);

  readonly orderId = input<string>('');
  readonly readonly = input(false);

  readonly sides = signal<OrderTransferSideDto[]>([]);
  readonly loading = signal(false);
  readonly acting = signal<string | null>(null);
  readonly Number = Number;

  // Re-fetch sides whenever the orderId changes.
  private readonly _onOrderId = effect(() => {
    const id = this.orderId();
    if (!id) {
      this.sides.set([]);
      return;
    }
    void this.reload();
  });

  async reload(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<OrderTransferSideDto[]>>(`${API_URL}/transfers/${id}/sides`),
      );
      if (res.success) this.sides.set(res.data);
    } finally {
      this.loading.set(false);
    }
  }

  canFinalize(side: OrderTransferSideDto): boolean {
    if (side.status === 'FINALIZED') return false;
    if (!side.invoicingCompanyId) return true; // server has invoicing pre-seeded; UI doesn't expose it yet.
    return Boolean(side.paymentTermType);
  }

  async updateField<K extends keyof OrderTransferSideDto>(
    side: OrderTransferSideDto,
    field: K,
    value: OrderTransferSideDto[K] | null,
  ): Promise<void> {
    if (side.status === 'FINALIZED') return;
    const orderId = this.orderId();
    if (!orderId) return;

    // Optimistic local update.
    this.sides.update((arr) => arr.map((s) => (s.id === side.id ? { ...s, [field]: value } : s)));

    const body: Partial<Record<K, OrderTransferSideDto[K] | null>> = { [field]: value } as Partial<Record<K, OrderTransferSideDto[K] | null>>;
    await firstValueFrom(
      this.http.patch<ApiResponse<OrderTransferSideDto>>(
        `${API_URL}/transfers/${orderId}/sides/${side.id}`,
        body,
      ),
    );
  }

  async finalize(side: OrderTransferSideDto): Promise<void> {
    const orderId = this.orderId();
    if (!orderId) return;
    this.acting.set(side.id);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<OrderTransferSideDto>>(
          `${API_URL}/transfers/${orderId}/sides/${side.id}/finalize`,
          {},
        ),
      );
      if (res.success) await this.reload();
      else if (res.message) alert(res.message);
    } finally {
      this.acting.set(null);
    }
  }

  async reopen(side: OrderTransferSideDto): Promise<void> {
    const orderId = this.orderId();
    if (!orderId) return;
    this.acting.set(side.id);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<OrderTransferSideDto>>(
          `${API_URL}/transfers/${orderId}/sides/${side.id}/reopen`,
          {},
        ),
      );
      if (res.success) await this.reload();
    } finally {
      this.acting.set(null);
    }
  }
}
