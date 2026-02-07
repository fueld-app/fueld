import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-two-factor-setup-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="mx-auto max-w-lg py-10 px-4">

      <div class="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1
          class="text-xl font-bold text-gray-900"
        >Two-Factor Authentication</h1>
        <p class="mt-1 text-sm text-gray-500">
          Secure your account with a time-based one-time password (TOTP).
        </p>

        @if (errorMessage()) {
          <div class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {{ errorMessage() }}
          </div>
        }

        @if (successMessage()) {
          <div class="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700" role="alert">
            {{ successMessage() }}
          </div>
        }

        @if (!enabled()) {
          <!-- Setup flow: Loading / QR code -->
          @if (loadingQr()) {
            <div class="mt-8 flex flex-col items-center gap-4">
              <div class="h-52 w-52 animate-pulse rounded-xl bg-gray-100"></div>
              <p class="text-sm text-gray-400">Generating QR code…</p>
            </div>
          } @else if (qrDataUrl()) {
            <div class="mt-6 space-y-6">
              <div>
                <h2 class="text-sm font-semibold text-gray-700">Step 1 — Scan the QR code</h2>
                <p class="mt-1 text-sm text-gray-500">
                  Open your authenticator app (Google Authenticator, Authy, 1Password, etc.)
                  and scan this QR code.
                </p>
              </div>

              <div class="flex justify-center">
                <div class="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                  <img
                    [src]="qrDataUrl()"
                    alt="QR code for authenticator app"
                    class="h-52 w-52"
                    width="208"
                    height="208"
                  />
                </div>
              </div>

              <details class="text-sm">
                <summary
                  class="cursor-pointer font-medium text-brand-600 hover:text-brand-700"
                >Can't scan? Enter the key manually</summary>
                <div class="mt-2 rounded-lg bg-gray-50 px-4 py-3">
                  <code class="select-all break-all font-mono text-xs text-gray-700">{{ secret() }}</code>
                </div>
              </details>

              <div>
                <h2 class="text-sm font-semibold text-gray-700">Step 2 — Enter the 6-digit code</h2>
                <p class="mt-1 text-sm text-gray-500">
                  Enter the code shown in your authenticator app to verify setup.
                </p>
              </div>

              <form (ngSubmit)="onConfirm()" class="flex items-end gap-3">
                <div class="flex-1">
                  <label for="totp-code" class="sr-only">6-digit code</label>
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
                    class="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-center font-mono text-lg tracking-[0.3em] shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    placeholder="000000"
                  />
                </div>
                <button
                  type="submit"
                  [disabled]="verifying()"
                  class="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  @if (verifying()) {
                    Verifying…
                  } @else {
                    Verify & Enable
                  }
                </button>
              </form>
            </div>
          }
        } @else {
          <!-- 2FA is active — show status + reset option -->
          <div class="mt-6 space-y-6">
            <div class="flex items-start gap-4 rounded-lg border border-green-200 bg-green-50 p-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
                </svg>
              </div>
              <div>
                <h2 class="text-sm font-semibold text-green-900">2FA is enabled</h2>
                <p class="mt-0.5 text-sm text-green-700">
                  Your account is protected with two-factor authentication.
                  You're asked for a code each time you sign in.
                </p>
              </div>
            </div>

            <!-- Reset 2FA section -->
            <div class="border-t border-gray-200 pt-6">
              <h2 class="text-sm font-semibold text-gray-900">Reset Two-Factor Authentication</h2>
              <p class="mt-1 text-sm text-gray-500">
                To reset 2FA (e.g. if you switched phones), enter your current
                authenticator code to disable it, then set it up again.
              </p>

              @if (!showResetForm()) {
                <button
                  (click)="showResetForm.set(true)"
                  class="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600
                         hover:bg-red-50 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                >
                  Reset 2FA
                </button>
              } @else {
                <form (ngSubmit)="onDisable()" class="mt-4 flex items-end gap-3">
                  <div class="flex-1">
                    <label for="disable-code" class="block text-xs font-medium text-gray-600 mb-1">Current 6-digit code</label>
                    <input
                      id="disable-code"
                      type="text"
                      inputmode="numeric"
                      pattern="[0-9]*"
                      maxlength="6"
                      autocomplete="one-time-code"
                      [(ngModel)]="disableCode"
                      name="disableCode"
                      required
                      class="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-center font-mono text-lg tracking-[0.3em] shadow-sm placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                      placeholder="000000"
                    />
                  </div>
                  <button
                    type="submit"
                    [disabled]="disabling()"
                    class="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    @if (disabling()) {
                      Disabling…
                    } @else {
                      Confirm Disable
                    }
                  </button>
                </form>
              }
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class TwoFactorSetupPageComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly loadingQr = signal(true);
  readonly qrDataUrl = signal('');
  readonly secret = signal('');
  code = '';
  readonly verifying = signal(false);
  readonly enabled = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  // Reset state
  readonly showResetForm = signal(false);
  readonly disabling = signal(false);
  disableCode = '';

  async ngOnInit(): Promise<void> {
    const user = this.auth.user();
    if (user?.is2faEnabled) {
      this.enabled.set(true);
      this.loadingQr.set(false);
      return;
    }

    try {
      const { secret, qrDataUrl } = await this.auth.setup2fa();
      this.qrDataUrl.set(qrDataUrl);
      this.secret.set(secret);
    } catch (err) {
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to generate QR code.',
      );
    } finally {
      this.loadingQr.set(false);
    }
  }

  async onConfirm(): Promise<void> {
    const trimmed = this.code.trim();
    if (trimmed.length !== 6) {
      this.errorMessage.set('Please enter a 6-digit code.');
      return;
    }

    this.verifying.set(true);
    this.errorMessage.set('');

    try {
      await this.auth.enable2fa(trimmed);
      this.enabled.set(true);
      this.successMessage.set('Two-factor authentication has been enabled.');
    } catch (err) {
      this.errorMessage.set(
        err instanceof Error
          ? err.message
          : 'Invalid code. Please try again.',
      );
    } finally {
      this.verifying.set(false);
    }
  }

  async onDisable(): Promise<void> {
    const trimmed = this.disableCode.trim();
    if (trimmed.length !== 6) {
      this.errorMessage.set('Please enter a 6-digit code.');
      return;
    }

    this.disabling.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    try {
      await this.auth.disable2fa(trimmed);
      this.enabled.set(false);
      this.showResetForm.set(false);
      this.disableCode = '';
      this.successMessage.set('2FA has been disabled. You can set it up again below.');

      // Auto-generate a new QR code so they can re-enroll immediately
      const { secret, qrDataUrl } = await this.auth.setup2fa();
      this.qrDataUrl.set(qrDataUrl);
      this.secret.set(secret);
    } catch (err) {
      this.errorMessage.set(
        err instanceof Error
          ? err.message
          : 'Invalid code. Please try again.',
      );
    } finally {
      this.disabling.set(false);
    }
  }
}
