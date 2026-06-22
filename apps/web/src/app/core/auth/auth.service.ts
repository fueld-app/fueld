import { Service, signal, computed, inject, injectAsync, onIdle } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { Role } from '@fueld/types';
import type {
  UserDto,
  AuthTokensDto,
  LoginResponseDto,
  Login2faPendingDto,
  RegisterResponseDto,
  TwoFactorSetupDto,
  PasskeyDto,
  InviteAcceptResponseDto,
  ApiResponse,
} from '@fueld/types';
import { firstValueFrom } from 'rxjs';
import { WebSocketService } from '../websocket/websocket.service';

// ═══════════════════════════════════════════════════════════════════════
//  Auth Service — JWT Token Management & User State
// ═══════════════════════════════════════════════════════════════════════

import { API_URL } from '@app/core/config/api';
const USER_KEY = 'fueld_user';
const MFA_SETUP_REQUIRED_KEY = 'fueld_mfa_setup_required';

/** Refresh the access token 2 minutes before it expires (15m TTL → refresh at 13m). */
const REFRESH_INTERVAL_MS = 13 * 60 * 1000;

/** Map WebAuthn browser errors to user-friendly messages. */
function friendlyWebAuthnError(err: unknown, action: string): Error {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') {
      return new Error(`${action} was cancelled or timed out. Please try again.`);
    }
    if (err.name === 'SecurityError') {
      return new Error('Security error: the page origin is not allowed for passkey operations.');
    }
    if (err.name === 'AbortError') {
      return new Error(`${action} was cancelled.`);
    }
  }
  if (err instanceof Error) return err;
  return new Error(`${action} failed. Please try again.`);
}

@Service()
export class AuthService {
  /** Current user signal (null when logged out). */
  readonly user = signal<UserDto | null>(this.loadUser());

  /** Whether the user must complete MFA setup before accessing the app. */
  readonly mfaSetupRequired = signal(this.loadMfaSetupRequired());

  /** Computed convenience signals. */
  readonly isAuthenticated = computed(() => !!this.user());
  readonly userName = computed(() => this.user()?.name ?? '');
  readonly userEmail = computed(() => this.user()?.email ?? '');
  readonly userRole = computed(() => this.user()?.role ?? '');
  readonly isAdmin = computed(() => this.user()?.role === Role.Admin);
  readonly isFinance = computed(() => this.user()?.role === Role.Finance);
  readonly isTeamLead = computed(() => this.user()?.role === Role.Teamlead);
  readonly isCreditManager = computed(() => this.user()?.role === Role.CreditManager);
  readonly isLight = computed(() => this.user()?.role === Role.Light);
  readonly canAccessCredit = computed(() => this.isAdmin() || this.isCreditManager());
  readonly canAccessReports = computed(() => this.isAuthenticated());
  readonly canSeePrices = computed(() => !this.isLight());
  readonly userPhone = computed(() => this.user()?.phone ?? '');
  readonly avatarUrl = computed(() => {
    const url = this.user()?.avatarUrl;
    if (!url) return null;
    // Relative URLs need the API base
    return url.startsWith('http') ? url : `${API_URL}${url}`;
  });
  readonly userInitials = computed(() => {
    const name = this.user()?.name ?? '';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0]![0]!.toUpperCase();
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  });

  /** Timer handle for proactive token refresh. */
  private refreshTimerId: ReturnType<typeof setTimeout> | null = null;

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  constructor() {
    // On page reload, refresh the access token then connect WebSocket
    // Tokens are in HTTP-only cookies set by the server
    if (this.isAuthenticated()) {
      setTimeout(() => this.refreshAndConnectWs(), 0);
      setTimeout(() => this.checkMicrosoftSso(), 0);
    } else {
      this.setMfaSetupRequired(false);
    }
  }

  private readonly wsService = inject(WebSocketService);
  // Lazy-load the passkey (WebAuthn) service: @simplewebauthn/browser is heavy
  // and only needed during passkey sign-in / registration flows, so it is
  // moved to a lazily-loaded chunk (prefetched during idle time) instead of the
  // main entry bundle.
  private readonly passkeyService = injectAsync(
    () => import('./passkey.service').then((m) => m.PasskeyService),
    { prefetch: onIdle },
  );

  // Listen for force-logout events from the server (e.g. account deactivated by admin)
  private readonly forceLogoutSub = this.wsService
    .onRaw('force-logout')
    .subscribe((msg) => {
      console.warn('[Auth] Force logout received:', msg.message);
      this.logout();
      // Show alert after navigation completes
      setTimeout(() => {
        alert(msg.message || 'Your session has been terminated.');
      }, 100);
    });

  /** Refresh the access token, then open the WebSocket with the fresh token. */
  private async refreshAndConnectWs(): Promise<void> {
    await this.refreshToken();
    // refreshToken() calls afterAuthSuccess() which calls wsService.connect()
  }

  // ─── Token management ────────────────────────────────────────────

  /**
   * Called after a successful login/register/2FA/refresh.
   * Cookies are already set by the server — we just connect WS + schedule refresh.
   */
  private afterAuthSuccess(requiresMfaSetup?: boolean): void {
    this.wsService.connect();
    this.scheduleRefresh();
    if (requiresMfaSetup !== undefined) {
      this.setMfaSetupRequired(requiresMfaSetup);
    }
  }

  private setUser(user: UserDto): void {
    this.user.set(user);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  private setMfaSetupRequired(value: boolean): void {
    this.mfaSetupRequired.set(value);
    localStorage.setItem(MFA_SETUP_REQUIRED_KEY, value ? '1' : '0');
  }

  markMfaSetupRequired(): void {
    this.setMfaSetupRequired(true);
    if (!this.router.url.startsWith('/account/settings')) {
      void this.router.navigate(['/account/settings']);
    }
  }

  private loadUser(): UserDto | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as UserDto) : null;
    } catch {
      return null;
    }
  }

  private loadMfaSetupRequired(): boolean {
    return localStorage.getItem(MFA_SETUP_REQUIRED_KEY) === '1';
  }

  // ─── Proactive refresh timer ─────────────────────────────────────

  /** Schedule a silent token refresh before the access token expires. */
  private scheduleRefresh(): void {
    this.clearRefreshTimer();
    this.refreshTimerId = setTimeout(async () => {
      console.debug('[Auth] Proactive token refresh triggered');
      await this.refreshToken();
    }, REFRESH_INTERVAL_MS);
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimerId !== null) {
      clearTimeout(this.refreshTimerId);
      this.refreshTimerId = null;
    }
  }

  // ─── Auth API calls ──────────────────────────────────────────────

  async login(email: string, password: string): Promise<LoginResponseDto | Login2faPendingDto> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<LoginResponseDto | Login2faPendingDto>>(
        `${API_URL}/auth/login`,
        { email, password },
      ),
    );

    if (!res.success || !res.data) {
      throw new Error(res.message ?? 'Login failed');
    }

    const data = res.data;

    if (!data.requires2fa) {
      this.afterAuthSuccess(data.requiresMfaSetup);
      this.setUser(data.user);
      this.setMfaSetupRequired(!!data.requiresMfaSetup);
    } else {
      this.setMfaSetupRequired(false);
    }

    return data;
  }

  async register(email: string, password: string, name: string): Promise<RegisterResponseDto> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<RegisterResponseDto>>(`${API_URL}/auth/register`, {
        email,
        password,
        name,
      }),
    );

    this.afterAuthSuccess(false);
    this.setUser(res.data.user);
    return res.data;
  }

  async acceptInvite(token: string, password: string): Promise<InviteAcceptResponseDto> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<InviteAcceptResponseDto>>(
        `${API_URL}/invite/${token}/accept`,
        { password },
      ),
    );

    if (!res.success || !res.data) {
      throw new Error(res.message ?? 'Failed to accept invitation');
    }

    this.afterAuthSuccess(res.data.requiresMfaSetup);
    this.setUser(res.data.user);
    this.setMfaSetupRequired(!!res.data.requiresMfaSetup);
    return res.data;
  }

  async verify2fa(tempToken: string, code: string): Promise<LoginResponseDto> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<LoginResponseDto>>(`${API_URL}/auth/verify-2fa`, {
        tempToken,
        code,
      }),
    );

    if (!res.success || !res.data) {
      throw new Error(res.message ?? 'Invalid code. Please try again.');
    }

    const data = res.data as LoginResponseDto;
    this.afterAuthSuccess(data.requiresMfaSetup);
    this.setUser(data.user);
    this.setMfaSetupRequired(!!data.requiresMfaSetup);
    return data;
  }

  async refreshToken(): Promise<boolean> {
    // Refresh token is in the HTTP-only cookie — server reads it automatically
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<AuthTokensDto>>(`${API_URL}/auth/refresh`, {}),
      );

      if (!res.success || !res.data) {
        console.warn('[Auth] Refresh token rejected by server, logging out');
        this.logout();
        return false;
      }

      this.afterAuthSuccess(res.data.requiresMfaSetup);
      return true;
    } catch (err: any) {
      // Only logout on 401/403 (invalid token). Network errors (0, 502, etc.)
      // should NOT log the user out — the server may just be temporarily down.
      const status = err?.status ?? err?.error?.status ?? 0;
      if (status === 401 || status === 403) {
        this.logout();
      } else {
        console.warn('[Auth] Token refresh failed (network), will retry later');
        // Retry in 10 seconds if it was a network issue
        this.clearRefreshTimer();
        this.refreshTimerId = setTimeout(() => this.refreshToken(), 10_000);
      }
      return false;
    }
  }

  // ─── 2FA Setup ────────────────────────────────────────────────────

  /** Generate a TOTP secret + QR code for setup. Requires an active session. */
  async setup2fa(): Promise<TwoFactorSetupDto> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<TwoFactorSetupDto>>(
        `${API_URL}/auth/2fa/generate`,
        {},
      ),
    );

    if (!res.success || !res.data) {
      throw new Error(res.message ?? 'Failed to generate 2FA secret');
    }

    return res.data;
  }

  /** Verify the first TOTP code and enable 2FA on the account. */
  async enable2fa(code: string): Promise<void> {

    const res = await firstValueFrom(
      this.http.post<ApiResponse<null>>(
        `${API_URL}/auth/2fa/enable`,
        { code },
      ),
    );

    if (!res.success) {
      throw new Error(res.message ?? 'Failed to enable 2FA');
    }

    // Update the local user state to reflect 2FA being enabled
    const currentUser = this.user();
    if (currentUser) {
      this.setUser({ ...currentUser, is2faEnabled: true });
    }
    this.setMfaSetupRequired(false);
  }

  /** Verify a TOTP code and disable 2FA on the account. */
  async disable2fa(code: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<null>>(
        `${API_URL}/auth/2fa/disable`,
        { code },
      ),
    );

    if (!res.success) {
      throw new Error(res.message ?? 'Failed to disable 2FA');
    }

    // Update the local user state
    const currentUser = this.user();
    if (currentUser) {
      this.setUser({ ...currentUser, is2faEnabled: false });
    }
  }

  // ─── Profile ────────────────────────────────────────────────────────

  /** Update the current user's phone number. */
  async updatePhone(phone: string | null): Promise<void> {
    const res = await firstValueFrom(
      this.http.patch<ApiResponse<{ user: UserDto }>>(
        `${API_URL}/auth/phone`,
        { phone },
      ),
    );

    if (!res.success || !res.data) {
      throw new Error(res.message ?? 'Failed to update phone');
    }

    this.setUser(res.data.user);
  }

  // ─── Passkey Authentication ─────────────────────────────────────────

  /** Passwordless login using a registered passkey (real WebAuthn).
   * If email is provided, narrows the challenge to that user's credentials.
   * If omitted, uses discoverable credentials (browser picks the identity). */
  async loginWithPasskey(email?: string): Promise<LoginResponseDto> {
    // Step 1: Get authentication options (challenge) from server
    const optionsRes = await firstValueFrom(
      this.http.post<ApiResponse<{ options: any; sessionId: string }>>(
        `${API_URL}/auth/passkeys/auth-options`,
        // Only send email if provided (for discoverable flow, omit it)
        email ? { email } : {},
      ),
    );

    if (!optionsRes.success || !optionsRes.data) {
      throw new Error(optionsRes.message ?? 'Failed to get passkey options');
    }

    const { options, sessionId } = optionsRes.data;

    // Step 2: Trigger the browser's WebAuthn prompt (biometric / security key)
    let assertionResponse;
    try {
      const passkey = await this.passkeyService();
      assertionResponse = await passkey.startAuthentication(options);
    } catch (err) {
      throw friendlyWebAuthnError(err, 'Passkey sign-in');
    }

    // Step 3: Send assertion to server for verification
    const res = await firstValueFrom(
      this.http.post<ApiResponse<LoginResponseDto>>(
        `${API_URL}/auth/login/passkey`,
        { email, assertionResponse, sessionId },
      ),
    );

    if (!res.success || !res.data) {
      throw new Error(res.message ?? 'Passkey login failed');
    }

    const data = res.data as LoginResponseDto;
    this.afterAuthSuccess(data.requiresMfaSetup);
    this.setUser(data.user);
    this.setMfaSetupRequired(false);
    return data;
  }

  /** Complete 2FA using a passkey instead of TOTP code (real WebAuthn). */
  async verify2faWithPasskey(tempToken: string): Promise<LoginResponseDto> {
    // Step 1: Get authentication options (challenge) from server
    const optionsRes = await firstValueFrom(
      this.http.post<ApiResponse<{ options: any; sessionId: string }>>(
        `${API_URL}/auth/passkeys/auth-options-2fa`,
        { tempToken },
      ),
    );

    if (!optionsRes.success || !optionsRes.data) {
      throw new Error(optionsRes.message ?? 'Failed to get passkey options');
    }

    const { options, sessionId } = optionsRes.data;

    // Step 2: Trigger the browser's WebAuthn prompt (biometric / security key)
    let assertionResponse;
    try {
      const passkey = await this.passkeyService();
      assertionResponse = await passkey.startAuthentication(options);
    } catch (err) {
      throw friendlyWebAuthnError(err, 'Passkey verification');
    }

    // Step 3: Send assertion + tempToken to server for verification
    const res = await firstValueFrom(
      this.http.post<ApiResponse<LoginResponseDto>>(
        `${API_URL}/auth/verify-passkey`,
        { tempToken, assertionResponse, sessionId },
      ),
    );

    if (!res.success || !res.data) {
      throw new Error(res.message ?? 'Passkey verification failed');
    }

    const data = res.data as LoginResponseDto;
    this.afterAuthSuccess(data.requiresMfaSetup);
    this.setUser(data.user);
    this.setMfaSetupRequired(false);
    return data;
  }

  // ─── Passkey Management ────────────────────────────────────────────

  /** List all passkeys for the current user. */
  async listPasskeys(): Promise<PasskeyDto[]> {

    const res = await firstValueFrom(
      this.http.get<ApiResponse<PasskeyDto[]>>(`${API_URL}/auth/passkeys`),
    );
    if (!res.success) throw new Error(res.message ?? 'Failed to list passkeys');
    return res.data ?? [];
  }

  /** Register a new passkey with real WebAuthn attestation. */
  async registerPasskey(friendlyName: string): Promise<PasskeyDto> {

    // Step 1: Get registration options (challenge) from server
    const optionsRes = await firstValueFrom(
      this.http.post<ApiResponse<any>>(
        `${API_URL}/auth/passkeys/register-options`,
        {},
      ),
    );
    if (!optionsRes.success || !optionsRes.data) {
      throw new Error(optionsRes.message ?? 'Failed to get registration options');
    }

    // Step 2: Trigger the browser's WebAuthn prompt (create credential)
    let attestationResponse;
    try {
      const passkey = await this.passkeyService();
      attestationResponse = await passkey.startRegistration(optionsRes.data);
    } catch (err) {
      throw friendlyWebAuthnError(err, 'Passkey registration');
    }

    // Step 3: Send attestation to server for verification and storage
    const res = await firstValueFrom(
      this.http.post<ApiResponse<PasskeyDto>>(
        `${API_URL}/auth/passkeys/register-verify`,
        { friendlyName, attestationResponse },
      ),
    );
    if (!res.success || !res.data) throw new Error(res.message ?? 'Failed to register passkey');
    this.setMfaSetupRequired(false);
    return res.data;
  }

  /** Rename a passkey. */
  async renamePasskey(id: string, friendlyName: string): Promise<void> {

    const res = await firstValueFrom(
      this.http.put<ApiResponse<null>>(
        `${API_URL}/auth/passkeys/${id}`,
        { friendlyName },
      ),
    );
    if (!res.success) throw new Error(res.message ?? 'Failed to rename passkey');
  }

  /** Delete a passkey. */
  async deletePasskey(id: string): Promise<void> {

    const res = await firstValueFrom(
      this.http.delete<ApiResponse<null>>(
        `${API_URL}/auth/passkeys/${id}`,
      ),
    );
    if (!res.success) throw new Error(res.message ?? 'Failed to delete passkey');
  }

  // ─── Microsoft SSO Login ──────────────────────────────────────────

  /** Signal: whether Microsoft SSO is enabled for this tenant. */
  readonly microsoftSsoAvailable = signal(false);

  /**
   * Check if Microsoft SSO is available by querying the public SSO config endpoint.
   */
  async checkMicrosoftSso(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: { ssoProvider: string; ssoEnabled: boolean } }>(
          `${API_URL}/auth/sso-config`,
        ),
      );
      if (res.success && res.data?.ssoProvider === 'microsoft' && res.data?.ssoEnabled) {
        this.microsoftSsoAvailable.set(true);
      }
    } catch {
      // SSO config not available — that's fine, Microsoft login will be hidden
    }
  }

  /** Whether Microsoft SSO is available and enabled. */
  get isMicrosoftSsoAvailable(): boolean {
    return this.microsoftSsoAvailable();
  }

  /**
   * Initiate Microsoft login by redirecting to the backend OAuth endpoint.
   * The backend will redirect to Microsoft, then back to the returnUrl
   * with a one-time code.
   */
  loginWithMicrosoft(returnUrl: string): void {
    const loginUrl = `${API_URL}/auth/microsoft/login?returnUrl=${encodeURIComponent(returnUrl)}`;
    window.location.href = loginUrl;
  }

  /**
   * Exchange a one-time Microsoft auth code for Fueld JWT tokens.
   * Called by the login page when it detects ?microsoft_code=... in the URL.
   */
  async exchangeMicrosoftCode(code: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<LoginResponseDto>>(
        `${API_URL}/auth/microsoft/exchange`,
        { code },
      ),
    );

    if (!res.success || !res.data) {
      throw new Error(res.message ?? 'Microsoft SSO login failed');
    }

    const data = res.data;
    this.afterAuthSuccess(data.requiresMfaSetup);
    this.setUser(data.user);
    this.setMfaSetupRequired(false);
  }

  logout(): void {
    this.clearRefreshTimer();
    this.wsService.disconnect();
    // Call the API to clear cookies server-side (fire and forget)
    this.http.post(`${API_URL}/auth/logout`, {}).subscribe({
      error: () => { /* cookie clearing is best-effort */ },
      complete: () => {},
    });
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(MFA_SETUP_REQUIRED_KEY);
    this.user.set(null);
    this.mfaSetupRequired.set(false);
    this.router.navigate(['/login']);
  }
}
