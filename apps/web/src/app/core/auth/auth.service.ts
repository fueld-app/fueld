import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import type {
  UserDto,
  AuthTokensDto,
  LoginResponseDto,
  Login2faPendingDto,
  RegisterResponseDto,
  ApiResponse,
} from '@fueld/types';
import { firstValueFrom } from 'rxjs';

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
  ) {}

  // ─── Token management ────────────────────────────────────────────

  getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  }

  private setTokens(tokens: AuthTokensDto): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
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

  logout(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.user.set(null);
    this.router.navigate(['/login']);
  }
}
