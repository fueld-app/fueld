import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API } from '@app/core/config/api';
import type { ApiResponse, UserUiPreferences } from '@fueld/types';

// ═══════════════════════════════════════════════════════════════════════
//  User Preferences Service — cross-device UI preferences
// ═══════════════════════════════════════════════════════════════════════

@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  private readonly http = inject(HttpClient);

  readonly preferences = signal<UserUiPreferences>({});
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Load preferences from backend (call once after auth). */
  async load(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<UserUiPreferences>>(`${API}/auth/preferences`),
      );
      if (res.success) {
        this.preferences.set(res.data ?? {});
      }
    } catch {
      // silently ignore — local defaults will apply
    }
  }

  /** Patch preferences (shallow merge) and debounce-save to backend. */
  patch(patch: Partial<UserUiPreferences>): void {
    const current = this.preferences();
    const next = { ...current, ...patch };
    this.preferences.set(next);

    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this.save(next), 500);
  }

  private async save(prefs: UserUiPreferences): Promise<void> {
    try {
      await firstValueFrom(
        this.http.put<ApiResponse<UserUiPreferences>>(`${API}/auth/preferences`, prefs),
      );
    } catch {
      // silently ignore — preferences stay in memory for this session
    }
  }
}
