import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import {
  AppHealthService,
  formatAppVersionLabel,
} from '../../core/runtime/app-health.service';

@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  styles: `
    @keyframes drift {
      0%   { background-position: 0% 50%; }
      50%  { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    /* Brand re-skin: dark navy + amber glow (matches marketing site + app icons) */
    .hero-bg {
      background:
        radial-gradient(55% 45% at 18% 0%, rgba(245, 158, 11, 0.16), transparent 62%),
        radial-gradient(40% 35% at 90% 100%, rgba(249, 115, 22, 0.08), transparent 60%),
        linear-gradient(160deg, #06080d 0%, #0b101b 45%, #0f1421 100%);
      background-size: 100% 100%, 100% 100%, 300% 300%;
      animation: drift 20s ease-in-out infinite;
    }
    @keyframes float-up {
      0%   { transform: translateY(100vh) scale(0); opacity: 0; }
      10%  { opacity: 0.12; }
      90%  { opacity: 0.06; }
      100% { transform: translateY(-20vh) scale(1); opacity: 0; }
    }
    .bubble {
      position: absolute;
      border-radius: 50%;
      background: rgba(245, 158, 11, 0.09);
      box-shadow: inset 0 0 12px rgba(245, 158, 11, 0.12);
      animation: float-up linear infinite;
    }
    .brand-glyph {
      display: grid;
      place-items: center;
      width: 3rem;
      height: 3rem;
      border-radius: 0.55rem;
      background: linear-gradient(135deg, #f59e0b 0%, #fb923c 60%, #f97316 100%);
      color: #1a1208;
      font-weight: 800;
      font-size: 1.35rem;
      font-family: var(--font-display, system-ui);
      letter-spacing: -0.02em;
      box-shadow: 0 6px 20px -4px rgba(245, 158, 11, 0.55);
    }
    .btn-signin {
      background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%);
      color: #1a1208;
      transition: box-shadow 0.15s ease, transform 0.15s ease, filter 0.15s ease;
    }
    .btn-signin:hover:not(:disabled) {
      filter: brightness(1.06);
      box-shadow: 0 8px 24px -8px rgba(245, 158, 11, 0.65);
    }
    .btn-signin:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.4);
    }
  `,
  template: `
    <div class="flex min-h-screen">
      <!-- Left hero panel -->
      <div class="hero-bg relative hidden w-1/2 overflow-hidden lg:flex lg:flex-col lg:justify-between">
        <!-- Floating bubbles -->
        <div class="bubble left-[10%] bottom-0 h-16 w-16" style="animation-duration:14s;animation-delay:0s"></div>
        <div class="bubble left-[25%] bottom-0 h-24 w-24" style="animation-duration:18s;animation-delay:2s"></div>
        <div class="bubble left-[55%] bottom-0 h-12 w-12" style="animation-duration:12s;animation-delay:5s"></div>
        <div class="bubble left-[75%] bottom-0 h-20 w-20" style="animation-duration:16s;animation-delay:1s"></div>
        <div class="bubble left-[40%] bottom-0 h-28 w-28" style="animation-duration:22s;animation-delay:4s"></div>
        <div class="bubble left-[85%] bottom-0 h-10 w-10" style="animation-duration:10s;animation-delay:7s"></div>

        <!-- Wave SVG at bottom -->
        <svg class="absolute bottom-0 left-0 w-full" viewBox="0 0 1440 200" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0,120 C360,200 720,40 1080,120 C1260,160 1380,100 1440,120 L1440,200 L0,200 Z" fill="rgba(255,255,255,0.04)" />
          <path d="M0,140 C240,80 480,180 720,120 C960,60 1200,160 1440,100 L1440,200 L0,200 Z" fill="rgba(255,255,255,0.03)" />
        </svg>

        <!-- Content -->
        <div class="relative z-10 p-12">
          <div class="flex items-center gap-3">
            <div class="brand-glyph" aria-hidden="true">F</div>
            <span class="text-xl font-bold tracking-tight text-white">Fueld</span>
          </div>
        </div>

        <div class="relative z-10 flex-1 flex items-center px-12">
          <ul class="max-w-md space-y-4" aria-label="Product highlights">
            <li class="flex items-start gap-3">
              <svg class="mt-0.5 h-4 w-4 shrink-0 text-amber-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l6.3-6.3a1 1 0 011.4 0z" clip-rule="evenodd" /></svg>
              <span class="text-sm leading-relaxed text-white/70">Run the deal from RFQ to BDN — quotes, credit, documents, delivery.</span>
            </li>
            <li class="flex items-start gap-3">
              <svg class="mt-0.5 h-4 w-4 shrink-0 text-amber-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l6.3-6.3a1 1 0 011.4 0z" clip-rule="evenodd" /></svg>
              <span class="text-sm leading-relaxed text-white/70">Sanctions screening and ledger reconciliation built in.</span>
            </li>
            <li class="flex items-start gap-3">
              <svg class="mt-0.5 h-4 w-4 shrink-0 text-amber-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l6.3-6.3a1 1 0 011.4 0z" clip-rule="evenodd" /></svg>
              <span class="text-sm leading-relaxed text-white/70">Dedicated deployment — your data never leaves your control.</span>
            </li>
          </ul>
        </div>

        <div class="relative z-10 p-12">
          <blockquote class="max-w-md">
            <p class="text-2xl font-semibold leading-snug text-white/90">
              "Streamline your bunker trades from inquiry to invoice — all in one place."
            </p>
            <footer class="mt-6 flex items-center gap-3">
              <div class="h-px w-8 bg-amber-400/60"></div>
              <span class="text-sm font-medium text-white/50">Bunker Trading SaaS</span>
            </footer>
          </blockquote>
        </div>
      </div>

      <!-- Right form panel -->
      <div class="flex w-full items-center justify-center bg-gray-50 dark:bg-bg-2 px-6 lg:w-1/2">
        <div class="w-full max-w-md">
          <!-- Mobile brand (hidden on desktop) -->
          <div class="mb-8 text-center lg:hidden">
            <div class="mx-auto flex items-center justify-center gap-2.5">
              <div class="brand-glyph !h-11 !w-11 !rounded-xl !text-lg" aria-hidden="true">F</div>
              <span class="text-xl font-bold tracking-tight text-gray-900 dark:text-ink">Fueld</span>
            </div>
          </div>

          <div class="mb-8">
            <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Welcome back</h1>
            <p class="mt-2 text-sm text-gray-500 dark:text-muted">Sign in to your account to continue</p>
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
                <label for="email" class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Email</label>
                <input
                  id="email"
                  type="email"
                  autocomplete="email"
                  [(ngModel)]="email"
                  name="email"
                  required
                  class="mt-1.5 block w-full rounded-lg border border-gray-300 dark:border-line-strong px-3.5 py-2.5 text-sm shadow-sm placeholder:text-gray-400 dark:placeholder:text-muted focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="you@company.com"
                />
              </div>
              <div>
                <label for="password" class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Password</label>
                <input
                  id="password"
                  type="password"
                  autocomplete="current-password"
                  [(ngModel)]="password"
                  name="password"
                  required
                  class="mt-1.5 block w-full rounded-lg border border-gray-300 dark:border-line-strong px-3.5 py-2.5 text-sm shadow-sm placeholder:text-gray-400 dark:placeholder:text-muted focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit"
                [disabled]="loading()"
                class="btn-signin w-full rounded-lg px-4 py-2.5 text-sm font-bold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                @if (loading()) {
                  <span class="inline-flex items-center gap-2">
                    <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Signing in…
                  </span>
                } @else {
                  Sign in
                }
              </button>
            </form>

            <div class="mt-6">
              <div class="relative">
                <div class="absolute inset-0 flex items-center">
                  <div class="w-full border-t border-gray-200 dark:border-line"></div>
                </div>
                <div class="relative flex justify-center text-sm">
                  <span class="bg-white dark:bg-surface px-3 text-gray-500 dark:text-muted">or continue with</span>
                </div>
              </div>
              <div class="mt-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  [disabled]="microsoftLoading() || !microsoftAvailable()"
                  (click)="onMicrosoftLogin()"
                  class="flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-ink-dim shadow-sm transition-all hover:bg-gray-50 dark:hover:bg-surface-tint hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg class="h-5 w-5" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                  </svg>
                  @if (microsoftLoading()) {
                    Signing in…
                  } @else {
                    Microsoft
                  }
                </button>
                <button
                  type="button"
                  [disabled]="passkeyLoading()"
                  (click)="onPasskeyLogin()"
                  class="flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-ink-dim shadow-sm transition-all hover:bg-gray-50 dark:hover:bg-surface-tint hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg class="h-5 w-5 text-gray-500 dark:text-muted" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z" />
                    <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
                  </svg>
                  @if (passkeyLoading()) {
                    Verifying…
                  } @else {
                    Passkey
                  }
                </button>
              </div>
            </div>
          </div>

          <p class="mt-8 text-center text-xs text-gray-400 dark:text-muted">
            &copy; {{ currentYear }} Fueld &middot; All rights reserved
          </p>
          <p class="mt-2 text-center text-xs text-gray-400 dark:text-muted" [title]="versionLabel()">
            {{ versionLabel() }}
          </p>
        </div>
      </div>
    </div>
  `,
})
export class LoginPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly appHealth = inject(AppHealthService);

  email = '';
  password = '';
  readonly loading = signal(false);
  readonly passkeyLoading = signal(false);
  readonly microsoftLoading = signal(false);
  readonly microsoftAvailable = signal(false);
  readonly errorMessage = signal('');
  readonly currentYear = new Date().getFullYear();
  readonly versionLabel = computed(() => formatAppVersionLabel(this.appHealth.health()));

  constructor() {
    void this.appHealth.refresh();

    // Check if we're returning from a Microsoft OAuth redirect
    const microsoftCode = this.route.snapshot.queryParamMap.get('microsoft_code');
    const microsoftError = this.route.snapshot.queryParamMap.get('microsoft_error');

    if (microsoftCode) {
      this.handleMicrosoftCallback(microsoftCode);
    } else if (microsoftError) {
      this.errorMessage.set(microsoftError);
    }

    // Check if Microsoft SSO is available for this tenant
    this.auth.checkMicrosoftSso().then(() => {
      this.microsoftAvailable.set(this.auth.isMicrosoftSsoAvailable);
    });
  }

  /** URL to redirect to after successful login. */
  private get returnUrl(): string {
    return this.route.snapshot.queryParamMap.get('returnUrl') || '/';
  }

  async onSubmit(): Promise<void> {
    if (!this.email || !this.password) {
      this.errorMessage.set('Please enter your email and password.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    try {
      const result = await this.auth.login(this.email, this.password);

      if (result.requires2fa) {
        await this.router.navigate(['/login/2fa'], {
          state: {
            tempToken: result.tempToken,
            hasPasskeys: result.hasPasskeys ?? false,
            returnUrl: this.returnUrl,
          },
        });
        return;
      }

      if (result.requiresMfaSetup) {
        await this.router.navigate(['/account/settings'], {
          state: { returnUrl: this.returnUrl },
        });
        return;
      }

      await this.router.navigateByUrl(this.returnUrl);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Login failed. Please try again.';
      this.errorMessage.set(msg);
    } finally {
      this.loading.set(false);
    }
  }

  async onPasskeyLogin(): Promise<void> {
    // If user has entered an email, pass it to narrow the credential list.
    // If not, use discoverable credentials (browser handles identity resolution).
    this.passkeyLoading.set(true);
    this.errorMessage.set('');

    try {
      await this.auth.loginWithPasskey(this.email || undefined);
      await this.router.navigateByUrl(this.returnUrl);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Passkey login failed. Please try again.';
      this.errorMessage.set(msg);
    } finally {
      this.passkeyLoading.set(false);
    }
  }

  async onMicrosoftLogin(): Promise<void> {
    this.microsoftLoading.set(true);
    this.errorMessage.set('');

    // Redirect to the backend, which redirects to Microsoft.
    // Microsoft will redirect back to /auth/microsoft/callback,
    // which then redirects here with ?microsoft_code=...
    const returnUrl = window.location.origin + '/login' +
      (this.returnUrl !== '/' ? `?returnUrl=${encodeURIComponent(this.returnUrl)}` : '');
    this.auth.loginWithMicrosoft(returnUrl);
    // Page will navigate away — no need to reset loading
  }

  private async handleMicrosoftCallback(code: string): Promise<void> {
    this.microsoftLoading.set(true);
    this.errorMessage.set('');

    try {
      await this.auth.exchangeMicrosoftCode(code);
      await this.router.navigateByUrl(this.returnUrl);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Microsoft login failed. Please try again.';
      this.errorMessage.set(msg);
    } finally {
      this.microsoftLoading.set(false);
    }
  }
}
