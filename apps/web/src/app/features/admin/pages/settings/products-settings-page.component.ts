import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse } from '@fueld/types';

import { API } from '@app/core/config/api';
import { SettingsToastService } from './settings-toast.service';

@Component({
  selector: 'app-products-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="grid grid-cols-1 gap-6 min-[900px]:grid-cols-2 min-[1600px]:grid-cols-3">

      <!-- ════════════════════════════════════════════════════════ -->
      <!--  Products                                               -->
      <!-- ════════════════════════════════════════════════════════ -->
      <div class="app-panel">
        <div class="app-panel-header app-panel-header--emerald">
          <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--emerald">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M5 2a2 2 0 00-2 2v14l3.5-2 3.5 2 3.5-2 3.5 2V4a2 2 0 00-2-2H5zm4.707 3.707a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L8.414 9H10a3 3 0 013 3v1a1 1 0 102 0v-1a5 5 0 00-5-5H8.414l1.293-1.293z" clip-rule="evenodd" />
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Products</h3>
            <p class="text-xs text-gray-500 dark:text-muted">Configure products / services with optional default description, unit, and pricing.</p>
          </div>
        </div>

        <div class="app-panel-body space-y-3 flex-1 min-h-0 overflow-y-auto">
          @for (item of catalogItems(); track $index; let i = $index) {
            <div class="space-y-2 rounded-lg border border-gray-200 dark:border-line p-3">
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  [value]="item.name"
                  (input)="updateCatalogItem(i, 'name', $any($event.target).value)"
                  placeholder="Product name"
                  class="app-input flex-1"
                />
                <div class="flex items-center gap-0.5 shrink-0">
                  <button
                    (click)="moveCatalogItem(i, -1)"
                    [disabled]="i === 0"
                    class="rounded-md p-1.5 text-gray-400 dark:text-muted hover:text-gray-700 dark:hover:text-ink hover:bg-gray-100 dark:hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    title="Move up"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M14.77 12.77a.75.75 0 01-1.06 0L10 9.06l-3.71 3.71a.75.75 0 01-1.06-1.06l4.24-4.24a.75.75 0 011.06 0l4.24 4.24a.75.75 0 010 1.06z" clip-rule="evenodd" />
                    </svg>
                  </button>
                  <button
                    (click)="moveCatalogItem(i, 1)"
                    [disabled]="i === catalogItems().length - 1"
                    class="rounded-md p-1.5 text-gray-400 dark:text-muted hover:text-gray-700 dark:hover:text-ink hover:bg-gray-100 dark:hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    title="Move down"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M5.23 7.23a.75.75 0 011.06 0L10 10.94l3.71-3.71a.75.75 0 011.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.23 8.29a.75.75 0 010-1.06z" clip-rule="evenodd" />
                    </svg>
                  </button>
                  <button
                    (click)="removeCatalogItem(i)"
                    class="rounded-md p-1.5 text-gray-400 dark:text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors shrink-0"
                    title="Remove item"
                  >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                  </svg>
                </button>
                </div>
              </div>
              <input
                type="text"
                [value]="item.description"
                (input)="updateCatalogItem(i, 'description', $any($event.target).value)"
                placeholder="Default description"
                class="app-input w-full"
              />
              <div class="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  [value]="item.defaultUnit"
                  (input)="updateCatalogItem(i, 'defaultUnit', $any($event.target).value)"
                  placeholder="Unit"
                  class="app-input"
                />
                <input
                  type="number"
                  [value]="item.defaultCostPrice"
                  (input)="updateCatalogItem(i, 'defaultCostPrice', $any($event.target).value)"
                  placeholder="Cost price"
                  class="app-input"
                />
                <input
                  type="number"
                  [value]="item.defaultSalesPrice"
                  (input)="updateCatalogItem(i, 'defaultSalesPrice', $any($event.target).value)"
                  placeholder="Sales price"
                  class="app-input"
                />
              </div>
            </div>
          }
          <button
            (click)="addCatalogItem()"
            class="app-button-add"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            Add Product
          </button>

          <div class="flex items-center gap-3 pt-2">
            <button
              (click)="saveCatalog()"
              [disabled]="catalogSaving()"
              class="app-button-primary"
            >
              @if (catalogSaving()) { Saving… } @else { Save Products }
            </button>
            @if (catalogSaved()) {
              <span class="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                </svg>
                Saved
              </span>
            }
          </div>
        </div>
      </div>

      <!-- ════════════════════════════════════════════════════════ -->
      <!--  Order Categories                                       -->
      <!-- ════════════════════════════════════════════════════════ -->
      <div class="app-panel">
        <div class="app-panel-header app-panel-header--amber">
          <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--amber">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600 dark:text-amber-400" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 5A.75.75 0 012.75 9h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 9.75zm0 5a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z" clip-rule="evenodd" />
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Order Categories</h3>
            <p class="text-xs text-gray-500 dark:text-muted">Group orders into business lines (fuels, services, environmental, etc.).</p>
          </div>
        </div>

        <div class="app-panel-body space-y-3 flex-1 min-h-0 overflow-y-auto">
          @for (cat of orderCategories(); track $index; let i = $index) {
            <div class="flex items-center gap-2">
              <input
                type="text"
                [value]="cat.key"
                (input)="updateOrderCategory(i, 'key', $any($event.target).value)"
                placeholder="Key"
                class="app-input w-24"
              />
              <input
                type="text"
                [value]="cat.label"
                (input)="updateOrderCategory(i, 'label', $any($event.target).value)"
                placeholder="Label"
                class="app-input flex-1"
              />
              <input
                type="text"
                [value]="cat.defaultUnit"
                (input)="updateOrderCategory(i, 'defaultUnit', $any($event.target).value)"
                placeholder="Unit"
                class="app-input w-20"
              />
              <button
                (click)="removeOrderCategory(i)"
                class="rounded-md p-1.5 text-gray-400 dark:text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors shrink-0"
                title="Remove category"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
              </button>
            </div>
          }
          <button
            (click)="addOrderCategory()"
            class="app-button-add"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            Add Category
          </button>

          <div class="flex items-center gap-3 pt-2">
            <button
              (click)="saveOrderCategories()"
              [disabled]="orderCategoriesSaving()"
              class="app-button-primary"
            >
              @if (orderCategoriesSaving()) { Saving… } @else { Save Categories }
            </button>
            @if (orderCategoriesSaved()) {
              <span class="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                </svg>
                Saved
              </span>
            }
          </div>
        </div>
      </div>

      <!-- ════════════════════════════════════════════════════════ -->
      <!--  Tax Rates                                              -->
      <!-- ════════════════════════════════════════════════════════ -->
      <div class="app-panel">
        <div class="app-panel-header app-panel-header--rose">
          <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--rose">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-rose-600 dark:text-rose-400" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clip-rule="evenodd" />
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Tax Rates</h3>
            <p class="text-xs text-gray-500 dark:text-muted">Configure flat tax rates per product.</p>
          </div>
        </div>

        <div class="app-panel-body space-y-3 flex-1 min-h-0 overflow-y-auto">
          @for (rate of taxRates(); track $index; let i = $index) {
            <div class="flex items-center gap-2">
              <input
                type="text"
                [value]="rate.name"
                (input)="updateTaxRate(i, 'name', $any($event.target).value)"
                placeholder="Tax name"
                class="app-input flex-1"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                [value]="rate.rate"
                (input)="updateTaxRate(i, 'rate', $any($event.target).value)"
                placeholder="Rate (0.07)"
                class="app-input w-24"
              />
              <input
                type="text"
                [value]="rate.productType"
                (input)="updateTaxRate(i, 'productType', $any($event.target).value)"
                placeholder="Product"
                class="app-input w-24"
              />
              <button
                (click)="removeTaxRate(i)"
                class="rounded-md p-1.5 text-gray-400 dark:text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors shrink-0"
                title="Remove rate"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
              </button>
            </div>
          }
          <button
            (click)="addTaxRate()"
            class="app-button-add"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            Add Tax Rate
          </button>

          <div class="flex items-center gap-3 pt-2">
            <button
              (click)="saveTaxRates()"
              [disabled]="taxRatesSaving()"
              class="app-button-primary"
            >
              @if (taxRatesSaving()) { Saving… } @else { Save Tax Rates }
            </button>
            @if (taxRatesSaved()) {
              <span class="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                </svg>
                Saved
              </span>
            }
          </div>
        </div>
      </div>

    </div>

  `,
})
export class ProductsSettingsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toastService = inject(SettingsToastService);

  // Product catalog
  readonly catalogItems = signal<{ id: string; name: string; description: string; defaultUnit: string; defaultCostPrice: string; defaultSalesPrice: string; defaultTaxRateId: string; categoryKey: string }[]>([]);
  readonly catalogSaving = signal(false);
  readonly catalogSaved = signal(false);

  // Order categories
  readonly orderCategories = signal<{ key: string; label: string; description: string; defaultUnit: string }[]>([]);
  readonly orderCategoriesSaving = signal(false);
  readonly orderCategoriesSaved = signal(false);

  // Tax rates
  readonly taxRates = signal<{ id: string; name: string; rate: string; productType: string }[]>([]);
  readonly taxRatesSaving = signal(false);
  readonly taxRatesSaved = signal(false);

  ngOnInit(): void {
    this.loadCatalog();
    this.loadOrderCategories();
    this.loadTaxRates();
  }

  // ─── Catalog settings ─────────────────────────────────────────

  private async loadCatalog(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ items: { id: string; name: string; description?: string; defaultUnit?: string; defaultCostPrice?: number; defaultSalesPrice?: number; defaultTaxRateId?: string; categoryKey?: string }[] }>>(`${API}/admin/settings/catalog`),
      );
      if (res.success) {
        this.catalogItems.set(
          (res.data.items ?? []).map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description ?? '',
            defaultUnit: item.defaultUnit ?? '',
            defaultCostPrice: item.defaultCostPrice != null ? String(item.defaultCostPrice) : '',
            defaultSalesPrice: item.defaultSalesPrice != null ? String(item.defaultSalesPrice) : '',
            defaultTaxRateId: item.defaultTaxRateId ?? '',
            categoryKey: item.categoryKey ?? '',
          })),
        );
      }
    } catch {
      // ignore
    }
  }

  addCatalogItem(): void {
    this.catalogItems.update((items) => [
      ...items,
      { id: crypto.randomUUID(), name: '', description: '', defaultUnit: '', defaultCostPrice: '', defaultSalesPrice: '', defaultTaxRateId: '', categoryKey: '' },
    ]);
  }

  moveCatalogItem(index: number, direction: -1 | 1): void {
    this.catalogItems.update((items) => {
      const target = index + direction;
      if (target < 0 || target >= items.length) return items;
      const next = [...items];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  removeCatalogItem(index: number): void {
    this.catalogItems.update((items) => items.filter((_, i) => i !== index));
  }

  updateCatalogItem(index: number, field: string, value: string): void {
    this.catalogItems.update((items) => {
      const next = [...items];
      next[index] = { ...next[index]!, [field]: value };
      return next;
    });
  }

  async saveCatalog(): Promise<void> {
    this.catalogSaving.set(true);
    this.catalogSaved.set(false);
    try {
      const payload = this.catalogItems()
        .filter((item) => item.name.trim())
        .map((item) => ({
          id: item.id,
          name: item.name.trim(),
          description: item.description.trim() || undefined,
          defaultUnit: item.defaultUnit.trim() || undefined,
          defaultCostPrice: item.defaultCostPrice.trim() ? parseFloat(item.defaultCostPrice) : undefined,
          defaultSalesPrice: item.defaultSalesPrice.trim() ? parseFloat(item.defaultSalesPrice) : undefined,
          defaultTaxRateId: item.defaultTaxRateId.trim() || undefined,
          categoryKey: item.categoryKey.trim() || undefined,
        }));
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ items: typeof payload }>>(`${API}/admin/settings/catalog`, { items: payload }),
      );
      if (res.success) {
        this.catalogSaved.set(true);
        setTimeout(() => this.catalogSaved.set(false), 3000);
      } else {
        this.toastService.show('error', (res as any).message ?? 'Failed to save catalog.');
      }
    } catch {
      this.toastService.show('error', 'Failed to save catalog.');
    } finally {
      this.catalogSaving.set(false);
    }
  }

  // ─── Order category settings ────────────────────────────────────

  private async loadOrderCategories(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ categories: { key: string; label: string; description?: string; defaultUnit?: string }[] }>>(`${API}/admin/settings/order-categories`),
      );
      if (res.success) {
        this.orderCategories.set(
          (res.data.categories ?? []).map((cat) => ({
            key: cat.key,
            label: cat.label,
            description: cat.description ?? '',
            defaultUnit: cat.defaultUnit ?? '',
          })),
        );
      }
    } catch {
      // ignore
    }
  }

  addOrderCategory(): void {
    this.orderCategories.update((cats) => [
      ...cats,
      { key: '', label: '', description: '', defaultUnit: '' },
    ]);
  }

  removeOrderCategory(index: number): void {
    this.orderCategories.update((cats) => cats.filter((_, i) => i !== index));
  }

  updateOrderCategory(index: number, field: string, value: string): void {
    this.orderCategories.update((cats) => {
      const next = [...cats];
      next[index] = { ...next[index]!, [field]: value };
      return next;
    });
  }

  async saveOrderCategories(): Promise<void> {
    this.orderCategoriesSaving.set(true);
    this.orderCategoriesSaved.set(false);
    try {
      const payload = this.orderCategories()
        .filter((cat) => cat.key.trim() && cat.label.trim())
        .map((cat) => ({
          key: cat.key.trim(),
          label: cat.label.trim(),
          description: cat.description.trim() || undefined,
          defaultUnit: cat.defaultUnit.trim() || undefined,
        }));
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ categories: typeof payload }>>(`${API}/admin/settings/order-categories`, { categories: payload }),
      );
      if (res.success) {
        this.orderCategoriesSaved.set(true);
        setTimeout(() => this.orderCategoriesSaved.set(false), 3000);
      } else {
        this.toastService.show('error', (res as any).message ?? 'Failed to save order categories.');
      }
    } catch {
      this.toastService.show('error', 'Failed to save order categories.');
    } finally {
      this.orderCategoriesSaving.set(false);
    }
  }

  // ─── Tax rate settings ─────────────────────────────────────────

  private async loadTaxRates(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ rates: { id: string; name: string; rate: number; productType?: string }[] }>>(`${API}/admin/settings/tax-rates`),
      );
      if (res.success) {
        this.taxRates.set(
          (res.data.rates ?? []).map((rate) => ({
            id: rate.id,
            name: rate.name,
            rate: String(rate.rate),
            productType: rate.productType ?? '',
          })),
        );
      }
    } catch {
      // ignore
    }
  }

  addTaxRate(): void {
    this.taxRates.update((rates) => [
      ...rates,
      { id: crypto.randomUUID(), name: '', rate: '', productType: '' },
    ]);
  }

  removeTaxRate(index: number): void {
    this.taxRates.update((rates) => rates.filter((_, i) => i !== index));
  }

  updateTaxRate(index: number, field: string, value: string): void {
    this.taxRates.update((rates) => {
      const next = [...rates];
      next[index] = { ...next[index]!, [field]: value };
      return next;
    });
  }

  async saveTaxRates(): Promise<void> {
    this.taxRatesSaving.set(true);
    this.taxRatesSaved.set(false);
    try {
      const payload = this.taxRates()
        .filter((rate) => rate.name.trim())
        .map((rate) => ({
          id: rate.id,
          name: rate.name.trim(),
          rate: parseFloat(rate.rate) || 0,
          productType: rate.productType.trim() || undefined,
        }));
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ rates: typeof payload }>>(`${API}/admin/settings/tax-rates`, { rates: payload }),
      );
      if (res.success) {
        this.taxRatesSaved.set(true);
        setTimeout(() => this.taxRatesSaved.set(false), 3000);
      } else {
        this.toastService.show('error', (res as any).message ?? 'Failed to save tax rates.');
      }
    } catch {
      this.toastService.show('error', 'Failed to save tax rates.');
    } finally {
      this.taxRatesSaving.set(false);
    }
  }
}
