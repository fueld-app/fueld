import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../core/auth/auth.service';
import type { PasskeyDto } from '@fueld/types';

@Component({
  selector: 'app-two-factor-setup-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="mx-auto">
      <!-- Profile: Phone Number -->
      <div class="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm max-w-md">
        <h2 class="text-lg font-bold text-gray-900">Profile</h2>
        <p class="mt-1 text-sm text-gray-500">Your phone number will appear on generated PDF documents (offers, proforma invoices).</p>

        @if (phoneSuccess()) {
          <div class="mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">
            {{ phoneSuccess() }}
          </div>
        }
        @if (phoneError()) {
          <div class="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {{ phoneError() }}
          </div>
        }

        <form (ngSubmit)="savePhone()" class="mt-4 flex items-end gap-3">
          <div class="flex-1">
            <label for="phone" class="block text-sm font-medium text-gray-700 mb-1">Phone number</label>
            <input
              id="phone"
              type="tel"
              [(ngModel)]="phoneValue"
              name="phone"
              placeholder="e.g. +45 2613 1217"
              class="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <button
            type="submit"
            [disabled]="savingPhone()"
            class="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            @if (savingPhone()) {
              Saving…
            } @else {
              Save
            }
          </button>
        </form>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

      <div class="flex flex-col rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
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

      <!-- ═══════════════════════════════════════════════════════════ -->
      <!--  Passkeys (FIDO2 / WebAuthn)                               -->
      <!-- ═══════════════════════════════════════════════════════════ -->
      <div class="flex flex-col rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div class="flex items-start gap-4">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-indigo-600" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
            </svg>
          </div>
          <div>
            <h2 class="text-xl font-bold text-gray-900">Passkeys</h2>
            <p class="mt-1 text-sm text-gray-500">
              Use a fingerprint, face scan, or security key as a second factor or for passwordless login.
            </p>
          </div>
        </div>

        @if (passkeyError()) {
          <div class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {{ passkeyError() }}
          </div>
        }

        @if (passkeySuccess()) {
          <div class="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700" role="alert">
            {{ passkeySuccess() }}
          </div>
        }

        @if (loadingPasskeys()) {
          <div class="mt-6 flex items-center gap-3 text-sm text-gray-400">
            <svg class="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Loading passkeys…
          </div>
        } @else {
          <!-- Registered passkeys list -->
          @if (passkeyList().length > 0) {
            <div class="mt-6 divide-y divide-gray-100 rounded-lg border border-gray-200">
              @for (pk of passkeyList(); track pk.id) {
                <div class="flex items-center gap-4 px-4 py-3">
                  <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z" clip-rule="evenodd" />
                    </svg>
                  </div>
                  <div class="flex-1 min-w-0">
                    @if (renamingId() === pk.id) {
                      <form (ngSubmit)="confirmRename(pk.id)" class="flex items-center gap-2">
                        <input
                          type="text"
                          [(ngModel)]="renameValue"
                          name="renameValue"
                          class="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                          autofocus
                        />
                        <button type="submit" class="text-xs font-medium text-brand-600 hover:text-brand-700">Save</button>
                        <button type="button" (click)="renamingId.set(null)" class="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                      </form>
                    } @else {
                      <p class="text-sm font-medium text-gray-900 truncate">{{ pk.friendlyName }}</p>
                      <p class="text-xs text-gray-500">
                        Added {{ pk.createdAt | date:'mediumDate' }}
                        @if (pk.lastUsedAt) {
                           · Last used {{ pk.lastUsedAt | date:'mediumDate' }}
                        }
                        @if (pk.backedUp) {
                          <span class="ml-1 inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">Synced</span>
                        }
                      </p>
                    }
                  </div>
                  @if (renamingId() !== pk.id) {
                    <div class="flex items-center gap-1">
                      <button
                        (click)="startRename(pk)"
                        class="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                        title="Rename"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                        </svg>
                      </button>
                      <button
                        (click)="removePasskey(pk.id)"
                        class="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        title="Remove passkey"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  }
                </div>
              }
            </div>
          } @else {
            <div class="mt-6 rounded-lg border border-dashed border-gray-300 p-6 text-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="mx-auto h-8 w-8 text-gray-300" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
              </svg>
              <p class="mt-2 text-sm text-gray-500">No passkeys registered yet.</p>
              <p class="mt-1 text-xs text-gray-400">Add a passkey to use biometrics or a security key for secure login.</p>
            </div>
          }

          <!-- Add passkey form -->
          <div class="mt-5 border-t border-gray-200 pt-5">
            <h3 class="text-sm font-semibold text-gray-900">Register a new passkey</h3>
            <p class="mt-1 text-xs text-gray-500">
              Give it a name to help you recognise it later (e.g. "MacBook Touch ID", "YubiKey 5").
            </p>
            <form (ngSubmit)="addPasskey()" class="mt-3 flex items-end gap-3">
              <div class="flex-1">
                <label for="passkey-name" class="sr-only">Passkey name</label>
                <input
                  id="passkey-name"
                  type="text"
                  [(ngModel)]="newPasskeyName"
                  name="passkeyName"
                  required
                  placeholder="e.g. MacBook Touch ID"
                  class="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <button
                type="submit"
                [disabled]="registeringPasskey() || !newPasskeyName.trim()"
                class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                @if (registeringPasskey()) {
                  Registering…
                } @else {
                  Add Passkey
                }
              </button>
            </form>
          </div>

          <!-- Info box -->
          <div class="mt-5 rounded-lg bg-indigo-50 p-3">
            <p class="text-xs text-indigo-700">
              <strong>How passkeys work:</strong> Passkeys use the WebAuthn (FIDO2) standard. They are stored on your device 
              and verified using biometrics (Touch ID, Face ID), a device PIN, or a hardware security key. 
              Passkeys can be used as a second factor alongside your password, or for fully passwordless sign-in if your 
              organisation allows it.
            </p>
          </div>
        }
      </div>
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

  // Passkey state
  readonly loadingPasskeys = signal(true);
  readonly passkeyList = signal<PasskeyDto[]>([]);
  readonly registeringPasskey = signal(false);
  readonly renamingId = signal<string | null>(null);
  readonly passkeyError = signal('');
  readonly passkeySuccess = signal('');
  newPasskeyName = '';
  renameValue = '';

  // Phone state
  phoneValue = '';
  readonly savingPhone = signal(false);
  readonly phoneError = signal('');
  readonly phoneSuccess = signal('');

  async ngOnInit(): Promise<void> {
    // Load phone
    this.phoneValue = this.auth.userPhone() || '';
    const user = this.auth.user();
    if (user?.is2faEnabled) {
      this.enabled.set(true);
      this.loadingQr.set(false);
    } else {
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

    // Always load passkeys
    this.loadPasskeys();
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

  // ─── Phone ─────────────────────────────────────────────────────────

  async savePhone(): Promise<void> {
    this.savingPhone.set(true);
    this.phoneError.set('');
    this.phoneSuccess.set('');

    try {
      await this.auth.updatePhone(this.phoneValue.trim() || null);
      this.phoneSuccess.set('Phone number updated.');
      setTimeout(() => this.phoneSuccess.set(''), 4000);
    } catch (err) {
      this.phoneError.set(
        err instanceof Error ? err.message : 'Failed to update phone number.',
      );
    } finally {
      this.savingPhone.set(false);
    }
  }

  // ─── Passkey Methods ───────────────────────────────────────────────

  async loadPasskeys(): Promise<void> {
    try {
      const keys = await this.auth.listPasskeys();
      this.passkeyList.set(keys);
    } catch {
      // silent — passkeys section will show empty state
    } finally {
      this.loadingPasskeys.set(false);
    }
  }

  async addPasskey(): Promise<void> {
    const name = this.newPasskeyName.trim();
    if (!name) return;

    this.registeringPasskey.set(true);
    this.passkeyError.set('');
    this.passkeySuccess.set('');

    try {
      const pk = await this.auth.registerPasskey(name);
      this.passkeyList.update((list) => [...list, pk]);
      this.newPasskeyName = '';
      this.passkeySuccess.set(`Passkey "${pk.friendlyName}" has been registered.`);
      setTimeout(() => this.passkeySuccess.set(''), 4000);
    } catch (err) {
      this.passkeyError.set(
        err instanceof Error ? err.message : 'Failed to register passkey.',
      );
    } finally {
      this.registeringPasskey.set(false);
    }
  }

  startRename(pk: PasskeyDto): void {
    this.renamingId.set(pk.id);
    this.renameValue = pk.friendlyName;
  }

  async confirmRename(id: string): Promise<void> {
    const name = this.renameValue.trim();
    if (!name) return;

    try {
      await this.auth.renamePasskey(id, name);
      this.passkeyList.update((list) =>
        list.map((pk) => (pk.id === id ? { ...pk, friendlyName: name } : pk)),
      );
      this.renamingId.set(null);
    } catch (err) {
      this.passkeyError.set(
        err instanceof Error ? err.message : 'Failed to rename passkey.',
      );
    }
  }

  async removePasskey(id: string): Promise<void> {
    try {
      await this.auth.deletePasskey(id);
      this.passkeyList.update((list) => list.filter((pk) => pk.id !== id));
      this.passkeySuccess.set('Passkey removed.');
      setTimeout(() => this.passkeySuccess.set(''), 3000);
    } catch (err) {
      this.passkeyError.set(
        err instanceof Error ? err.message : 'Failed to remove passkey.',
      );
    }
  }
}
