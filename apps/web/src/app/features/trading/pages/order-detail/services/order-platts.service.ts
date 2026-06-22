import { Service, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, PlattsSuggestionsResponseDto } from '@fueld/types';
import type { OrderItemRow } from '../../../components/order-items/order-item.types';
import type { PlattsSuggestionViewModel } from '../order-detail.types';
import { API_URL } from '@app/core/config/api';

@Service()
export class OrderPlattsService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  // ─── Signals ─────────────────────────────────────────────────

  readonly suggestions = signal<PlattsSuggestionsResponseDto | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly maxHeight = signal<number | null>(null);

  // ─── Computed ────────────────────────────────────────────────

  readonly suggestionItems = computed<PlattsSuggestionViewModel[]>(() =>
    this.suggestions()?.items ?? [],
  );

  // ─── Timer ───────────────────────────────────────────────────

  private loadTimer: ReturnType<typeof setTimeout> | null = null;

  cancelTimer(): void {
    if (this.loadTimer) {
      clearTimeout(this.loadTimer);
      this.loadTimer = null;
    }
  }

  // ─── Methods ─────────────────────────────────────────────────

  /** Queue a debounced Platts suggestions load (e.g. after items change). */
  queueLoad(itemRows: () => OrderItemRow[], order: () => { eta?: string | null } | null): void {
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.loadTimer = setTimeout(() => {
      void this.load(itemRows(), order());
    }, 250);
  }

  /** Load Platts price suggestions for the current line items. */
  async load(rows: OrderItemRow[], order: { eta?: string | null } | null): Promise<void> {
    const items = rows
      .filter((item) => item.productType)
      .map((item) => ({
        key: item.id,
        productType: item.productType,
        description: item.description?.trim() || null,
      }));

    if (items.length === 0) {
      this.suggestions.set(null);
      this.error.set(null);
      return;
    }

    const publicationDate = (order?.eta ?? new Date().toISOString()).slice(0, 10);
    this.loading.set(true);
    this.error.set(null);

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<PlattsSuggestionsResponseDto>>(`${API_URL}/platts/suggestions`, {
          publicationDate,
          items,
          limitPerItem: 3,
        }),
      );

      if (res.success) {
        this.suggestions.set(res.data);
      } else {
        this.suggestions.set(null);
        this.error.set(res.message || 'Failed to load Platts signals.');
      }
    } catch {
      this.suggestions.set(null);
      this.error.set('Failed to load Platts signals.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Navigate to the Platts report detail page. */
  openReport(reportId: string): void {
    void this.router.navigate(['/resources/platts', reportId]);
  }
}