import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse } from '@fueld/types';
import { AuthService } from '../../core/auth/auth.service';

import { API } from '@app/core/config/api';

@Component({
  selector: 'app-invite-signup-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div class="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        @if (loading()) {
          <div class="flex flex-col items-center py-8">
            <svg class="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <p class="mt-3 text-sm text-gray-500">Validating invitation…</p>
          </div>
        } @else if (invalidMessage()) {
          <div class="text-center py-8">
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <svg class="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 class="mt-4 text-lg font-bold text-gray-900">Invalid Invitation</h2>
            <p class="mt-2 text-sm text-gray-600">{{ invalidMessage() }}</p>
            <a routerLink="/login" class="mt-4 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">
              Go to Login →
            </a>
          </div>
        } @else if (success()) {
          <div class="text-center py-8">
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <svg class="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <h2 class="mt-4 text-lg font-bold text-gray-900">Account Created!</h2>
            <p class="mt-2 text-sm text-gray-600">Your account has been set up. You can now log in.</p>
            <a routerLink="/login" class="mt-4 inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition-colors">
              Go to Login
            </a>
          </div>
        } @else {
          <!-- Signup Form -->
          <div>
            <h2 class="text-xl font-bold text-gray-900">Join Fueld</h2>
            <p class="mt-1 text-sm text-gray-500">Complete your account setup.</p>

            <div class="mt-6 space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  [value]="inviteName()"
                  disabled
                  class="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  [value]="inviteEmail()"
                  disabled
                  class="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <input
                  type="text"
                  [value]="inviteRole()"
                  disabled
                  class="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  [(ngModel)]="password"
                  placeholder="Minimum 8 characters"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                <input
                  type="password"
                  [(ngModel)]="confirmPassword"
                  placeholder="Repeat password"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>

              @if (error()) {
                <div class="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  {{ error() }}
                </div>
              }

              <button
                (click)="submit()"
                [disabled]="submitting()"
                class="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
              >
                @if (submitting()) {
                  Creating account…
                } @else {
                  Create Account
                }
              </button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class InviteSignupPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly invalidMessage = signal('');
  readonly success = signal(false);
  readonly submitting = signal(false);
  readonly error = signal('');

  readonly inviteName = signal('');
  readonly inviteEmail = signal('');
  readonly inviteRole = signal('');

  password = '';
  confirmPassword = '';
  private token = '';

  ngOnInit() {
    this.token = this.route.snapshot.params['token'] ?? '';
    this.validateInvite();
  }

  private async validateInvite() {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ email: string; name: string; role: string }>>(
          `${API}/invite/${this.token}`,
        ),
      );

      if (res.success && res.data) {
        this.inviteName.set(res.data.name);
        this.inviteEmail.set(res.data.email);
        this.inviteRole.set(res.data.role);
      } else {
        this.invalidMessage.set(res.message || 'Invalid invitation');
      }
    } catch {
      this.invalidMessage.set('Unable to validate invitation');
    } finally {
      this.loading.set(false);
    }
  }

  async submit() {
    if (this.password.length < 8) {
      this.error.set('Password must be at least 8 characters');
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.error.set('Passwords do not match');
      return;
    }

    this.submitting.set(true);
    this.error.set('');

    try {
      await this.auth.acceptInvite(this.token, this.password);
      this.success.set(true);
      await this.router.navigate(['/account/security']);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : err?.error?.message;
      this.error.set(msg || 'Failed to create account');
    } finally {
      this.submitting.set(false);
    }
  }
}
