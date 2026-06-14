import { Injectable, signal, inject, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API } from '@app/core/config/api';
import type { ApiResponse, UserUiPreferences } from '@fueld/types';

@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  private readonly http = inject(HttpClient);

  readonly preferences = signal<UserUiPreferences>({});
  private _loaded = false;

  constructor() {
    // Reactive autosave — watches preferences; debounces to backend
    effect((onCleanup) => {
      const prefs = this.preferences();
      if (!this._loaded) return;

      const timer = setTimeout(() => this.save(prefs), 500);
      onCleanup(() => clearTimeout(timer));
    });
  }

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
    this._loaded = true;
  }

  /** Patch preferences (shallow merge) — save happens reactively via effect. */
  patch(patch: Partial<UserUiPreferences>): void {
    const current = this.preferences();
    this.preferences.set({ ...current, ...patch });
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