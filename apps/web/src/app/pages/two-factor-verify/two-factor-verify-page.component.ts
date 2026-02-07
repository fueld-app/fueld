import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-two-factor-verify-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div class="w-full max-w-md">
        <!-- Brand -->
        <div class="mb-8 text-center">
          <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-white" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clip-rule="evenodd" />
            </svg>
          </div>
          <h1 class="mt-4 text-2xl font-bold text-gray-900">Two-Factor Verification</h1>
          <p class="mt-1 text-sm text-gray-500">
            Open your authenticator app and enter the 6-digit code.
          </p>
        </div>

        <!-- Card -->
        <div class="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          @if (errorMessage()) {
            <div class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {{ errorMessage() }}
            </div>
          }

          <form class="space-y-5" (ngSubmit)="onSubmit()">
            <div>
              <label for="totp-code" class="block text-sm font-medium text-gray-700">
                Authentication Code
              </label>
              <input
                id="totp-code"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="6"
                autocomplete="one-time-code"
                [(ngModel)]="code"
                name="code"
                required
                autofocus
                class="mt-1.5 block w-full rounded-lg border border-gray-300 px-3.5 py-3 text-center font-mono text-xl tracking-[0.3em] shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                placeholder="000000"
              />
            </div>

            <button
              type="submit"
              [disabled]="loading()"
              class="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              @if (loading()) {
                Verifying…
              } @else {
                Verify
              }
            </button>
          </form>

          <div class="mt-6 text-center">
            <button
              (click)="backToLogin()"
              class="text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
            >
              ← Back to login
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class TwoFactorVerifyPageComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  code = '';
  readonly loading = signal(false);
  readonly errorMessage = signal('');

  private tempToken = '';

  ngOnInit(): void {
    // The temp token is passed via router state from the login page
    const nav = this.router.getCurrentNavigation();
    this.tempToken = (nav?.extras?.state?.['tempToken'] as string) ?? '';

    // Also check history state (for page refreshes / direct navigation)
    if (!this.tempToken) {
      this.tempToken = (history.state?.['tempToken'] as string) ?? '';
    }

    if (!this.tempToken) {
      // No temp token — redirect back to login
      this.router.navigate(['/login']);
    }
  }

  async onSubmit(): Promise<void> {
    const trimmed = this.code.trim();
    if (trimmed.length !== 6) {
      this.errorMessage.set('Please enter a 6-digit code.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    try {
      await this.auth.verify2fa(this.tempToken, trimmed);
      await this.router.navigate(['/']);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Invalid code. Please try again.';
      this.errorMessage.set(msg);
    } finally {
      this.loading.set(false);
    }
  }

  backToLogin(): void {
    this.router.navigate(['/login']);
  }
}
