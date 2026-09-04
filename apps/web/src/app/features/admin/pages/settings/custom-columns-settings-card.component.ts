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
import type { ApiResponse, CustomColumnDef } from '@fueld/types';

import { API } from '@app/core/config/api';
import { SettingsToastService } from './settings-toast.service';

//  Custom Columns settings card — admins define tenant-configurable custom
//  columns for the order entity (e.g. "comment", "voyage"). These columns are
//  NOT hardcoded in the app — they are stored in tenant settings and the
//  inquiries list renders whatever columns are configured here.

@Component({
  selector: 'app-custom-columns-settings-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="app-panel">
      <div class="app-panel-header app-panel-header--brand">
        <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--brand">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-brand-600 dark:text-brand-400" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M3 4.25A1.25 1.25 0 014.25 3h11.5A1.25 1.25 0 0117 4.25v11.5A1.25 1.25 0 0115.75 17H4.25A1.25 1.25 0 013 15.75V4.25zM6.5 7a.75.75 0 000 1.5h7a.75.75 0 000-1.5h-7zM6 11.25a.75.75 0 01.75-.75h7a.75.75 0 010 1.5h-7a.75.75 0 01-.75-.75z" clip-rule="evenodd" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Custom Columns</h3>
          <p class="text-xs text-gray-500 dark:text-muted">Add custom columns to inquiries &amp; orders (e.g. Comment, Voyage). Values are editable inline on the list.</p>
        </div>
      </div>

      <div class="app-panel-body space-y-4">
        @if (loading()) {
          <div class="flex items-center justify-center py-6">
            <svg class="h-6 w-6 animate-spin text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          </div>
        } @else {
          <!-- Existing columns -->
          <div class="space-y-2">
            @for (col of columns(); track col.key) {
              <div class="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-line bg-gray-50 dark:bg-bg-2 px-3 py-2">
                <input
                  type="text"
                  [ngModel]="col.label"
                  (ngModelChange)="updateLabel(col.key, $event)"
                  class="app-input flex-1"
                  placeholder="Column label"
                />
                <select
                  [ngModel]="col.type"
                  (ngModelChange)="updateType(col.key, $event)"
                  class="app-input w-28 bg-white dark:bg-surface"
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                </select>
                <span class="font-mono text-xs text-gray-400 dark:text-muted" [title]="'Key: ' + col.key">{{ col.key }}</span>
                <button
                  type="button"
                  (click)="removeColumn(col.key)"
                  class="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/15 dark:hover:text-red-400"
                  title="Remove column"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5z" clip-rule="evenodd" />
                  </svg>
                </button>
              </div>
            } @empty {
              <p class="text-sm text-gray-500 dark:text-muted">No custom columns yet. Add one below.</p>
            }
          </div>

          <!-- Add new column -->
          <div class="rounded-lg border border-dashed border-gray-300 dark:border-line-strong p-3">
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-muted">Add column</p>
            <div class="flex flex-wrap items-end gap-2">
              <div class="flex-1 min-w-[120px]">
                <label class="block text-xs font-medium text-gray-600 dark:text-ink-dim">Label</label>
                <input
                  type="text"
                  [ngModel]="newLabel()"
                  (ngModelChange)="newLabel.set($event)"
                  class="app-input mt-1 w-full"
                  placeholder="e.g. Voyage"
                />
              </div>
              <div class="w-28">
                <label class="block text-xs font-medium text-gray-600 dark:text-ink-dim">Type</label>
                <select
                  [ngModel]="newType()"
                  (ngModelChange)="newType.set($event)"
                  class="app-input mt-1 w-full bg-white dark:bg-surface"
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                </select>
              </div>
              <button
                type="button"
                (click)="addColumn()"
                [disabled]="!newLabel().trim()"
                class="inline-flex items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
              >
                + Add
              </button>
            </div>
          </div>

          <!-- Save -->
          <div class="flex items-center gap-3 pt-1">
            <button
              (click)="save()"
              [disabled]="saving()"
              class="app-button-primary"
            >
              @if (saving()) { Saving… } @else { Save Columns }
            </button>
            @if (saved()) {
              <span class="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                </svg>
                Saved
              </span>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class CustomColumnsSettingsCardComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toastService = inject(SettingsToastService);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saved = signal(false);

  readonly columns = signal<CustomColumnDef[]>([]);
  readonly newLabel = signal('');
  readonly newType = signal<'text' | 'number'>('text');

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CustomColumnDef[]>>(`${API}/admin/settings/my-custom-columns`),
      );
      if (res.success && Array.isArray(res.data)) {
        this.columns.set(res.data);
      }
    } catch {
      this.toastService.show('error', 'Failed to load custom columns.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Derive a stable key from a label (lowercase, alphanumeric + underscores). */
  private deriveKey(label: string): string {
    return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'column';
  }

  addColumn(): void {
    const label = this.newLabel().trim();
    if (!label) return;
    const type = this.newType();
    let key = this.deriveKey(label);
    // Ensure key uniqueness
    const existing = new Set(this.columns().map((c) => c.key));
    if (existing.has(key)) {
      let n = 2;
      while (existing.has(`${key}_${n}`)) n++;
      key = `${key}_${n}`;
    }
    this.columns.update((cols) => [...cols, { entity: 'order', key, label, type }]);
    this.newLabel.set('');
    this.newType.set('text');
  }

  removeColumn(key: string): void {
    this.columns.update((cols) => cols.filter((c) => c.key !== key));
  }

  updateLabel(key: string, label: string): void {
    this.columns.update((cols) => cols.map((c) => (c.key === key ? { ...c, label } : c)));
  }

  updateType(key: string, type: 'text' | 'number'): void {
    this.columns.update((cols) => cols.map((c) => (c.key === key ? { ...c, type } : c)));
  }

  async save(): Promise<void> {
    this.saving.set(true);
    this.saved.set(false);
    try {
      // Prevent duplicate keys (in case labels collide after manual edits).
      const seen = new Set<string>();
      const deduped: CustomColumnDef[] = [];
      for (const c of this.columns()) {
        if (!seen.has(c.key)) {
          seen.add(c.key);
          deduped.push({ entity: 'order', key: c.key, label: c.label || c.key, type: c.type });
        }
      }
      const res = await firstValueFrom(
        this.http.put<ApiResponse<CustomColumnDef[]>>(`${API}/admin/settings/custom-columns`, { columns: deduped }),
      );
      if (res.success) {
        this.columns.set(res.data ?? deduped);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      } else {
        this.toastService.show('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.toastService.show('error', 'Failed to save custom columns.');
    } finally {
      this.saving.set(false);
    }
  }
}