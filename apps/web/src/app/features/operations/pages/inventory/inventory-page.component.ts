// ═══════════════════════════════════════════════════════════════════════
//  Operations · Inventory — stock balances by warehouse and SKU.
//
//  Pulls /inventory/overview for inventory-enabled warehouses across all
//  inventory-tracked SKUs and surfaces a focused dashboard:
//    • on-hand, reserved, available now
//    • planned inbound (replenishment + transfer-in)
//    • planned outbound (future reservations)
//    • earliest deliverable date when a warehouse is currently negative
//
//  Filters by company, vessel, and warehouse via dropdowns. The page also
//  shows pending replenishment plans and recent movements as drill-downs
//  selected via the warehouse rows.
// ═══════════════════════════════════════════════════════════════════════

import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { DateLabelPipe } from '../../../../shared/pipes/date-format.pipe';
import { firstValueFrom } from 'rxjs';
import type {
  ApiResponse,
  CounterpartyDto,
  InventoryBalanceDto,
  InventoryMovementDto,
  InventoryReplenishmentPlanDto,
  InventorySkuDto,
  WarehouseDto,
} from '@fueld/types';

import { API } from '@app/core/config/api';

@Component({
  selector: 'app-inventory-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, DateLabelPipe],
  template: `
    <div>
      <!-- Header -->
      <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Inventory</h1>
          <p class="mt-1 text-sm text-gray-500">
            Stock balances, reservations, and replenishment plans across enabled warehouses.
          </p>
        </div>
        <button
          (click)="reload()"
          class="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          [disabled]="loading()"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
          </svg>
          Refresh
        </button>
      </div>

      <!-- Filters -->
      <div class="mb-4 flex flex-wrap gap-3">
        <select
          [ngModel]="filterCompanyId()"
          (ngModelChange)="setFilterCompany($event)"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All companies</option>
          @for (c of ownCompanies(); track c.id) {
            <option [value]="c.id">{{ c.name }}</option>
          }
        </select>

        <select
          [ngModel]="filterWarehouseId()"
          (ngModelChange)="setFilterWarehouse($event)"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All warehouses</option>
          @for (w of filteredWarehouses(); track w.id) {
            <option [value]="w.id">{{ w.name }}</option>
          }
        </select>
      </div>

      <!-- Summary cards -->
      <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-2xl border border-gray-200 bg-white px-4 py-3">
          <p class="text-xs uppercase tracking-wider text-gray-400">Tracked SKUs</p>
          <p class="mt-1 text-xl font-semibold text-gray-900">{{ trackedSkuCount() }}</p>
        </div>
        <div class="rounded-2xl border border-gray-200 bg-white px-4 py-3">
          <p class="text-xs uppercase tracking-wider text-gray-400">Active warehouses</p>
          <p class="mt-1 text-xl font-semibold text-gray-900">{{ activeWarehouseCount() }}</p>
        </div>
        <div class="rounded-2xl border border-gray-200 bg-white px-4 py-3">
          <p class="text-xs uppercase tracking-wider text-gray-400">Shortages</p>
          <p class="mt-1 text-xl font-semibold" [class]="shortageCount() > 0 ? 'text-red-600' : 'text-gray-900'">
            {{ shortageCount() }}
          </p>
        </div>
        <div class="rounded-2xl border border-gray-200 bg-white px-4 py-3">
          <p class="text-xs uppercase tracking-wider text-gray-400">Pending replenishments</p>
          <p class="mt-1 text-xl font-semibold text-gray-900">{{ pendingPlanCount() }}</p>
        </div>
      </div>

      <!-- Loading -->
      @if (loading()) {
        <div class="flex items-center justify-center py-16">
          <svg class="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (filteredBalances().length === 0) {
        <div class="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
          <p class="text-sm text-gray-500">
            No inventory data yet. Enable a warehouse and add a tracked SKU under
            <strong>Admin → Warehouses</strong> to see balances here.
          </p>
        </div>
      } @else {
        <!-- Balances table -->
        <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table class="min-w-full text-sm">
            <thead class="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th class="px-4 py-3 text-left">Company</th>
                <th class="px-4 py-3 text-left">Warehouse</th>
                <th class="px-4 py-3 text-left">SKU</th>
                <th class="px-4 py-3 text-right">On hand</th>
                <th class="px-4 py-3 text-right">Reserved</th>
                <th class="px-4 py-3 text-right">Available</th>
                <th class="px-4 py-3 text-right">Planned in</th>
                <th class="px-4 py-3 text-right">Planned out</th>
                <th class="px-4 py-3 text-left">Earliest available</th>
              </tr>
            </thead>
            <tbody>
              @for (row of filteredBalances(); track row.warehouseId + ':' + row.skuId) {
                <tr class="border-t border-gray-100 hover:bg-gray-50/50">
                  <td class="px-4 py-3 text-gray-900">{{ row.ownerCompanyName }}</td>
                  <td class="px-4 py-3 text-gray-900">
                    <div class="flex flex-col">
                      <span>{{ row.warehouseName }}</span>
                      @if (row.vesselName) {
                        <span class="text-xs text-gray-400">{{ row.vesselName }}</span>
                      }
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex flex-col">
                      <span class="font-medium text-gray-900">{{ row.skuDisplayName }}</span>
                      <span class="text-xs text-gray-400">
                        {{ row.productType }}@if (row.grade) { · {{ row.grade }} }
                      </span>
                    </div>
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums">{{ formatQty(row.onHand) }} {{ row.baseUnit }}</td>
                  <td class="px-4 py-3 text-right tabular-nums text-gray-500">
                    {{ formatQty(row.reserved) }}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums font-semibold"
                    [class]="isShort(row) ? 'text-red-600' : 'text-emerald-700'">
                    {{ formatQty(row.availableNow) }}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums text-blue-700">
                    {{ formatQty(row.plannedInbound) }}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums text-amber-700">
                    {{ formatQty(row.plannedOutbound) }}
                  </td>
                  <td class="px-4 py-3 text-gray-700">
                    @if (row.earliestAvailableAt) {
                      <span class="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                        {{ row.earliestAvailableAt | dateLabel }}
                      </span>
                    } @else {
                      <span class="text-xs text-gray-400">Now</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Replenishment plans -->
        <div class="mt-8">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-base font-semibold text-gray-900">Pending replenishments</h2>
            <button
              (click)="openPlanForm()"
              class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              + Plan replenishment
            </button>
          </div>
          @if (pendingPlans().length === 0) {
            <div class="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-8 text-center text-sm text-gray-500">
              No pending replenishments.
            </div>
          } @else {
            <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
              <table class="min-w-full text-sm">
                <thead class="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <th class="px-4 py-3 text-left">Warehouse</th>
                    <th class="px-4 py-3 text-left">SKU</th>
                    <th class="px-4 py-3 text-right">Quantity</th>
                    <th class="px-4 py-3 text-left">Expected</th>
                    <th class="px-4 py-3 text-left">Status</th>
                    <th class="px-4 py-3 text-left">Order</th>
                    <th class="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of pendingPlans(); track p.id) {
                    <tr class="border-t border-gray-100">
                      <td class="px-4 py-3">{{ p.warehouseName }}</td>
                      <td class="px-4 py-3">{{ p.skuDisplayName }}</td>
                      <td class="px-4 py-3 text-right tabular-nums">{{ formatQty(p.quantity) }} {{ p.unit }}</td>
                      <td class="px-4 py-3">{{ p.expectedAt | dateLabel }}</td>
                      <td class="px-4 py-3">
                        <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                          [class]="p.status === 'PLANNED' ? 'bg-gray-100 text-gray-700' : 'bg-blue-100 text-blue-700'">
                          {{ p.status }}
                        </span>
                      </td>
                      <td class="px-4 py-3 text-gray-500">{{ p.orderNumber ?? '—' }}</td>
                      <td class="px-4 py-3 text-right">
                        <div class="flex justify-end gap-2">
                          <button
                            (click)="cancelPlan(p)"
                            [disabled]="actingPlanId() === p.id"
                            class="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      }

      <!-- Replenishment plan modal -->
      @if (showPlanForm()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">Plan replenishment</h3>
            <div class="space-y-3">
              <label class="block">
                <span class="text-xs font-medium text-gray-600">Warehouse</span>
                <select [(ngModel)]="newPlan.warehouseId"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="">Select…</option>
                  @for (w of warehouses(); track w.id) {
                    @if (w.inventoryEnabled && w.allowManualReplenishment && w.active) {
                      <option [value]="w.id">
                        {{ w.name }}@if (w.vesselName) { · {{ w.vesselName }} }
                      </option>
                    }
                  }
                </select>
              </label>
              <label class="block">
                <span class="text-xs font-medium text-gray-600">SKU</span>
                <select [(ngModel)]="newPlan.skuId"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="">Select…</option>
                  @for (s of skus(); track s.id) {
                    @if (s.inventoryTracked && s.active) {
                      <option [value]="s.id">{{ s.displayName }}</option>
                    }
                  }
                </select>
              </label>
              <div class="grid grid-cols-2 gap-3">
                <label class="block">
                  <span class="text-xs font-medium text-gray-600">Quantity</span>
                  <input type="number" min="0" step="0.001" [(ngModel)]="newPlan.quantity"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </label>
                <label class="block">
                  <span class="text-xs font-medium text-gray-600">Unit</span>
                  <input type="text" [(ngModel)]="newPlan.unit"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </label>
              </div>
              <label class="block">
                <span class="text-xs font-medium text-gray-600">Expected date</span>
                <input type="date" [(ngModel)]="newPlan.expectedAt"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <label class="block">
                <span class="text-xs font-medium text-gray-600">Note (optional)</span>
                <input type="text" [(ngModel)]="newPlan.note" placeholder="e.g. Awaiting supplier confirmation"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </label>
              @if (planFormError()) {
                <p class="text-xs text-red-600">{{ planFormError() }}</p>
              }
            </div>
            <div class="mt-5 flex justify-end gap-2">
              <button (click)="closePlanForm()" class="rounded-lg border border-gray-200 px-3 py-1.5 text-sm">
                Cancel
              </button>
              <button
                (click)="submitPlan()"
                [disabled]="!canSubmitPlan() || planSubmitting()"
                class="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {{ planSubmitting() ? 'Saving…' : 'Create plan' }}
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class InventoryPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly loading = signal(true);
  readonly balances = signal<InventoryBalanceDto[]>([]);
  readonly warehouses = signal<WarehouseDto[]>([]);
  readonly skus = signal<InventorySkuDto[]>([]);
  readonly ownCompanies = signal<CounterpartyDto[]>([]);
  readonly plans = signal<InventoryReplenishmentPlanDto[]>([]);

  readonly filterCompanyId = signal<string>('');
  readonly filterWarehouseId = signal<string>('');

  readonly filteredWarehouses = computed(() => {
    const companyId = this.filterCompanyId();
    if (!companyId) return this.warehouses();
    return this.warehouses().filter((w) => w.ownerCompanyId === companyId);
  });

  readonly filteredBalances = computed(() => {
    const companyId = this.filterCompanyId();
    const warehouseId = this.filterWarehouseId();
    return this.balances().filter((b) => {
      if (companyId && b.ownerCompanyId !== companyId) return false;
      if (warehouseId && b.warehouseId !== warehouseId) return false;
      return true;
    });
  });

  readonly trackedSkuCount = computed(
    () => this.skus().filter((s) => s.inventoryTracked && s.active).length,
  );
  readonly activeWarehouseCount = computed(
    () => this.warehouses().filter((w) => w.active && w.inventoryEnabled).length,
  );
  readonly shortageCount = computed(
    () => this.filteredBalances().filter((b) => Number(b.availableNow) < 0).length,
  );
  readonly pendingPlans = computed(() =>
    this.plans().filter((p) => p.status === 'PLANNED' || p.status === 'LINKED'),
  );
  readonly pendingPlanCount = computed(() => this.pendingPlans().length);

  ngOnInit(): void {
    void this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const [overviewRes, warehousesRes, skusRes, ownRes, plansRes] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<InventoryBalanceDto[]>>(`${API}/inventory/overview`)),
        firstValueFrom(this.http.get<ApiResponse<WarehouseDto[]>>(`${API}/inventory/warehouses`)),
        firstValueFrom(this.http.get<ApiResponse<InventorySkuDto[]>>(`${API}/inventory/skus`)),
        firstValueFrom(this.http.get<ApiResponse<CounterpartyDto[]>>(`${API}/admin/settings/own-companies`)),
        firstValueFrom(this.http.get<ApiResponse<InventoryReplenishmentPlanDto[]>>(`${API}/inventory/replenishment-plans`)),
      ]);
      if (overviewRes.success) this.balances.set(overviewRes.data);
      if (warehousesRes.success) this.warehouses.set(warehousesRes.data);
      if (skusRes.success) this.skus.set(skusRes.data);
      if (ownRes.success) this.ownCompanies.set(ownRes.data as unknown as CounterpartyDto[]);
      if (plansRes.success) this.plans.set(plansRes.data);
    } finally {
      this.loading.set(false);
    }
  }

  setFilterCompany(value: string): void {
    this.filterCompanyId.set(value);
    // Reset warehouse filter if it no longer matches the company filter.
    const wh = this.filterWarehouseId();
    if (wh) {
      const found = this.warehouses().find((w) => w.id === wh);
      if (found && value && found.ownerCompanyId !== value) {
        this.filterWarehouseId.set('');
      }
    }
  }

  setFilterWarehouse(value: string): void {
    this.filterWarehouseId.set(value);
  }

  isShort(row: InventoryBalanceDto): boolean {
    return Number(row.availableNow) < 0;
  }

  formatQty(value: string | number): string {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  }

  // ─── Replenishment plan management ───────────────────────────────
  readonly showPlanForm = signal(false);
  readonly planSubmitting = signal(false);
  readonly planFormError = signal<string | null>(null);
  readonly actingPlanId = signal<string | null>(null);

  newPlan: { warehouseId: string; skuId: string; quantity: string; unit: string; expectedAt: string; note: string } = {
    warehouseId: '',
    skuId: '',
    quantity: '',
    unit: 'MT',
    expectedAt: '',
    note: '',
  };

  openPlanForm(): void {
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    this.newPlan = {
      warehouseId: this.filterWarehouseId() || '',
      skuId: '',
      quantity: '',
      unit: 'MT',
      expectedAt: today.toISOString().slice(0, 10),
      note: '',
    };
    this.planFormError.set(null);
    this.showPlanForm.set(true);
  }

  closePlanForm(): void {
    this.showPlanForm.set(false);
    this.planFormError.set(null);
  }

  canSubmitPlan(): boolean {
    return Boolean(
      this.newPlan.warehouseId
        && this.newPlan.skuId
        && this.newPlan.quantity
        && Number(this.newPlan.quantity) > 0
        && this.newPlan.expectedAt,
    );
  }

  async submitPlan(): Promise<void> {
    if (!this.canSubmitPlan()) return;
    this.planSubmitting.set(true);
    this.planFormError.set(null);
    try {
      const expectedAt = new Date(`${this.newPlan.expectedAt}T12:00:00Z`).toISOString();
      const res = await firstValueFrom(
        this.http.post<ApiResponse<InventoryReplenishmentPlanDto>>(`${API}/inventory/replenishment-plans`, {
          warehouseId: this.newPlan.warehouseId,
          skuId: this.newPlan.skuId,
          quantity: this.newPlan.quantity,
          unit: this.newPlan.unit || 'MT',
          expectedAt,
          note: this.newPlan.note || null,
        }),
      );
      if (res.success) {
        this.showPlanForm.set(false);
        await this.reload();
      } else if (res.message) {
        this.planFormError.set(res.message);
      }
    } catch (err) {
      this.planFormError.set(err instanceof Error ? err.message : 'Failed to create plan');
    } finally {
      this.planSubmitting.set(false);
    }
  }

  async cancelPlan(plan: InventoryReplenishmentPlanDto): Promise<void> {
    if (!confirm(`Cancel replenishment plan for ${plan.skuDisplayName}?`)) return;
    this.actingPlanId.set(plan.id);
    try {
      await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(`${API}/inventory/replenishment-plans/${plan.id}/cancel`, {}),
      );
      await this.reload();
    } finally {
      this.actingPlanId.set(null);
    }
  }
}
