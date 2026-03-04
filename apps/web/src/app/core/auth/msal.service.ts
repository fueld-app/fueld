import { Injectable, signal, computed } from '@angular/core';
import {
  PublicClientApplication,
  type Configuration,
  type AccountInfo,
  type AuthenticationResult,
  type SilentRequest,
  InteractionRequiredAuthError,
  BrowserAuthError,
} from '@azure/msal-browser';

// ═══════════════════════════════════════════════════════════════════════
//  MSAL Service — Microsoft Graph token acquisition
// ═══════════════════════════════════════════════════════════════════════
//
// Initialises MSAL from the tenant's SSO config (fetched from the API)
// and provides methods to:
//   1. Login with Microsoft popup → returns an access token for `User.Read`
//   2. Acquire a `Mail.Send` token silently (or via popup if consent needed)
//
// The service is lazy — MSAL is only initialised when SSO config is
// present and the user calls `init()`.
// ═══════════════════════════════════════════════════════════════════════

/** Scopes needed for SSO login (reading the user profile). */
const LOGIN_SCOPES = ['User.Read'];

/** Scopes needed for sending email via Microsoft Graph. */
const MAIL_SEND_SCOPES = ['Mail.Send'];

export interface SsoConfig {
  ssoProvider: string;
  ssoClientId: string;
  ssoTenantId: string;
  ssoEnabled: boolean;
}

@Injectable({ providedIn: 'root' })
export class MsalService {
  private msalInstance: PublicClientApplication | null = null;

  /** Whether MSAL has been initialised with valid SSO config. */
  readonly ready = signal(false);

  /** Whether Microsoft SSO is available (config loaded + enabled). */
  readonly available = computed(() => this.ready());

  /** Active Microsoft account (if any). */
  readonly account = signal<AccountInfo | null>(null);

  // ─── Initialisation ─────────────────────────────────────────────

  /**
   * Initialise MSAL from the tenant's SSO configuration.
   * Safe to call multiple times — will no-op if already initialised.
   */
  async init(config: SsoConfig): Promise<void> {
    if (this.msalInstance) return; // Already initialised
    if (config.ssoProvider !== 'microsoft' || !config.ssoEnabled || !config.ssoClientId) {
      return; // SSO not configured for Microsoft
    }

    const authority = config.ssoTenantId
      ? `https://login.microsoftonline.com/${config.ssoTenantId}`
      : 'https://login.microsoftonline.com/common';

    const msalConfig: Configuration = {
      auth: {
        clientId: config.ssoClientId,
        authority,
        redirectUri: window.location.origin,
        postLogoutRedirectUri: window.location.origin,
      },
      cache: {
        cacheLocation: 'localStorage',
      },
    };

    this.msalInstance = new PublicClientApplication(msalConfig);
    await this.msalInstance.initialize();

    // Check for existing accounts from a previous session
    const accounts = this.msalInstance.getAllAccounts();
    if (accounts.length > 0) {
      this.msalInstance.setActiveAccount(accounts[0]!);
      this.account.set(accounts[0]!);
    }

    this.ready.set(true);
  }

  // ─── Login ──────────────────────────────────────────────────────

  /**
   * Prompt user to sign in with Microsoft via a popup.
   * Returns the access token (scoped to `User.Read`) which can be
   * sent to `POST /auth/login/sso` to create a Fueld session.
   */
  async loginPopup(): Promise<AuthenticationResult> {
    this.assertReady();

    const result = await this.msalInstance!.loginPopup({
      scopes: LOGIN_SCOPES,
    });

    if (result.account) {
      this.msalInstance!.setActiveAccount(result.account);
      this.account.set(result.account);
    }

    return result;
  }

  // ─── Token Acquisition ──────────────────────────────────────────

  /**
   * Acquire a token with `Mail.Send` scope for sending emails via
   * Microsoft Graph. Tries silent acquisition first; falls back to
   * a popup if interactive consent is required.
   */
  async acquireMailSendToken(): Promise<string> {
    this.assertReady();

    const account = this.msalInstance!.getActiveAccount();
    if (!account) {
      throw new Error('No Microsoft account signed in. Please sign in with Microsoft first.');
    }

    const request: SilentRequest = {
      scopes: MAIL_SEND_SCOPES,
      account,
    };

    try {
      const result = await this.msalInstance!.acquireTokenSilent(request);
      return result.accessToken;
    } catch (err) {
      // If silent acquisition fails (e.g. consent needed), try popup
      if (err instanceof InteractionRequiredAuthError || err instanceof BrowserAuthError) {
        const result = await this.msalInstance!.acquireTokenPopup({
          scopes: MAIL_SEND_SCOPES,
          account,
        });
        return result.accessToken;
      }
      throw err;
    }
  }

  /**
   * Check if there is an active Microsoft account that could provide
   * a Mail.Send token (without actually acquiring one).
   */
  hasActiveAccount(): boolean {
    return !!this.msalInstance?.getActiveAccount();
  }

  // ─── Logout ─────────────────────────────────────────────────────

  /**
   * Clear the MSAL cache. Call this alongside normal Fueld logout.
   */
  async logout(): Promise<void> {
    if (!this.msalInstance) return;
    try {
      this.msalInstance.setActiveAccount(null);
      // Clear all accounts from the cache (don't redirect to MS logout)
      const accounts = this.msalInstance.getAllAccounts();
      for (const acc of accounts) {
        await this.msalInstance.clearCache({ account: acc });
      }
    } catch {
      // Ignore — just clearing local state
    }
    this.account.set(null);
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private assertReady(): void {
    if (!this.msalInstance) {
      throw new Error(
        'MSAL is not initialised. Ensure Microsoft SSO is configured in Admin → Security → SSO Settings.',
      );
    }
  }
}
