import { Injectable, signal, computed, inject } from '@angular/core';
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
  ApiResponse,
} from '@fueld/types';
import { firstValueFrom } from 'rxjs';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { WebSocketService } from '../websocket/websocket.service';

// ═══════════════════════════════════════════════════════════════════════
//  Auth Service — JWT Token Management & User State
// ═══════════════════════════════════════════════════════════════════════

import { API_URL } from '@app/core/config/api';
const ACCESS_TOKEN_KEY = 'fueld_access_token';
const REFRESH_TOKEN_KEY = 'fueld_refresh_token';
const USER_KEY = 'fueld_user';

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

@Injectable({ providedIn: 'root' })
export class AuthService {
  /** Current user signal (null when logged out). */
  readonly user = signal<UserDto | null>(this.loadUser());

  /** Computed convenience signals. */
  readonly isAuthenticated = computed(() => !!this.user());
  readonly userName = computed(() => this.user()?.name ?? '');
  readonly userEmail = computed(() => this.user()?.email ?? '');
  readonly userRole = computed(() => this.user()?.role ?? '');
  readonly isAdmin = computed(() => this.user()?.role === Role.Admin);
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

  constructor(
    private readonly http: HttpClient,
    private readonly router: Router,
  ) {
    // On page reload, refresh the access token then connect WebSocket
    // Only if we have both a user AND a refresh token (not just stale user data)
    const hasRefreshToken = !!localStorage.getItem(REFRESH_TOKEN_KEY);
    if (this.isAuthenticated() && hasRefreshToken) {
      setTimeout(() => this.refreshAndConnectWs(), 0);
    } else if (this.isAuthenticated() && !hasRefreshToken) {
      // Stale user data without tokens — clean up silently
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      this.user.set(null);
    }
  }

  private readonly wsService = inject(WebSocketService);

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
    // refreshToken() calls setTokens() which calls wsService.connect()
  }

  // ─── Token management ────────────────────────────────────────────

  getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  }

  private setTokens(tokens: AuthTokensDto): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    // Connect WebSocket with the new token
    this.wsService.connect(tokens.accessToken);
    // Schedule proactive refresh before the access token expires
    this.scheduleRefresh();
  }

  private setUser(user: UserDto): void {
    this.user.set(user);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  private loadUser(): UserDto | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as UserDto) : null;
    } catch {
      return null;
    }
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
      this.setTokens(data);
      this.setUser(data.user);
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

    this.setTokens(res.data);
    this.setUser(res.data.user);
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
    this.setTokens(data);
    this.setUser(data.user);
    return data;
  }

  async refreshToken(): Promise<boolean> {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return false;

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<AuthTokensDto>>(`${API_URL}/auth/refresh`, {
          refreshToken,
        }),
      );

      this.setTokens(res.data);
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
    const token = this.getAccessToken();
    if (!token) throw new Error('Not authenticated. Please log in again.');

    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

    const res = await firstValueFrom(
      this.http.post<ApiResponse<TwoFactorSetupDto>>(
        `${API_URL}/auth/2fa/generate`,
        {},
        { headers },
      ),
    );

    if (!res.success || !res.data) {
      throw new Error(res.message ?? 'Failed to generate 2FA secret');
    }

    return res.data;
  }

  /** Verify the first TOTP code and enable 2FA on the account. */
  async enable2fa(code: string): Promise<void> {
    const token = this.getAccessToken();
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

    const res = await firstValueFrom(
      this.http.post<ApiResponse<null>>(
        `${API_URL}/auth/2fa/enable`,
        { code },
        { headers },
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
  }

  /** Verify a TOTP code and disable 2FA on the account. */
  async disable2fa(code: string): Promise<void> {
    const token = this.getAccessToken();
    if (!token) throw new Error('Not authenticated. Please log in again.');

    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

    const res = await firstValueFrom(
      this.http.post<ApiResponse<null>>(
        `${API_URL}/auth/2fa/disable`,
        { code },
        { headers },
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

  // ─── Passkey Authentication ─────────────────────────────────────────

  /** Passwordless login using a registered passkey (real WebAuthn). */
  async loginWithPasskey(email: string): Promise<LoginResponseDto> {
    // Step 1: Get authentication options (challenge) from server
    const optionsRes = await firstValueFrom(
      this.http.post<ApiResponse<any>>(
        `${API_URL}/auth/passkeys/auth-options`,
        { email },
      ),
    );

    if (!optionsRes.success || !optionsRes.data) {
      throw new Error(optionsRes.message ?? 'Failed to get passkey options');
    }

    // Step 2: Trigger the browser's WebAuthn prompt (biometric / security key)
    let assertionResponse;
    try {
      assertionResponse = await startAuthentication({ optionsJSON: optionsRes.data });
    } catch (err) {
      throw friendlyWebAuthnError(err, 'Passkey sign-in');
    }

    // Step 3: Send assertion to server for verification
    const res = await firstValueFrom(
      this.http.post<ApiResponse<LoginResponseDto>>(
        `${API_URL}/auth/login/passkey`,
        { email, assertionResponse },
      ),
    );

    if (!res.success || !res.data) {
      throw new Error(res.message ?? 'Passkey login failed');
    }

    const data = res.data as LoginResponseDto;
    this.setTokens(data);
    this.setUser(data.user);
    return data;
  }

  /** Complete 2FA using a passkey instead of TOTP code (real WebAuthn). */
  async verify2faWithPasskey(tempToken: string): Promise<LoginResponseDto> {
    // Step 1: Get authentication options (challenge) from server
    const optionsRes = await firstValueFrom(
      this.http.post<ApiResponse<any>>(
        `${API_URL}/auth/passkeys/auth-options-2fa`,
        { tempToken },
      ),
    );

    if (!optionsRes.success || !optionsRes.data) {
      throw new Error(optionsRes.message ?? 'Failed to get passkey options');
    }

    // Step 2: Trigger the browser's WebAuthn prompt (biometric / security key)
    let assertionResponse;
    try {
      assertionResponse = await startAuthentication({ optionsJSON: optionsRes.data });
    } catch (err) {
      throw friendlyWebAuthnError(err, 'Passkey verification');
    }

    // Step 3: Send assertion + tempToken to server for verification
    const res = await firstValueFrom(
      this.http.post<ApiResponse<LoginResponseDto>>(
        `${API_URL}/auth/verify-passkey`,
        { tempToken, assertionResponse },
      ),
    );

    if (!res.success || !res.data) {
      throw new Error(res.message ?? 'Passkey verification failed');
    }

    const data = res.data as LoginResponseDto;
    this.setTokens(data);
    this.setUser(data.user);
    return data;
  }

  // ─── Passkey Management ────────────────────────────────────────────

  /** List all passkeys for the current user. */
  async listPasskeys(): Promise<PasskeyDto[]> {
    const token = this.getAccessToken();
    if (!token) throw new Error('Not authenticated.');
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

    const res = await firstValueFrom(
      this.http.get<ApiResponse<PasskeyDto[]>>(`${API_URL}/auth/passkeys`, { headers }),
    );
    if (!res.success) throw new Error(res.message ?? 'Failed to list passkeys');
    return res.data ?? [];
  }

  /** Register a new passkey with real WebAuthn attestation. */
  async registerPasskey(friendlyName: string): Promise<PasskeyDto> {
    const token = this.getAccessToken();
    if (!token) throw new Error('Not authenticated.');
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

    // Step 1: Get registration options (challenge) from server
    const optionsRes = await firstValueFrom(
      this.http.post<ApiResponse<any>>(
        `${API_URL}/auth/passkeys/register-options`,
        {},
        { headers },
      ),
    );
    if (!optionsRes.success || !optionsRes.data) {
      throw new Error(optionsRes.message ?? 'Failed to get registration options');
    }

    // Step 2: Trigger the browser's WebAuthn prompt (create credential)
    let attestationResponse;
    try {
      attestationResponse = await startRegistration({ optionsJSON: optionsRes.data });
    } catch (err) {
      throw friendlyWebAuthnError(err, 'Passkey registration');
    }

    // Step 3: Send attestation to server for verification and storage
    const res = await firstValueFrom(
      this.http.post<ApiResponse<PasskeyDto>>(
        `${API_URL}/auth/passkeys/register-verify`,
        { friendlyName, attestationResponse },
        { headers },
      ),
    );
    if (!res.success || !res.data) throw new Error(res.message ?? 'Failed to register passkey');
    return res.data;
  }

  /** Rename a passkey. */
  async renamePasskey(id: string, friendlyName: string): Promise<void> {
    const token = this.getAccessToken();
    if (!token) throw new Error('Not authenticated.');
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

    const res = await firstValueFrom(
      this.http.put<ApiResponse<null>>(
        `${API_URL}/auth/passkeys/${id}`,
        { friendlyName },
        { headers },
      ),
    );
    if (!res.success) throw new Error(res.message ?? 'Failed to rename passkey');
  }

  /** Delete a passkey. */
  async deletePasskey(id: string): Promise<void> {
    const token = this.getAccessToken();
    if (!token) throw new Error('Not authenticated.');
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

    const res = await firstValueFrom(
      this.http.delete<ApiResponse<null>>(
        `${API_URL}/auth/passkeys/${id}`,
        { headers },
      ),
    );
    if (!res.success) throw new Error(res.message ?? 'Failed to delete passkey');
  }

  logout(): void {
    this.clearRefreshTimer();
    this.wsService.disconnect();
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.user.set(null);
    this.router.navigate(['/login']);
  }
}
