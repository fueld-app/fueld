// ═══════════════════════════════════════════════════════════════════════
//  Enable Banking Control Panel API Client
//  Handles email-link authentication, app registration, and token refresh
//  via the Enable Banking Control Panel (enablebanking.com).
//  This is separate from the Banking API client (api.enablebanking.com).
// ═══════════════════════════════════════════════════════════════════════

const CP_DOMAIN = 'https://enablebanking.com';

export interface AuthData {
  localId: string;
  email: string;
  idToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RegisterAppData {
  name: string;
  certificate: string;
  environment: string; // 'PRODUCTION' or 'SANDBOX'
  redirect_urls: string[];
  description?: string;
  gdpr_email?: string;
  privacy_url?: string;
  terms_url?: string;
}

export class ControlPanelClient {
  /**
   * Send email sign-in link to the user.
   * POST /api/relyingparty/getOobConfirmationCode
   */
  async getOobConfirmationCode(email: string, callbackUrl: string): Promise<void> {
    const resp = await fetch(`${CP_DOMAIN}/api/relyingparty/getOobConfirmationCode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestType: 'EMAIL_SIGNIN',
        email,
        continueUrl: callbackUrl,
        canHandleCodeInApp: true,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`getOobConfirmationCode failed: ${resp.status} ${text}`);
    }
  }

  /**
   * Complete email link sign-in with the oobCode from the email link.
   * POST /api/relyingparty/emailLinkSignin
   * Returns auth data: idToken, refreshToken, localId, email
   */
  async emailLinkSignin(email: string, oobCode: string): Promise<AuthData> {
    const resp = await fetch(`${CP_DOMAIN}/api/relyingparty/emailLinkSignin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oobCode, email }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`emailLinkSignin failed: ${resp.status} ${text}`);
    }
    return resp.json() as Promise<AuthData>;
  }

  /**
   * Register a new application in the Enable Banking Control Panel.
   * POST /api/applications
   * Requires: Bearer idToken from email-link sign-in
   * Returns: { app_id }
   */
  async registerApplication(appData: RegisterAppData, idToken: string): Promise<{ app_id: string }> {
    const body: Record<string, string | string[]> = {
      name: appData.name,
      certificate: appData.certificate,
      environment: appData.environment,
      redirect_urls: appData.redirect_urls,
    };
    if (appData.description) body['description'] = appData.description;
    if (appData.gdpr_email) body['gdpr_email'] = appData.gdpr_email;
    if (appData.privacy_url) body['privacy_url'] = appData.privacy_url;
    if (appData.terms_url) body['terms_url'] = appData.terms_url;

    const resp = await fetch(`${CP_DOMAIN}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`registerApplication failed: ${resp.status} ${text}`);
    }
    return resp.json() as Promise<{ app_id: string }>;
  }

  /**
   * Refresh the ID token using a refresh token.
   * POST /api/token
   * Content-Type: application/x-www-form-urlencoded
   */
  async refreshToken(refreshToken: string): Promise<{ id_token: string; refresh_token: string; expires_in: number }> {
    const resp = await fetch(`${CP_DOMAIN}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`refreshToken failed: ${resp.status} ${text}`);
    }
    return resp.json() as Promise<{ id_token: string; refresh_token: string; expires_in: number }>;
  }
}