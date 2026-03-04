import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

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
    .hero-bg {
      background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 40%, #1a56db 70%, #3b82f6 100%);
      background-size: 300% 300%;
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
      background: rgba(255,255,255,0.08);
      animation: float-up linear infinite;
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
            <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clip-rule="evenodd" />
              </svg>
            </div>
            <span class="text-xl font-bold tracking-tight text-white">Fueld</span>
          </div>
        </div>

        <div class="relative z-10 p-12">
          <blockquote class="max-w-md">
            <p class="text-2xl font-semibold leading-snug text-white/90">
              "Streamline your bunker trades from inquiry to invoice — all in one place."
            </p>
            <footer class="mt-6 flex items-center gap-3">
              <div class="h-px w-8 bg-white/30"></div>
              <span class="text-sm font-medium text-white/50">Bunker Trading SaaS</span>
            </footer>
          </blockquote>
        </div>
      </div>

      <!-- Right form panel -->
      <div class="flex w-full items-center justify-center bg-gray-50 px-6 lg:w-1/2">
        <div class="w-full max-w-md">
          <!-- Mobile brand (hidden on desktop) -->
          <div class="mb-8 text-center lg:hidden">
            <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-white" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clip-rule="evenodd" />
              </svg>
            </div>
          </div>

          <div class="mb-8">
            <h1 class="text-2xl font-bold text-gray-900">Welcome back</h1>
            <p class="mt-2 text-sm text-gray-500">Sign in to your account to continue</p>
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
                <label for="email" class="block text-sm font-medium text-gray-700">Email</label>
                <input
                  id="email"
                  type="email"
                  autocomplete="email"
                  [(ngModel)]="email"
                  name="email"
                  required
                  class="mt-1.5 block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  placeholder="you@company.com"
                />
              </div>
              <div>
                <label for="password" class="block text-sm font-medium text-gray-700">Password</label>
                <input
                  id="password"
                  type="password"
                  autocomplete="current-password"
                  [(ngModel)]="password"
                  name="password"
                  required
                  class="mt-1.5 block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit"
                [disabled]="loading()"
                class="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                  <div class="w-full border-t border-gray-200"></div>
                </div>
                <div class="relative flex justify-center text-sm">
                  <span class="bg-white px-3 text-gray-500">or continue with</span>
                </div>
              </div>
              <div class="mt-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  [disabled]="microsoftLoading() || !microsoftAvailable()"
                  (click)="onMicrosoftLogin()"
                  class="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
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
                  class="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg class="h-5 w-5 text-gray-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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

          <p class="mt-8 text-center text-xs text-gray-400">
            &copy; {{ currentYear }} Fueld &middot; All rights reserved
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

  email = '';
  password = '';
  readonly loading = signal(false);
  readonly passkeyLoading = signal(false);
  readonly microsoftLoading = signal(false);
  readonly microsoftAvailable = signal(false);
  readonly errorMessage = signal('');
  readonly currentYear = new Date().getFullYear();

  constructor() {
    // Load SSO config to determine if Microsoft login is available
    this.auth.initMsal().then(() => {
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
    if (!this.email) {
      this.errorMessage.set('Please enter your email to sign in with a passkey.');
      return;
    }

    this.passkeyLoading.set(true);
    this.errorMessage.set('');

    try {
      await this.auth.loginWithPasskey(this.email);
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

    try {
      await this.auth.loginWithMicrosoft();
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
