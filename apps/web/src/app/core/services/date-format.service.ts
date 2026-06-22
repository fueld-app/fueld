import { Service, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_URL } from '../config/api';

export type DateFormatSetting = 'AMERICAN' | 'EUROPEAN' | 'ISO';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Shared service for tenant-configurable date formatting. */
@Service()
export class DateFormatService {
  private readonly http = inject(HttpClient);

  /** Current date format setting (default ISO). */
  readonly dateFormat = signal<DateFormatSetting>('ISO');

  /** Angular DatePipe-compatible format string for the current setting. */
  readonly pipeFormat = computed(() => {
    const map: Record<DateFormatSetting, string> = {
      AMERICAN: 'MM/dd/yyyy',
      EUROPEAN: 'dd/MM/yyyy',
      ISO: 'yyyy-MM-dd',
    };
    return map[this.dateFormat()];
  });

  private _loaded = false;

  /** Load the date format setting from the API (non-admin endpoint). */
  async load(): Promise<void> {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: { dateFormat: DateFormatSetting } }>(
          `${API_URL}/admin/settings/my-date-format`,
        ),
      );
      if (res.success && res.data?.dateFormat) {
        this.dateFormat.set(res.data.dateFormat);
      }
    } catch {
      // default ISO works fine
    }
  }

  /** Invalidate cache so the next load() call refetches. */
  invalidateCache(): void {
    this._loaded = false;
  }

  /**
   * Format an ISO date string as a numeric date according to the tenant's setting.
   * AMERICAN → MM/DD/YYYY, EUROPEAN → DD/MM/YYYY, ISO → YYYY-MM-DD.
   * Uses UTC to avoid timezone shifts on date-only values.
   */
  formatDate(iso: string | null | undefined): string {
    if (!iso) return '-';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '-';

    const y = String(date.getUTCFullYear()).padStart(4, '0');
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');

    switch (this.dateFormat()) {
      case 'AMERICAN':  return `${m}/${d}/${y}`;
      case 'EUROPEAN':  return `${d}/${m}/${y}`;
      case 'ISO':
      default:          return `${y}-${m}-${d}`;
    }
  }

  /**
   * Format an ISO date string with a short month name for readability.
   * AMERICAN → "Apr 11, 2026", EUROPEAN → "11 Apr 2026", ISO → "2026-04-11".
   */
  formatDateLabel(iso: string | null | undefined): string {
    if (!iso) return '-';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '-';

    const y = String(date.getUTCFullYear()).padStart(4, '0');
    const mNum = String(date.getUTCMonth() + 1).padStart(2, '0');
    const mStr = MONTHS_SHORT[date.getUTCMonth()];
    const d = String(date.getUTCDate()).padStart(2, '0');

    switch (this.dateFormat()) {
      case 'AMERICAN':  return `${mStr} ${d}, ${y}`;
      case 'EUROPEAN':  return `${d} ${mStr} ${y}`;
      case 'ISO':
      default:          return `${y}-${mNum}-${d}`;
    }
  }
}