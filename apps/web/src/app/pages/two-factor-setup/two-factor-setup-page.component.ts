import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Subscription } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { WebSocketService } from '../../core/websocket/websocket.service';
import { API_URL } from '../../core/config/api';
import { ThemeService, THEME_TOGGLE_ENABLED, ThemePref } from '../../core/theme.service';
import type { PasskeyDto, ApiResponse } from '@fueld/types';
import { TwoFactorSetupProfileCardComponent } from './two-factor-setup-profile-card.component';
import { DateLabelPipe } from '@app/shared/pipes/date-format.pipe';

@Component({
  selector: 'app-two-factor-setup-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DateLabelPipe, FormsModule, DatePipe, TwoFactorSetupProfileCardComponent],
  template: `
    <div class="mx-auto">
      @if (auth.mfaSetupRequired()) {
        <section class="mb-6 overflow-hidden rounded-3xl border border-amber-300 bg-gradient-to-br from-amber-50 via-white to-orange-50 shadow-sm">
          <div class="grid gap-5 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:px-8">
            <div>
              <div class="inline-flex items-center gap-2 rounded-full bg-amber-100 dark:bg-amber-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-800 dark:text-amber-300">
                Action Required
              </div>
              <h1 class="mt-3 text-2xl font-bold tracking-tight text-gray-900 dark:text-ink">Set up two-factor authentication to continue</h1>
              <p class="mt-2 max-w-2xl text-sm leading-6 text-gray-700 dark:text-ink-dim">
                Your account is signed in, but your organisation will not allow normal access until you add a second factor.
                Complete either option below: verify an authenticator app code or register a passkey on this device.
              </p>
              <div class="mt-4 flex flex-wrap gap-3 text-sm">
                <a
                  href="#two-factor-card"
                  class="inline-flex items-center justify-center rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white shadow-sm transition-colors hover:bg-amber-700"
                >
                  Set Up Authenticator App
                </a>
                <a
                  href="#passkeys-card"
                  class="inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white dark:bg-surface px-4 py-2 font-semibold text-amber-900 dark:text-amber-300 transition-colors hover:bg-amber-100 dark:hover:bg-amber-500/20"
                >
                  Register a Passkey
                </a>
              </div>
            </div>

            <div class="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-white/80 p-4 lg:w-80">
              <p class="text-sm font-semibold text-gray-900 dark:text-ink">What happens next</p>
              <ul class="mt-3 space-y-2 text-sm text-gray-700 dark:text-ink-dim">
                <li class="flex gap-2">
                  <span class="mt-0.5 text-amber-600 dark:text-amber-400">1.</span>
                  <span>Choose authenticator app or passkey below.</span>
                </li>
                <li class="flex gap-2">
                  <span class="mt-0.5 text-amber-600 dark:text-amber-400">2.</span>
                  <span>Complete verification once.</span>
                </li>
                <li class="flex gap-2">
                  <span class="mt-0.5 text-amber-600 dark:text-amber-400">3.</span>
                  <span>Fueld unlocks normal navigation automatically.</span>
                </li>
              </ul>
            </div>
          </div>
        </section>
      }

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

      <!-- Theme (appearance) — gated behind THEME_TOGGLE_ENABLED (plan decision #6) -->
      @if (themeToggleEnabled) {
      <div class="flex flex-col rounded-2xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-6 shadow-sm">
        <div class="flex items-start gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-700/15">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4"></circle>
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
            </svg>
          </div>
          <div>
            <h2 class="text-lg font-bold text-gray-900 dark:text-ink">Appearance</h2>
            <p class="mt-1 text-sm text-gray-500 dark:text-muted">
              Choose how Fueld looks. <strong>Device</strong> follows your system setting.
            </p>
          </div>
        </div>

        <div class="mt-4 inline-flex w-full max-w-sm rounded-lg border border-gray-200 dark:border-line bg-gray-50 dark:bg-bg-2 p-1" role="group" aria-label="Theme preference">
          @for (opt of themeOptions; track opt.value) {
            <button
              type="button"
              (click)="theme.set(opt.value)"
              [class.bg-white]="theme.pref() === opt.value"
              [class.shadow-sm]="theme.pref() === opt.value"
              [class.text-brand-700]="theme.pref() === opt.value"
              [class.font-semibold]="theme.pref() === opt.value"
              class="flex-1 rounded-md px-3 py-2 text-sm text-gray-600 dark:text-ink-dim transition-colors hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-600"
              [attr.aria-pressed]="theme.pref() === opt.value"
            >
              {{ opt.label }}
            </button>
          }
        </div>
        <p class="mt-2 text-xs text-gray-400 dark:text-muted">Currently: {{ theme.resolved() }}</p>
      </div>
      }

      <!-- Profile: Phone Number -->
      <app-two-factor-setup-profile-card
        [phoneValue]="phoneValue"
        [saving]="savingPhone()"
        [success]="phoneSuccess()"
        [error]="phoneError()"
        (phoneValueChange)="phoneValue = $event"
        (save)="savePhone()"
      />

      <!-- WhatsApp Linked Device -->
      @if (waEnabled()) {
      <div class="flex flex-col rounded-2xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-6 shadow-sm">
        <div class="flex items-start gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-50 dark:bg-green-500/15">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-600 dark:text-green-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </div>
          <div>
            <h2 class="text-lg font-bold text-gray-900 dark:text-ink">WhatsApp</h2>
            <p class="mt-1 text-sm text-gray-500 dark:text-muted">
              Link your WhatsApp to send offers and invoices directly from the system.
            </p>
          </div>
        </div>

        @if (waError()) {
          <div class="mt-3 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
            {{ waError() }}
          </div>
        }

        @if (waStatus() === 'connected' || waStatus() === 'stored') {
          <!-- Connected state -->
          <div class="mt-4 flex items-start gap-3 rounded-lg border border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/15 p-4">
            <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/15">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-green-600 dark:text-green-400" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
              </svg>
            </div>
            <div class="flex-1">
              <p class="text-sm font-semibold text-green-900 dark:text-green-300">WhatsApp linked</p>
              @if (waPhone()) {
                <p class="text-sm text-green-700 dark:text-green-400">+{{ waPhone() }}</p>
              }
            </div>
          </div>

          <button
            (click)="unlinkWhatsApp()"
            [disabled]="waLoading()"
            class="mt-4 rounded-lg border border-red-300 bg-white dark:bg-surface px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50"
          >
            @if (waLoading()) { Unlinking… } @else { Unlink WhatsApp }
          </button>
        } @else if (waStatus() === 'qr') {
          <!-- QR code scanning -->
          <div class="mt-4 space-y-3">
            <p class="text-sm text-gray-600 dark:text-ink-dim">
              Open WhatsApp on your phone → Settings → Linked Devices → Link a Device, then scan this QR code.
            </p>
            <div class="flex justify-center">
              <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-3 shadow-sm">
                <img
                  [src]="waQrDataUrl()"
                  alt="WhatsApp QR code"
                  class="h-52 w-52"
                  width="208"
                  height="208"
                />
              </div>
            </div>
            <p class="text-center text-xs text-gray-400 dark:text-muted">QR code refreshes automatically</p>
          </div>
        } @else if (waStatus() === 'connecting') {
          <!-- Connecting -->
          <div class="mt-4 flex items-center gap-3 text-sm text-gray-400 dark:text-muted">
            <svg class="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Connecting to WhatsApp…
          </div>
        } @else {
          <!-- Not linked -->
          <button
            (click)="linkWhatsApp()"
            [disabled]="waLoading()"
            class="mt-4 inline-flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white
                   shadow-sm transition-colors hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500
                   focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            @if (waLoading()) {
              <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              Starting…
            } @else {
              Link WhatsApp
            }
          </button>
        }
      </div>
      }

      <!-- Two-Factor Authentication -->
      <div
        id="two-factor-card"
        class="flex flex-col rounded-2xl border bg-white dark:bg-surface p-8 shadow-sm"
        [class.border-amber-300]="auth.mfaSetupRequired()"
        [class.ring-2]="auth.mfaSetupRequired()"
        [class.ring-amber-200]="auth.mfaSetupRequired()"
        [class.border-gray-200]="!auth.mfaSetupRequired()"
      >
        <h1
          class="text-xl font-bold text-gray-900 dark:text-ink"
        >Two-Factor Authentication</h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-muted">
          Secure your account with a time-based one-time password (TOTP).
        </p>

        @if (auth.mfaSetupRequired()) {
          <div class="mt-4 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-4 py-3 text-sm text-amber-900 dark:text-amber-300">
            Complete this setup now to unlock the rest of the app.
          </div>
        }

        @if (errorMessage()) {
          <div class="mt-4 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-4 py-3 text-sm text-red-700 dark:text-red-400" role="alert">
            {{ errorMessage() }}
          </div>
        }

        @if (successMessage()) {
          <div class="mt-4 rounded-lg border border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/15 px-4 py-3 text-sm text-green-700 dark:text-green-400" role="alert">
            {{ successMessage() }}
          </div>
        }

        @if (!enabled()) {
          <!-- Setup flow: Loading / QR code -->
          @if (loadingQr()) {
            <div class="mt-8 flex flex-col items-center gap-4">
              <div class="h-52 w-52 animate-pulse rounded-xl bg-gray-100 dark:bg-surface-3"></div>
              <p class="text-sm text-gray-400 dark:text-muted">Generating QR code…</p>
            </div>
          } @else if (qrDataUrl()) {
            <div class="mt-6 space-y-6">
              <div>
                <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">Step 1 — Scan the QR code</h2>
                <p class="mt-1 text-sm text-gray-500 dark:text-muted">
                  Open your authenticator app (Google Authenticator, Authy, 1Password, etc.)
                  and scan this QR code.
                </p>
              </div>

              <div class="flex justify-center">
                <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-3 shadow-sm">
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
                  class="cursor-pointer font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700"
                >Can't scan? Enter the key manually</summary>
                <div class="mt-2 rounded-lg bg-gray-50 dark:bg-bg-2 px-4 py-3">
                  <code class="select-all break-all font-mono text-xs text-gray-700 dark:text-ink-dim">{{ secret() }}</code>
                </div>
              </details>

              <div>
                <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">Step 2 — Enter the 6-digit code</h2>
                <p class="mt-1 text-sm text-gray-500 dark:text-muted">
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
                    class="block w-full rounded-lg border border-gray-300 dark:border-line-strong px-3.5 py-2.5 text-center font-mono text-lg tracking-[0.3em] shadow-sm placeholder:text-gray-400 dark:placeholder:text-muted focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    placeholder="000000"
                  />
                </div>
                <button
                  type="submit"
                  [disabled]="verifying()"
                  class="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
            <div class="flex items-start gap-4 rounded-lg border border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/15 p-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/15">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-600 dark:text-green-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
                </svg>
              </div>
              <div>
                <h2 class="text-sm font-semibold text-green-900 dark:text-green-300">2FA is enabled</h2>
                <p class="mt-0.5 text-sm text-green-700 dark:text-green-400">
                  Your account is protected with two-factor authentication.
                  You're asked for a code each time you sign in.
                </p>
              </div>
            </div>

            <!-- Reset 2FA section -->
            <div class="border-t border-gray-200 dark:border-line pt-6">
              <h2 class="text-sm font-semibold text-gray-900 dark:text-ink">Reset Two-Factor Authentication</h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-muted">
                To reset 2FA (e.g. if you switched phones), enter your current
                authenticator code to disable it, then set it up again.
              </p>

              @if (!showResetForm()) {
                <button
                  (click)="showResetForm.set(true)"
                  class="mt-4 rounded-lg border border-red-300 bg-white dark:bg-surface px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                >
                  Reset 2FA
                </button>
              } @else {
                <form (ngSubmit)="onDisable()" class="mt-4 flex items-end gap-3">
                  <div class="flex-1">
                    <label for="disable-code" class="block text-xs font-medium text-gray-600 dark:text-ink-dim mb-1">Current 6-digit code</label>
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
                      class="block w-full rounded-lg border border-gray-300 dark:border-line-strong px-3.5 py-2.5 text-center font-mono text-lg tracking-[0.3em] shadow-sm placeholder:text-gray-400 dark:placeholder:text-muted focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
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
      <div
        id="passkeys-card"
        class="flex flex-col rounded-2xl border bg-white dark:bg-surface p-8 shadow-sm"
        [class.border-amber-300]="auth.mfaSetupRequired()"
        [class.ring-2]="auth.mfaSetupRequired()"
        [class.ring-amber-200]="auth.mfaSetupRequired()"
        [class.border-gray-200]="!auth.mfaSetupRequired()"
      >
        <div class="flex items-start gap-4">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-500/15">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-indigo-600 dark:text-indigo-400" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
            </svg>
          </div>
          <div>
            <h2 class="text-xl font-bold text-gray-900 dark:text-ink">Passkeys</h2>
            <p class="mt-1 text-sm text-gray-500 dark:text-muted">
              Use a fingerprint, face scan, or security key as a second factor or for passwordless login.
            </p>
          </div>
        </div>

        @if (auth.mfaSetupRequired()) {
          <div class="mt-4 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-4 py-3 text-sm text-amber-900 dark:text-amber-300">
            If you prefer not to use an authenticator app, registering one passkey also satisfies the requirement.
          </div>
        }

        @if (passkeyError()) {
          <div class="mt-4 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-4 py-3 text-sm text-red-700 dark:text-red-400" role="alert">
            {{ passkeyError() }}
          </div>
        }

        @if (passkeySuccess()) {
          <div class="mt-4 rounded-lg border border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/15 px-4 py-3 text-sm text-green-700 dark:text-green-400" role="alert">
            {{ passkeySuccess() }}
          </div>
        }

        @if (loadingPasskeys()) {
          <div class="mt-6 flex items-center gap-3 text-sm text-gray-400 dark:text-muted">
            <svg class="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Loading passkeys…
          </div>
        } @else {
          <!-- Registered passkeys list -->
          @if (passkeyList().length > 0) {
            <div class="mt-6 divide-y divide-gray-100 dark:divide-line rounded-lg border border-gray-200 dark:border-line">
              @for (pk of passkeyList(); track pk.id) {
                <div class="flex items-center gap-4 px-4 py-3">
                  <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-surface-3">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5 text-gray-500 dark:text-muted" viewBox="0 0 20 20" fill="currentColor">
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
                          class="w-full rounded-md border border-gray-300 dark:border-line-strong px-2 py-1 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                          autofocus
                        />
                        <button type="submit" class="text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700">Save</button>
                        <button type="button" (click)="renamingId.set(null)" class="text-xs text-gray-400 dark:text-muted hover:text-gray-600">Cancel</button>
                      </form>
                    } @else {
                      <p class="text-sm font-medium text-gray-900 dark:text-ink truncate">{{ pk.friendlyName }}</p>
                      <p class="text-xs text-gray-500 dark:text-muted">
                        Added {{ pk.createdAt | dateLabel }}
                        @if (pk.lastUsedAt) {
                           · Last used {{ pk.lastUsedAt | dateLabel }}
                        }
                        @if (pk.backedUp) {
                          <span class="ml-1 inline-flex items-center rounded bg-blue-50 dark:bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">Synced</span>
                        }
                      </p>
                    }
                  </div>
                  @if (renamingId() !== pk.id) {
                    <div class="flex items-center gap-1">
                      <button
                        (click)="startRename(pk)"
                        class="rounded p-1.5 text-gray-400 dark:text-muted hover:bg-gray-100 dark:hover:bg-surface-tint-strong hover:text-gray-600 transition-colors"
                        title="Rename"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                        </svg>
                      </button>
                      <button
                        (click)="removePasskey(pk.id)"
                        class="rounded p-1.5 text-gray-400 dark:text-muted hover:bg-red-50 dark:hover:bg-red-500/15 hover:text-red-600 transition-colors"
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
            <div class="mt-6 rounded-lg border border-dashed border-gray-300 dark:border-line-strong p-6 text-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="mx-auto h-8 w-8 text-gray-300 dark:text-muted" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
              </svg>
              <p class="mt-2 text-sm text-gray-500 dark:text-muted">No passkeys registered yet.</p>
              <p class="mt-1 text-xs text-gray-400 dark:text-muted">Add a passkey to use biometrics or a security key for secure login.</p>
            </div>
          }

          <!-- Add passkey form -->
          <div class="mt-5 border-t border-gray-200 dark:border-line pt-5">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Register a new passkey</h3>
            <p class="mt-1 text-xs text-gray-500 dark:text-muted">
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
                  class="block w-full rounded-lg border border-gray-300 dark:border-line-strong px-3.5 py-2.5 text-sm shadow-sm placeholder:text-gray-400 dark:placeholder:text-muted focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
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
          <div class="mt-5 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 p-3">
            <p class="text-xs text-indigo-700 dark:text-indigo-400">
              <strong>How passkeys work:</strong> Passkeys use the WebAuthn (FIDO2) standard. They are stored on your device 
              and verified using biometrics (Touch ID, Face ID), a device PIN, or a hardware security key. 
              Passkeys can be used as a second factor alongside your password, or for fully passwordless sign-in if your 
              organisation allows it.
            </p>
          </div>
        }
      </div>

      <!-- ═══════════════════════════════════════════════════════════ -->
      <!--  Microsoft 365                                              -->
      <!-- ═══════════════════════════════════════════════════════════ -->
      <div class="flex flex-col rounded-2xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-6 shadow-sm">
        <div class="flex items-start gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-500/15">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600 dark:text-blue-400" viewBox="0 0 23 23" fill="currentColor">
              <path d="M1 1h10v10H1z"/>
              <path d="M12 1h10v10H12z"/>
              <path d="M1 12h10v10H1z"/>
              <path d="M12 12h10v10H12z"/>
            </svg>
          </div>
          <div>
            <h2 class="text-lg font-bold text-gray-900 dark:text-ink">Microsoft 365</h2>
            <p class="mt-1 text-sm text-gray-500 dark:text-muted">
              Connect your Microsoft account to send emails via Outlook directly from Fueld.
            </p>
          </div>
        </div>

        @if (msError()) {
          <div class="mt-3 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
            {{ msError() }}
          </div>
        }

        @if (msSuccess()) {
          <div class="mt-3 rounded-lg border border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/15 px-4 py-2.5 text-sm text-green-700 dark:text-green-400">
            {{ msSuccess() }}
          </div>
        }

        @if (msLoading()) {
          <div class="mt-4 flex items-center gap-3 text-sm text-gray-400 dark:text-muted">
            <svg class="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Checking Microsoft status…
          </div>
        } @else if (msConnected()) {
          <div class="mt-4 flex items-start gap-3 rounded-lg border border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/15 p-4">
            <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/15">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-green-600 dark:text-green-400" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
              </svg>
            </div>
            <div class="flex-1">
              <p class="text-sm font-semibold text-green-900 dark:text-green-300">Microsoft account connected</p>
              <p class="text-sm text-green-700 dark:text-green-400">Emails will be sent via your Outlook mailbox.</p>
            </div>
          </div>

          <button
            (click)="disconnectMicrosoft()"
            [disabled]="msDisconnecting()"
            class="mt-4 rounded-lg border border-red-300 bg-white dark:bg-surface px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50"
          >
            @if (msDisconnecting()) { Disconnecting… } @else { Disconnect Microsoft }
          </button>
        } @else if (!msConfigured()) {
          <div class="mt-4 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 p-4">
            <p class="text-sm text-amber-700 dark:text-amber-400">
              Microsoft integration has not been configured yet. Ask an administrator to set it up in Admin → Integrations.
            </p>
          </div>
        } @else {
          <button
            (click)="connectMicrosoft()"
            class="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white
                   shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500
                   focus:ring-offset-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 23 23" fill="currentColor">
              <path d="M1 1h10v10H1z"/>
              <path d="M12 1h10v10H12z"/>
              <path d="M1 12h10v10H1z"/>
              <path d="M12 12h10v10H12z"/>
            </svg>
            Connect Microsoft Account
          </button>
        }
      </div>
      </div>
    </div>
  `,
})
export class TwoFactorSetupPageComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly wsService = inject(WebSocketService);

  // Theme (appearance) control — gated by THEME_TOGGLE_ENABLED in the template.
  protected readonly theme = inject(ThemeService);
  protected readonly themeToggleEnabled = THEME_TOGGLE_ENABLED;
  protected readonly themeOptions: { value: ThemePref; label: string }[] = [
    { value: 'device', label: 'Device' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

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

  // WhatsApp state
  readonly waEnabled = signal(true);  // assume enabled until status response says otherwise
  readonly waStatus = signal<'none' | 'connecting' | 'qr' | 'connected' | 'stored' | 'closed'>('none');
  readonly waQrDataUrl = signal('');
  readonly waPhone = signal<string | null>(null);
  readonly waLoading = signal(false);
  readonly waError = signal('');
  private waSubs: Subscription[] = [];

  // Microsoft 365 state
  readonly msConnected = signal(false);
  readonly msConfigured = signal(true);  // assume configured until status check
  readonly msLoading = signal(true);
  readonly msDisconnecting = signal(false);
  readonly msError = signal('');
  readonly msSuccess = signal('');

  async ngOnInit(): Promise<void> {
    // Load phone
    this.phoneValue = this.auth.userPhone() || '';

    // Load WhatsApp status
    this.loadWhatsAppStatus();
    this.wsService.send({ type: 'whatsapp:subscribe' });
    // Subscribe to WhatsApp WebSocket events
    this.waSubs.push(
      this.wsService.on<string>('whatsapp:qr').subscribe((qr) => {
        this.waStatus.set('qr');
        this.waQrDataUrl.set(qr);
      }),
      this.wsService.on<{ phoneNumber: string | null }>('whatsapp:connected').subscribe((data) => {
        this.waStatus.set('connected');
        this.waPhone.set(data.phoneNumber);
        this.waQrDataUrl.set('');
      }),
      this.wsService.on<{ reason: string }>('whatsapp:disconnected').subscribe(() => {
        this.waStatus.set('none');
        this.waPhone.set(null);
        this.waQrDataUrl.set('');
      }),
    );

    // ── Microsoft 365 status ──
    this.loadMicrosoftStatus();
    // Check if we just returned from the Microsoft connect flow
    const params = new URLSearchParams(window.location.search);
    if (params.get('microsoft_connected') === 'true') {
      this.msConnected.set(true);
      this.msLoading.set(false);
      this.msSuccess.set('Microsoft account connected successfully.');
      setTimeout(() => this.msSuccess.set(''), 5000);
      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete('microsoft_connected');
      window.history.replaceState({}, '', url.toString());
    }
    if (params.get('microsoft_error')) {
      this.msLoading.set(false);
      this.msError.set(decodeURIComponent(params.get('microsoft_error')!));
      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete('microsoft_error');
      window.history.replaceState({}, '', url.toString());
    }

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

  // ─── Microsoft 365 Methods ──────────────────────────────────────────

  async loadMicrosoftStatus(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ connected: boolean; configured: boolean }>>(
          `${API_URL}/auth/microsoft/status`,
        ),
      );
      if (res.success && res.data) {
        this.msConnected.set(res.data.connected);
        this.msConfigured.set(res.data.configured);
      }
    } catch {
      // Silently fail — will show "not connected" state
    } finally {
      this.msLoading.set(false);
    }
  }

  async connectMicrosoft(): Promise<void> {
    this.msError.set('');
    try {
      const returnUrl = window.location.origin + '/account/settings';
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ redirectUrl: string }>>(
          `${API_URL}/auth/microsoft/connect`,
          { params: { returnUrl } },
        ),
      );
      if (res.success && res.data?.redirectUrl) {
        window.location.href = res.data.redirectUrl;
      } else {
        this.msError.set('Failed to initiate Microsoft connection.');
      }
    } catch (err: any) {
      this.msError.set(err?.error?.message ?? 'Failed to connect Microsoft account.');
    }
  }

  async disconnectMicrosoft(): Promise<void> {
    this.msDisconnecting.set(true);
    this.msError.set('');
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<null>>(`${API_URL}/auth/microsoft/connection`),
      );
      this.msConnected.set(false);
      this.msSuccess.set('Microsoft account disconnected.');
      setTimeout(() => this.msSuccess.set(''), 4000);
    } catch (err: any) {
      this.msError.set(err?.error?.message ?? 'Failed to disconnect Microsoft account.');
    } finally {
      this.msDisconnecting.set(false);
    }
  }

  // ─── WhatsApp Methods ──────────────────────────────────────────────

  ngOnDestroy(): void {
    this.wsService.send({ type: 'whatsapp:unsubscribe' });
    this.waSubs.forEach((s) => s.unsubscribe());
  }

  async loadWhatsAppStatus(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ linked: boolean; status: string; phoneNumber?: string | null; qr?: string; whatsappEnabled?: boolean }>>(
          `${API_URL}/whatsapp/status`,
        ),
      );
      if (res.success && res.data) {
        const d = res.data;
        this.waEnabled.set(d.whatsappEnabled !== false);
        if (d.linked) {
          this.waStatus.set(d.status === 'stored' ? 'stored' : 'connected');
          this.waPhone.set(d.phoneNumber ?? null);
        } else {
          this.waStatus.set('none');
        }
      }
    } catch {
      // Not linked — default state is fine
    }
  }

  async linkWhatsApp(): Promise<void> {
    this.waLoading.set(true);
    this.waError.set('');
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<{ status: string; qr?: string }>>(
          `${API_URL}/whatsapp/link`,
          {},
        ),
      );
      if (res.success && res.data) {
        const status = res.data.status as any;
        this.waStatus.set(status);
        if (res.data.qr) {
          this.waQrDataUrl.set(res.data.qr);
        }
      }
    } catch (err: any) {
      this.waError.set(err?.error?.message ?? 'Failed to start WhatsApp linking.');
    } finally {
      this.waLoading.set(false);
    }
  }

  async unlinkWhatsApp(): Promise<void> {
    this.waLoading.set(true);
    this.waError.set('');
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<null>>(`${API_URL}/whatsapp/link`),
      );
      this.waStatus.set('none');
      this.waPhone.set(null);
      this.waQrDataUrl.set('');
    } catch (err: any) {
      this.waError.set(err?.error?.message ?? 'Failed to unlink WhatsApp.');
    } finally {
      this.waLoading.set(false);
    }
  }
}
