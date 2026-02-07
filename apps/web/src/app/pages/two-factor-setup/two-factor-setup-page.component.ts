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
        >Set Up Two-Factor Authentication</h1>
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
          <!-- Step 1: Loading / QR code -->
          @if (loadingQr()) {
            <div class="mt-8 flex flex-col items-center gap-4">
              <div class="h-52 w-52 animate-pulse rounded-xl bg-gray-100"></div>
              <p class="text-sm text-gray-400">Generating QR code…</p>
            </div>
          } @else if (qrDataUrl()) {
            <!-- Step 2: Show QR code + confirm -->
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

              <!-- Manual secret -->
              <details class="text-sm">
                <summary
                  class="cursor-pointer font-medium text-brand-600 hover:text-brand-700"
                >Can't scan? Enter the key manually</summary>
                <div class="mt-2 rounded-lg bg-gray-50 px-4 py-3">
                  <code class="select-all break-all font-mono text-xs text-gray-700">{{ secret() }}</code>
                </div>
              </details>

              <!-- Step 3: Enter code to confirm -->
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
          <!-- Success state -->
          <div class="mt-8 flex flex-col items-center gap-4 text-center">
            <div class="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-green-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
              </svg>
            </div>
            <div>
              <h2 class="text-lg font-semibold text-gray-900">2FA Enabled!</h2>
              <p class="mt-1 text-sm text-gray-500">
                Your account is now protected with two-factor authentication.
                You'll be asked for a code each time you sign in.
              </p>
            </div>
            <a
              routerLink="/dashboard"
              class="mt-4 inline-flex rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              Go to Dashboard
            </a>
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

  async ngOnInit(): Promise<void> {
    // If user already has 2FA, show the success state
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
}
