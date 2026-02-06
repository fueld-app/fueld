// ─── O365 / Microsoft Entra ID SSO Helper ────────────────────────────

interface MicrosoftGraphProfile {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
}

/**
 * Validate a Microsoft OAuth2 Access Token by calling the
 * Microsoft Graph `/me` endpoint.  Returns the user profile
 * on success, or `null` if the token is invalid / expired.
 */
export async function validateO365Token(
  accessToken: string,
): Promise<MicrosoftGraphProfile | null> {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      console.error(`[O365] Graph API returned ${res.status}`);
      return null;
    }

    const profile = (await res.json()) as MicrosoftGraphProfile;

    // Ensure we have a usable email
    if (!profile.mail && !profile.userPrincipalName) {
      console.error('[O365] No email found on Microsoft profile');
      return null;
    }

    return profile;
  } catch (err) {
    console.error('[O365] Token validation failed:', err);
    return null;
  }
}
