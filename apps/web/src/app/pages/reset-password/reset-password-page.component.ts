import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse } from '@fueld/types';

import { API } from '@app/core/config/api';

@Component({
  selector: 'app-reset-password-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div class="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-lg">
        <h1 class="text-2xl font-bold text-gray-900">Reset your password</h1>
        <p class="mt-2 text-sm text-gray-500">
          Choose a new password for your account.
        </p>

        @if (tokenMissing()) {
          <div class="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            Invalid or missing password reset token.
          </div>

          <a
            routerLink="/login"
            class="mt-6 inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
          >
            Back to Login
          </a>
        } @else if (success()) {
          <div class="mt-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700" role="alert">
            Password updated. You can now sign in with your new password.
          </div>

          <a
            routerLink="/login"
            class="mt-6 inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
          >
            Go to Login
          </a>
        } @else {
          @if (errorMessage()) {
            <div class="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {{ errorMessage() }}
            </div>
          }

          <form class="mt-6 space-y-5" (ngSubmit)="onSubmit()">
            <div>
              <label for="password" class="block text-sm font-medium text-gray-700">New password</label>
              <input
                id="password"
                type="password"
                autocomplete="new-password"
                [(ngModel)]="password"
                name="password"
                required
                class="mt-1.5 block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                placeholder="••••••••"
              />
              <p class="mt-1 text-xs text-gray-500">Minimum 8 characters.</p>
            </div>

            <div>
              <label for="confirmPassword" class="block text-sm font-medium text-gray-700">Confirm new password</label>
              <input
                id="confirmPassword"
                type="password"
                autocomplete="new-password"
                [(ngModel)]="confirmPassword"
                name="confirmPassword"
                required
                class="mt-1.5 block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              [disabled]="submitting()"
              class="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50"
            >
              @if (submitting()) {
                Updating…
              } @else {
                Update password
              }
            </button>

            <div class="text-center">
              <a routerLink="/login" class="text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors">
                ← Back to login
              </a>
            </div>
          </form>
        }
      </div>
    </div>
  `,
})
export class ResetPasswordPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);

  readonly tokenMissing = signal(false);
  readonly submitting = signal(false);
  readonly errorMessage = signal('');
  readonly success = signal(false);

  password = '';
  confirmPassword = '';
  private token = '';

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
    if (!this.token.trim()) {
      this.tokenMissing.set(true);
    }
  }

  async onSubmit(): Promise<void> {
    if (this.submitting()) return;

    const password = this.password;
    const confirm = this.confirmPassword;

    if (!password || password.length < 8) {
      this.errorMessage.set('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirm) {
      this.errorMessage.set('Passwords do not match.');
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<null>>(`${API}/auth/password-reset`, {
          token: this.token,
          password,
        }),
      );

      if (!res.success) {
        this.errorMessage.set(res.message || 'Password reset failed');
        return;
      }

      this.success.set(true);
    } catch (err: any) {
      const msg = err?.error?.message || err?.error?.error || 'Password reset failed';
      this.errorMessage.set(msg);
    } finally {
      this.submitting.set(false);
    }
  }
}
