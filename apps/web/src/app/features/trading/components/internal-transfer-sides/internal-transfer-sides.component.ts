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
    <div class="rounded-2xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
      <div class="mb-4 flex items-center justify-between">
        <div>
          <h3 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-700 dark:text-ink-dim">
            Transfer Sides
          </h3>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-muted">
            Finalize each side before generating its internal documents.
          </p>
        </div>
        <button
          (click)="reload()"
          [disabled]="loading()"
          class="rounded-md border border-gray-200 dark:border-line px-2.5 py-1 text-xs text-gray-600 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint"
        >
          Refresh
        </button>
      </div>

      @if (loading()) {
        <div class="py-6 text-center text-sm text-gray-400 dark:text-muted">Loading…</div>
      } @else if (sides().length === 0) {
        <div class="py-6 text-center text-sm text-gray-400 dark:text-muted">No transfer sides yet.</div>
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
                  <p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-muted">
                    {{ s.kind === 'SOURCE_SELL' ? 'Source · sell' : 'Destination · buy' }}
                  </p>
                  <p class="mt-1 text-sm font-semibold text-gray-900 dark:text-ink">{{ s.companyName }}</p>
                </div>
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                  [class]="s.status === 'FINALIZED'
                    ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                    : 'bg-gray-100 dark:bg-surface-3 text-gray-600 dark:text-ink-dim'"
                >
                  {{ s.status }}
                </span>
              </div>

              <div class="space-y-2 text-xs">
                <label class="block">
                  <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-muted">Currency</span>
                  <input
                    type="text"
                    [ngModel]="s.currency"
                    (ngModelChange)="updateField(s, 'currency', $event)"
                    [disabled]="s.status === 'FINALIZED' || readonly()"
                    class="mt-0.5 w-full rounded-md border border-gray-300 dark:border-line-strong px-2 py-1 disabled:opacity-60"
                  />
                </label>

                <label class="block">
                  <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-muted">Payment terms</span>
                  <select
                    [ngModel]="s.paymentTermType ?? ''"
                    (ngModelChange)="updateField(s, 'paymentTermType', ($event || null))"
                    [disabled]="s.status === 'FINALIZED' || readonly()"
                    class="fueld-select-no-chevron mt-0.5 w-full appearance-none rounded-md border border-gray-300 dark:border-line-strong px-2 py-1 disabled:opacity-60"
                  >
                    <option value="">— Not set —</option>
                    <option value="CREDIT">Credit</option>
                    <option value="COD">Cash on delivery</option>
                    <option value="PREPAY">Cash in advance</option>
                  </select>
                </label>

                @if (s.paymentTermType === 'CREDIT') {
                  <label class="block">
                    <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-muted">Credit days</span>
                    <input
                      type="number"
                      min="0"
                      [ngModel]="s.creditDays ?? ''"
                      (ngModelChange)="updateField(s, 'creditDays', $event === '' ? null : Number($event))"
                      [disabled]="s.status === 'FINALIZED' || readonly()"
                      class="mt-0.5 w-full rounded-md border border-gray-300 dark:border-line-strong px-2 py-1 disabled:opacity-60"
                    />
                  </label>
                }

                <label class="block">
                  <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-muted">Note</span>
                  <textarea
                    rows="2"
                    [ngModel]="s.note ?? ''"
                    (ngModelChange)="updateField(s, 'note', $event || null)"
                    [disabled]="s.status === 'FINALIZED' || readonly()"
                    class="mt-0.5 w-full rounded-md border border-gray-300 dark:border-line-strong px-2 py-1 disabled:opacity-60"
                  ></textarea>
                </label>

                @if (s.status === 'FINALIZED' && s.finalizedAt) {
                  <p class="text-[11px] text-gray-500 dark:text-muted">
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
                      class="inline-flex items-center rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                    >
                      Finalize
                    </button>
                  } @else {
                    <button
                      (click)="reopen(s)"
                      [disabled]="acting() === s.id"
                      class="inline-flex items-center rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20 disabled:opacity-50"
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

    const previousValue = side[field];

    // Optimistic local update.
    this.sides.update((arr) => arr.map((s) => (s.id === side.id ? { ...s, [field]: value } : s)));

    const body: Partial<Record<K, OrderTransferSideDto[K] | null>> = { [field]: value } as Partial<Record<K, OrderTransferSideDto[K] | null>>;
    try {
      await firstValueFrom(
        this.http.patch<ApiResponse<OrderTransferSideDto>>(
          `${API_URL}/transfers/${orderId}/sides/${side.id}`,
          body,
        ),
      );
    } catch {
      // Revert optimistic update on failure
      this.sides.update((arr) => arr.map((s) => (s.id === side.id ? { ...s, [field]: previousValue } : s)));
    }
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
    } catch {
      // Finalize failed — keep current state, let reload sync if needed
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
    } catch {
      // Reopen failed — keep current state
    } finally {
      this.acting.set(null);
    }
  }
}
