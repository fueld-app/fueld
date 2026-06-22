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
    <div class="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-bg-2 px-4">
      <div class="w-full max-w-md">
        <!-- Brand -->
        <div class="mb-8 text-center">
          <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-white" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clip-rule="evenodd" />
            </svg>
          </div>
          <h1 class="mt-4 text-2xl font-bold text-gray-900 dark:text-ink">Two-Factor Verification</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-muted">
            Open your authenticator app and enter the 6-digit code.
          </p>
        </div>

        <!-- Card -->
        <div class="rounded-2xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-8 shadow-sm">
          @if (errorMessage()) {
            <div class="mb-4 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-4 py-3 text-sm text-red-700 dark:text-red-400" role="alert">
              {{ errorMessage() }}
            </div>
          }

          <form class="space-y-5" (ngSubmit)="onSubmit()">
            <div>
              <label for="totp-code" class="block text-sm font-medium text-gray-700 dark:text-ink-dim">
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
                (input)="onCodeInput()"
                name="code"
                required
                autofocus
                class="mt-1.5 block w-full rounded-lg border border-gray-300 dark:border-line-strong px-3.5 py-3 text-center font-mono text-xl tracking-[0.3em] shadow-sm placeholder:text-gray-400 dark:placeholder:text-muted focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="000000"
              />
            </div>

            <button
              type="submit"
              [disabled]="loading()"
              class="w-full rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              @if (loading()) {
                Verifying…
              } @else {
                Verify
              }
            </button>
          </form>

          @if (hasPasskeys()) {
            <div class="mt-5">
              <div class="relative">
                <div class="absolute inset-0 flex items-center">
                  <div class="w-full border-t border-gray-200 dark:border-line"></div>
                </div>
                <div class="relative flex justify-center text-sm">
                  <span class="bg-white dark:bg-surface px-3 text-gray-500 dark:text-muted">or</span>
                </div>
              </div>
              <button
                type="button"
                [disabled]="passkeyLoading()"
                (click)="onPasskeyVerify()"
                class="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-ink-dim shadow-sm transition-colors hover:bg-gray-50 dark:hover:bg-surface-tint disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg class="h-5 w-5 text-gray-500 dark:text-muted" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z" />
                  <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
                </svg>
                @if (passkeyLoading()) {
                  Verifying with passkey…
                } @else {
                  Use a Passkey instead
                }
              </button>
            </div>
          }

          <div class="mt-6 text-center">
            <button
              (click)="backToLogin()"
              class="text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 transition-colors"
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
  readonly passkeyLoading = signal(false);
  readonly errorMessage = signal('');
  readonly hasPasskeys = signal(false);

  private tempToken = '';
  private returnUrl = '/';

  ngOnInit(): void {
    // The temp token is passed via router state from the login page
    const nav = this.router.getCurrentNavigation();
    this.tempToken = (nav?.extras?.state?.['tempToken'] as string) ?? '';
    const passkeys = nav?.extras?.state?.['hasPasskeys'] as boolean | undefined;

    // Also check history state (for page refreshes / direct navigation)
    if (!this.tempToken) {
      this.tempToken = (history.state?.['tempToken'] as string) ?? '';
    }
    if (passkeys === undefined) {
      this.hasPasskeys.set(!!(history.state?.['hasPasskeys']));
    } else {
      this.hasPasskeys.set(!!passkeys);
    }

    this.returnUrl = (nav?.extras?.state?.['returnUrl'] as string)
      ?? (history.state?.['returnUrl'] as string)
      ?? '/';

    if (!this.tempToken) {
      // No temp token — redirect back to login
      this.router.navigate(['/login']);
    }
  }

  onCodeInput(): void {
    const digits = this.code.replace(/\D/g, '');
    if (digits.length === 6) {
      this.onSubmit();
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
      await this.router.navigateByUrl(this.returnUrl);
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

  async onPasskeyVerify(): Promise<void> {
    this.passkeyLoading.set(true);
    this.errorMessage.set('');

    try {
      await this.auth.verify2faWithPasskey(this.tempToken);
      await this.router.navigateByUrl(this.returnUrl);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Passkey verification failed. Please try again.';
      this.errorMessage.set(msg);
    } finally {
      this.passkeyLoading.set(false);
    }
  }

  backToLogin(): void {
    this.router.navigate(['/login']);
  }
}
