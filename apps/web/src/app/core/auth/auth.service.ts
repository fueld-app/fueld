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
  ApiResponse,
} from '@fueld/types';
import { firstValueFrom } from 'rxjs';
import { WebSocketService } from '../websocket/websocket.service';

// ═══════════════════════════════════════════════════════════════════════
//  Auth Service — JWT Token Management & User State
// ═══════════════════════════════════════════════════════════════════════

const API_URL = 'http://localhost:3000';
const ACCESS_TOKEN_KEY = 'fueld_access_token';
const REFRESH_TOKEN_KEY = 'fueld_refresh_token';
const USER_KEY = 'fueld_user';

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
  readonly userInitials = computed(() => {
    const name = this.user()?.name ?? '';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0]![0]!.toUpperCase();
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  });

  constructor(
    private readonly http: HttpClient,
    private readonly router: Router,
  ) {
    // Connect WebSocket on page reload if already authenticated
    if (this.isAuthenticated()) {
      const token = this.getAccessToken();
      if (token) {
        // Lazy-inject to avoid circular dependency timing issues
        setTimeout(() => this.wsService.connect(token), 0);
      }
    }
  }

  private readonly wsService = inject(WebSocketService);

  // ─── Token management ────────────────────────────────────────────

  getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  }

  private setTokens(tokens: AuthTokensDto): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    // Connect WebSocket with the new token
    this.wsService.connect(tokens.accessToken);
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
    } catch {
      this.logout();
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

  logout(): void {
    this.wsService.disconnect();
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.user.set(null);
    this.router.navigate(['/login']);
  }
}
