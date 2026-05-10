// ═══════════════════════════════════════════════════════════════════════
//  Admin · Warehouses & Inventory SKUs
//
//  Two side-by-side cards:
//    • Warehouses — owner company, vessel link, inventory_enabled toggle
//    • Inventory SKUs — productType + grade + display name
//
//  Inventory rules only apply when:
//    1) the owner company has physical_ops_enabled = true
//    2) the warehouse has inventory_enabled = true
//    3) the SKU has inventory_tracked = true
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
import { firstValueFrom } from 'rxjs';
import type {
  ApiResponse,
  CreateInventorySkuDto,
  CreateWarehouseDto,
  InventorySkuDto,
  OwnCompanyDto,
  ProductType,
  UnitSettingsDto,
  VesselDto,
  WarehouseDto,
} from '@fueld/types';
import {
  SearchableDropdownComponent,
  type DropdownOption,
} from '@app/shared/components/searchable-dropdown/searchable-dropdown.component';

import { API } from '@app/core/config/api';

const PRODUCT_TYPES: ProductType[] = [
  'VLSFO', 'LSMGO', 'MGO', 'LUBE', 'IFO380CST', 'IFO180CST', 'IFO120CST',
  'IFO30CST', 'IFO', 'MDO', 'LSIFO', 'CUTTERSTOCK', 'PYGAS', 'BARGING_FEE',
] as ProductType[];

@Component({
  selector: 'app-warehouses-admin-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SearchableDropdownComponent],
  template: `
    <div>
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900">Warehouses & Inventory SKUs</h1>
        <p class="mt-1 text-sm text-gray-500">
          Configure physical operations: enable companies for inventory, register warehouses,
          and manage tracked product/grade SKUs.
        </p>
      </div>

      <!-- Own companies — physical ops toggle -->
      <section class="mb-8">
        <h2 class="text-base font-semibold text-gray-900 mb-3">Physical-ops enabled companies</h2>
        @if (ownCompaniesLoading()) {
          <p class="text-sm text-gray-500">Loading…</p>
        } @else {
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
            <table class="min-w-full text-sm">
              <thead class="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th class="px-4 py-3 text-left">Company</th>
                  <th class="px-4 py-3 text-left">Country</th>
                  <th class="px-4 py-3 text-right">Physical operations</th>
                </tr>
              </thead>
              <tbody>
                @for (c of ownCompanies(); track c.id) {
                  <tr class="border-t border-gray-100">
                    <td class="px-4 py-3 font-medium text-gray-900">{{ c.name }}</td>
                    <td class="px-4 py-3 text-gray-600">{{ c.country ?? '—' }}</td>
                    <td class="px-4 py-3 text-right">
                      <button
                        (click)="togglePhysicalOps(c.id, !isPhysicalOpsEnabled(c.id))"
                        class="inline-flex items-center gap-2 rounded-lg px-3 py-1 text-xs font-semibold transition-colors"
                        [class]="isPhysicalOpsEnabled(c.id)
                          ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
                      >
                        <span class="inline-block h-2 w-2 rounded-full"
                          [class]="isPhysicalOpsEnabled(c.id) ? 'bg-emerald-500' : 'bg-gray-400'"></span>
                        {{ isPhysicalOpsEnabled(c.id) ? 'Enabled' : 'Disabled' }}
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <!-- Warehouses -->
      <section class="mb-8">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-base font-semibold text-gray-900">Warehouses</h2>
          <button
            (click)="openWarehouseForm()"
            class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
          >
            + Add warehouse
          </button>
        </div>

        @if (warehousesLoading()) {
          <p class="text-sm text-gray-500">Loading…</p>
        } @else if (warehouses().length === 0) {
          <div class="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center text-sm text-gray-500">
            No warehouses yet. Add your first one to start tracking stock.
          </div>
        } @else {
          <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table class="min-w-full text-sm">
              <thead class="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th class="px-4 py-3 text-left">Name</th>
                  <th class="px-4 py-3 text-left">Owner</th>
                  <th class="px-4 py-3 text-left">Vessel</th>
                  <th class="px-4 py-3 text-left">Type</th>
                  <th class="px-4 py-3 text-center">Inventory</th>
                  <th class="px-4 py-3 text-center">Manual replenish</th>
                  <th class="px-4 py-3 text-center">Active</th>
                </tr>
              </thead>
              <tbody>
                @for (w of warehouses(); track w.id) {
                  <tr class="border-t border-gray-100">
                    <td class="px-4 py-3 font-medium text-gray-900">{{ w.name }}</td>
                    <td class="px-4 py-3 text-gray-600">{{ w.ownerCompanyName }}</td>
                    <td class="px-4 py-3 text-gray-600">{{ w.vesselName ?? '—' }}</td>
                    <td class="px-4 py-3 text-gray-600">{{ w.type }}</td>
                    <td class="px-4 py-3 text-center">
                      <button
                        (click)="updateWarehouseFlag(w.id, 'inventoryEnabled', !w.inventoryEnabled)"
                        class="inline-flex h-5 w-9 items-center rounded-full transition-colors"
                        [class]="w.inventoryEnabled ? 'bg-emerald-500' : 'bg-gray-300'"
                      >
                        <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                          [class]="w.inventoryEnabled ? 'translate-x-4' : 'translate-x-0.5'"></span>
                      </button>
                    </td>
                    <td class="px-4 py-3 text-center">
                      <button
                        (click)="updateWarehouseFlag(w.id, 'allowManualReplenishment', !w.allowManualReplenishment)"
                        class="inline-flex h-5 w-9 items-center rounded-full transition-colors"
                        [class]="w.allowManualReplenishment ? 'bg-emerald-500' : 'bg-gray-300'"
                      >
                        <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                          [class]="w.allowManualReplenishment ? 'translate-x-4' : 'translate-x-0.5'"></span>
                      </button>
                    </td>
                    <td class="px-4 py-3 text-center">
                      <button
                        (click)="updateWarehouseFlag(w.id, 'active', !w.active)"
                        class="inline-flex h-5 w-9 items-center rounded-full transition-colors"
                        [class]="w.active ? 'bg-emerald-500' : 'bg-gray-300'"
                      >
                        <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                          [class]="w.active ? 'translate-x-4' : 'translate-x-0.5'"></span>
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <!-- Inventory SKUs -->
      <section>
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-base font-semibold text-gray-900">Inventory SKUs</h2>
          <button
            (click)="openSkuForm()"
            class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
          >
            + Add SKU
          </button>
        </div>

        @if (skusLoading()) {
          <p class="text-sm text-gray-500">Loading…</p>
        } @else if (skus().length === 0) {
          <div class="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center text-sm text-gray-500">
            No SKUs yet. Add a tracked product/grade combination to start.
          </div>
        } @else {
          <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table class="min-w-full text-sm">
              <thead class="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th class="px-4 py-3 text-left">Display name</th>
                  <th class="px-4 py-3 text-left">Product</th>
                  <th class="px-4 py-3 text-left">Grade</th>
                  <th class="px-4 py-3 text-left">Base unit</th>
                  <th class="px-4 py-3 text-center">Tracked</th>
                  <th class="px-4 py-3 text-center">Active</th>
                </tr>
              </thead>
              <tbody>
                @for (s of skus(); track s.id) {
                  <tr class="border-t border-gray-100">
                    <td class="px-4 py-3 font-medium text-gray-900">{{ s.displayName }}</td>
                    <td class="px-4 py-3 text-gray-600">{{ s.productType }}</td>
                    <td class="px-4 py-3 text-gray-600">{{ s.grade ?? '—' }}</td>
                    <td class="px-4 py-3 text-gray-600">{{ s.baseUnit }}</td>
                    <td class="px-4 py-3 text-center">
                      <button
                        (click)="updateSkuFlag(s.id, 'inventoryTracked', !s.inventoryTracked)"
                        class="inline-flex h-5 w-9 items-center rounded-full transition-colors"
                        [class]="s.inventoryTracked ? 'bg-emerald-500' : 'bg-gray-300'"
                      >
                        <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                          [class]="s.inventoryTracked ? 'translate-x-4' : 'translate-x-0.5'"></span>
                      </button>
                    </td>
                    <td class="px-4 py-3 text-center">
                      <button
                        (click)="updateSkuFlag(s.id, 'active', !s.active)"
                        class="inline-flex h-5 w-9 items-center rounded-full transition-colors"
                        [class]="s.active ? 'bg-emerald-500' : 'bg-gray-300'"
                      >
                        <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                          [class]="s.active ? 'translate-x-4' : 'translate-x-0.5'"></span>
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <!-- Warehouse modal -->
      @if (showWarehouseForm()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">New warehouse</h3>
            <div class="space-y-3">
              <label class="block">
                <span class="text-xs font-medium text-gray-600">Owner company</span>
                <select [ngModel]="newWarehouse.ownerCompanyId" (ngModelChange)="newWarehouse.ownerCompanyId = $event"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="">Select…</option>
                  @for (c of physicalOpsCompanies(); track c.id) {
                    <option [value]="c.id">{{ c.name }}</option>
                  }
                </select>
              </label>
              <label class="block">
                <span class="text-xs font-medium text-gray-600">Type</span>
                <select [(ngModel)]="newWarehouse.type" (ngModelChange)="onTypeChange()"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="VESSEL">Vessel</option>
                  <option value="TERMINAL">Terminal</option>
                  <option value="SHORE_TANK">Shore tank</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              @if (newWarehouse.type === 'VESSEL') {
                <label class="block">
                  <span class="text-xs font-medium text-gray-600">Vessel</span>
                  <app-searchable-dropdown
                    class="mt-1 block"
                    [options]="vesselDropdownOptions()"
                    [selected]="newWarehouse.vesselId ?? ''"
                    [asyncSearch]="true"
                    [loading]="vesselSearchLoading()"
                    [clearable]="true"
                    placeholder="Search vessels by name or IMO…"
                    (searchChange)="searchVessels($event)"
                    (selectionChange)="onVesselSelected($event)"
                  />
                </label>
              } @else {
                <label class="block">
                  <span class="text-xs font-medium text-gray-600">Name</span>
                  <input [(ngModel)]="newWarehouse.name" placeholder="e.g. Rotterdam Terminal"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </label>
              }
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" [(ngModel)]="newWarehouse.inventoryEnabled" />
                <span>Inventory-enabled (rules apply at confirmation)</span>
              </label>
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" [(ngModel)]="newWarehouse.allowManualReplenishment" />
                <span>Allow manual replenishment plans</span>
              </label>
            </div>
            <div class="mt-5 flex justify-end gap-2">
              <button (click)="closeWarehouseForm()" class="rounded-lg border border-gray-200 px-3 py-1.5 text-sm">
                Cancel
              </button>
              <button (click)="submitWarehouse()" [disabled]="!canSubmitWarehouse() || warehouseSubmitting()"
                class="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                {{ warehouseSubmitting() ? 'Creating…' : 'Create' }}
              </button>
            </div>
          </div>
        </div>
      }

      <!-- SKU modal -->
      @if (showSkuForm()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">New inventory SKU</h3>
            <div class="space-y-3">
              <label class="block">
                <span class="text-xs font-medium text-gray-600">Product</span>
                <select [(ngModel)]="newSku.productType"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  @for (p of productTypes; track p) {
                    <option [value]="p">{{ p }}</option>
                  }
                </select>
              </label>
              <label class="block">
                <span class="text-xs font-medium text-gray-600">Grade (optional)</span>
                <input [(ngModel)]="newSku.grade" placeholder="e.g. RMG 380, 0.10% S"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <label class="block">
                <span class="text-xs font-medium text-gray-600">Display name</span>
                <input [(ngModel)]="newSku.displayName" placeholder="e.g. VLSFO RMG 380 0.5%"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <label class="block">
                <span class="text-xs font-medium text-gray-600">Base unit</span>
                <select [(ngModel)]="newSku.baseUnit" [disabled]="configuredUnits().length === 0"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400">
                  @if (configuredUnits().length === 0) {
                    <option value="">No units configured</option>
                  } @else {
                    @for (unit of configuredUnits(); track unit) {
                      <option [value]="unit">{{ unit }}</option>
                    }
                  }
                </select>
              </label>
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" [(ngModel)]="newSku.inventoryTracked" />
                <span>Track inventory for this SKU</span>
              </label>
            </div>
            <div class="mt-5 flex justify-end gap-2">
              <button (click)="closeSkuForm()" class="rounded-lg border border-gray-200 px-3 py-1.5 text-sm">
                Cancel
              </button>
              <button (click)="submitSku()" [disabled]="!canSubmitSku()"
                class="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                Create
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class WarehousesAdminPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  readonly productTypes = PRODUCT_TYPES;

  readonly ownCompanies = signal<OwnCompanyDto[]>([]);
  readonly ownCompaniesLoading = signal(true);
  readonly warehouses = signal<WarehouseDto[]>([]);
  readonly warehousesLoading = signal(true);
  readonly skus = signal<InventorySkuDto[]>([]);
  readonly skusLoading = signal(true);
  readonly configuredUnits = signal<string[]>([]);
  readonly vessels = signal<VesselDto[]>([]);
  // Companies that are physical-ops eligible (cached locally to avoid an extra trip).
  readonly companyPhysicalOpsState = signal<Record<string, boolean>>({});

  readonly physicalOpsCompanies = computed(() => {
    const state = this.companyPhysicalOpsState();
    return this.ownCompanies().filter((c) => state[c.id]);
  });

  readonly showWarehouseForm = signal(false);
  readonly showSkuForm = signal(false);
  readonly vesselSearchLoading = signal(false);
  readonly warehouseSubmitting = signal(false);

  /** Async vessel results for the warehouse typeahead. */
  readonly vesselDropdownOptions = computed<DropdownOption[]>(() =>
    this.vessels().map((v) => ({
      value: v.id,
      label: v.imo ? `${v.name} · IMO ${v.imo}` : v.name,
    })),
  );

  newWarehouse: CreateWarehouseDto & { vesselId: string | null } = {
    ownerCompanyId: '',
    name: '',
    type: 'VESSEL',
    vesselId: null,
    inventoryEnabled: true,
    allowManualReplenishment: true,
  };

  newSku: CreateInventorySkuDto = {
    productType: 'VLSFO' as ProductType,
    grade: '',
    displayName: '',
    baseUnit: 'MT',
    inventoryTracked: true,
  };

  ngOnInit(): void {
    void this.loadAll();
  }

  isPhysicalOpsEnabled(companyId: string): boolean {
    return Boolean(this.companyPhysicalOpsState()[companyId]);
  }

  async loadAll(): Promise<void> {
    await Promise.all([this.loadOwnCompanies(), this.loadWarehouses(), this.loadSkus(), this.loadUnits()]);
  }

  private async loadOwnCompanies(): Promise<void> {
    this.ownCompaniesLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<OwnCompanyDto[]>>(`${API}/admin/settings/own-companies`),
      );
      if (res.success) {
        this.ownCompanies.set(res.data);
        // Fetch each company's physical-ops state via the public companies/local/:id endpoint.
        const states: Record<string, boolean> = {};
        await Promise.all(res.data.map(async (c) => {
          const detail = await firstValueFrom(
            this.http.get<ApiResponse<{ physicalOpsEnabled?: boolean }>>(`${API}/companies/local/${c.id}`),
          );
          states[c.id] = Boolean(detail?.data?.physicalOpsEnabled);
        }));
        this.companyPhysicalOpsState.set(states);
      }
    } finally {
      this.ownCompaniesLoading.set(false);
    }
  }

  private async loadWarehouses(): Promise<void> {
    this.warehousesLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<WarehouseDto[]>>(`${API}/inventory/warehouses`),
      );
      if (res.success) this.warehouses.set(res.data);
    } finally {
      this.warehousesLoading.set(false);
    }
  }

  private async loadSkus(): Promise<void> {
    this.skusLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<InventorySkuDto[]>>(`${API}/inventory/skus`),
      );
      if (res.success) this.skus.set(res.data);
    } finally {
      this.skusLoading.set(false);
    }
  }

  private async loadUnits(): Promise<void> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<UnitSettingsDto>>(`${API}/admin/settings/units`),
    );
    if (!res.success) return;
    this.configuredUnits.set(res.data.units);
    const currentBaseUnit = this.newSku.baseUnit ?? '';
    if (!res.data.units.includes(currentBaseUnit)) {
      this.newSku = { ...this.newSku, baseUnit: this.getDefaultBaseUnit() };
    }
  }

  async searchVessels(term: string): Promise<void> {
    this.vesselSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ vessels: VesselDto[]; total: number }>>(
          `${API}/vessels/local?search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      if (res.success) {
        this.vessels.set(res.data.vessels);
      }
    } finally {
      this.vesselSearchLoading.set(false);
    }
  }

  async togglePhysicalOps(companyId: string, enabled: boolean): Promise<void> {
    await firstValueFrom(
      this.http.put<ApiResponse<unknown>>(
        `${API}/admin/settings/own-companies/${companyId}/physical-ops`,
        { enabled },
      ),
    );
    this.companyPhysicalOpsState.update((s) => ({ ...s, [companyId]: enabled }));
  }

  openWarehouseForm(): void {
    this.newWarehouse = {
      ownerCompanyId: '',
      name: '',
      type: 'VESSEL',
      vesselId: null,
      inventoryEnabled: true,
      allowManualReplenishment: true,
    };
    this.vessels.set([]);
    this.showWarehouseForm.set(true);
  }

  closeWarehouseForm(): void {
    this.showWarehouseForm.set(false);
  }

  onTypeChange(): void {
    if (this.newWarehouse.type !== 'VESSEL') {
      this.newWarehouse.vesselId = null;
      this.newWarehouse.name = '';
      return;
    }
    // Reset name until a vessel is selected; it will be inferred from the vessel.
    this.newWarehouse.name = '';
  }

  onVesselSelected(vesselId: string): void {
    this.newWarehouse.vesselId = vesselId || null;
    const selected = this.vessels().find((v) => v.id === vesselId);
    // Name is derived from the vessel to avoid mismatches.
    this.newWarehouse.name = selected?.name ?? '';
  }

  canSubmitWarehouse(): boolean {
    if (!this.newWarehouse.ownerCompanyId) return false;
    if (this.newWarehouse.type === 'VESSEL') {
      return Boolean(this.newWarehouse.vesselId && this.newWarehouse.name.trim());
    }
    return Boolean(this.newWarehouse.name.trim());
  }

  async submitWarehouse(): Promise<void> {
    if (!this.canSubmitWarehouse()) return;
    this.warehouseSubmitting.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<WarehouseDto>>(`${API}/inventory/warehouses`, this.newWarehouse),
      );
      if (res.success) {
        this.showWarehouseForm.set(false);
        await this.loadWarehouses();
      } else if (res.message) {
        alert(res.message);
      }
    } finally {
      this.warehouseSubmitting.set(false);
    }
  }

  async updateWarehouseFlag(
    id: string,
    flag: 'inventoryEnabled' | 'allowManualReplenishment' | 'active',
    value: boolean,
  ): Promise<void> {
    await firstValueFrom(
      this.http.patch<ApiResponse<WarehouseDto>>(`${API}/inventory/warehouses/${id}`, { [flag]: value }),
    );
    await this.loadWarehouses();
  }

  openSkuForm(): void {
    this.newSku = {
      productType: 'VLSFO' as ProductType,
      grade: '',
      displayName: '',
      baseUnit: this.getDefaultBaseUnit(),
      inventoryTracked: true,
    };
    this.showSkuForm.set(true);
  }

  closeSkuForm(): void {
    this.showSkuForm.set(false);
  }

  canSubmitSku(): boolean {
    return Boolean(
      this.newSku.productType
      && this.newSku.displayName.trim()
      && (this.newSku.baseUnit ?? '').trim(),
    );
  }

  async submitSku(): Promise<void> {
    if (!this.canSubmitSku()) return;
    const res = await firstValueFrom(
      this.http.post<ApiResponse<InventorySkuDto>>(`${API}/inventory/skus`, this.newSku),
    );
    if (res.success) {
      this.showSkuForm.set(false);
      await this.loadSkus();
    } else if (res.message) {
      alert(res.message);
    }
  }

  async updateSkuFlag(
    id: string,
    flag: 'inventoryTracked' | 'active',
    value: boolean,
  ): Promise<void> {
    await firstValueFrom(
      this.http.patch<ApiResponse<InventorySkuDto>>(`${API}/inventory/skus/${id}`, { [flag]: value }),
    );
    await this.loadSkus();
  }

  private getDefaultBaseUnit(): string {
    return this.configuredUnits()[0] ?? 'MT';
  }
}
