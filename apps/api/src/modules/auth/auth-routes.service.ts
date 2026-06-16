// ═══════════════════════════════════════════════════════════════════════
//  Auth Routes Service — extracted route handler logic
// ═══════════════════════════════════════════════════════════════════════

import type { JwtPayload } from './jwt.setup';
import {
  loginWithPassword,
  registerUser,
  storeRefreshToken,
  storeMicrosoftRefreshToken,
  clearMicrosoftRefreshToken,
  clearRefreshToken,
  findUserById,
  findUserByEmail,
  getMfaStatus,
  generate2faSecret,
  enable2fa,
  disable2fa,
  verify2faToken,
} from './auth.service';
import {
  buildAuthorizationUrl,
  buildConnectAuthorizationUrl,
  exchangeCodeForTokens,
  verifyAndDecodeState,
  encryptRefreshToken,
  validateReturnUrl,
  storeOneTimeCode,
  consumeOneTimeCode,
} from './microsoft-oauth.service';
import { validateO365Token } from './o365.service';
import { resetPasswordWithToken } from './password-reset.service';
import {
  listPasskeys,
  renamePasskey,
  deletePasskey,
  isPasskeyEnabled,
  generatePasskeyRegistrationOptions,
  verifyAndStorePasskey,
  generatePasskeyAuthenticationOptions,
  verifyPasskeyAuthentication,
} from './passkey.service';
import type { ApiResponse } from '@fueld/types';

// ─── Helpers ─────────────────────────────────────────────────────────

export function sanitiseUser(user: any) {
  return {
    id: user.id, email: user.email, name: user.name, role: user.role,
    tenantId: user.tenantId, is2faEnabled: user.is2faEnabled, isActive: user.isActive,
    isOnLeave: user.isOnLeave, leaveEndDate: user.leaveEndDate, delegateId: user.delegateId,
    avatarUrl: user.avatarUrl ?? null, phone: user.phone ?? null,
  };
}

export function extractPayload(decoded: false | Record<string, unknown>): JwtPayload | null {
  if (!decoded || !decoded['sub']) return null;
  return { sub: decoded['sub'] as string, email: decoded['email'] as string, role: decoded['role'] as string };
}

export function userToPayload(user: { id: string; email: string; name: string; role: string }): JwtPayload {
  return { sub: user.id, email: user.email, name: user.name, role: user.role };
}

// ─── Route Handlers ──────────────────────────────────────────────────

export async function handleRegister(body: any, jwtAccess: any, jwtRefresh: any) {
  try {
    const user = await registerUser(body);
    const payload = userToPayload(user);
    const accessToken = await jwtAccess.sign(payload);
    const refreshToken = await jwtRefresh.sign(payload);
    await storeRefreshToken(user.id, refreshToken);
    return { success: true, data: { user: sanitiseUser(user), accessToken, refreshToken, requiresMfaSetup: false } } satisfies ApiResponse<unknown>;
  } catch (err: any) {
    return { success: false, data: null, message: err.message || 'Registration failed' } satisfies ApiResponse<null>;
  }
}

export async function handleLogin(body: any, jwtAccess: any, jwtRefresh: any) {
  try {
    const { user } = await loginWithPassword(body.email, body.password);
    if (!user.isActive) return { success: false, data: null, message: 'Your account has been deactivated. Contact an admin.' } satisfies ApiResponse<null>;
    const { hasPasskeys, requires2fa, requiresMfaSetup } = await getMfaStatus(user);
    if (requires2fa) {
      const tempToken = await jwtAccess.sign({ sub: user.id, email: user.email, role: user.role, pending2fa: 'true' } as JwtPayload);
      return { success: true, data: { requires2fa: true, tempToken, hasPasskeys } } satisfies ApiResponse<unknown>;
    }
    const payload = userToPayload(user);
    const accessToken = await jwtAccess.sign(payload);
    const refreshToken = await jwtRefresh.sign(payload);
    await storeRefreshToken(user.id, refreshToken);
    return { success: true, data: { requires2fa: false, user: sanitiseUser(user), accessToken, refreshToken, requiresMfaSetup } } satisfies ApiResponse<unknown>;
  } catch (err: any) {
    return { success: false, data: null, message: err.message || 'Login failed' } satisfies ApiResponse<null>;
  }
}

export async function handlePasswordReset(body: any) {
  try {
    await resetPasswordWithToken({ token: body.token, newPassword: body.password });
    return { success: true, data: null, message: 'Password has been reset' } satisfies ApiResponse<null>;
  } catch (err: any) {
    return { success: false, data: null, message: err.message || 'Password reset failed' } satisfies ApiResponse<null>;
  }
}

export async function handleVerify2fa(body: any, jwtAccess: any, jwtRefresh: any) {
  try {
    const raw = await jwtAccess.verify(body.tempToken);
    const decoded = raw ? (raw as Record<string, unknown>) : null;
    if (!decoded || !decoded['sub'] || decoded['pending2fa'] !== 'true') return { success: false, data: null, message: 'Invalid or expired temporary token' } satisfies ApiResponse<null>;
    const userId = decoded['sub'] as string;
    const valid = await verify2faToken(userId, body.code);
    if (!valid) return { success: false, data: null, message: 'Invalid 2FA code' } satisfies ApiResponse<null>;
    const user = await findUserById(userId);
    if (!user) return { success: false, data: null, message: 'User not found' } satisfies ApiResponse<null>;
    const payload = userToPayload(user);
    const accessToken = await jwtAccess.sign(payload);
    const refreshToken = await jwtRefresh.sign(payload);
    await storeRefreshToken(user.id, refreshToken);
    return { success: true, data: { user: sanitiseUser(user), accessToken, refreshToken, requiresMfaSetup: false } } satisfies ApiResponse<unknown>;
  } catch (err: any) {
    return { success: false, data: null, message: err.message || '2FA verification failed' } satisfies ApiResponse<null>;
  }
}

export async function handleVerifyPasskey2fa(body: any, jwtAccess: any, jwtRefresh: any) {
  try {
    const raw = await jwtAccess.verify(body.tempToken);
    const decoded = raw ? (raw as Record<string, unknown>) : null;
    if (!decoded || !decoded['sub'] || decoded['pending2fa'] !== 'true') return { success: false, data: null, message: 'Invalid or expired temporary token' } satisfies ApiResponse<null>;
    const userId = decoded['sub'] as string;
    const config = await isPasskeyEnabled();
    if (!config.enabled) return { success: false, data: null, message: 'Passkey authentication is not enabled' } satisfies ApiResponse<null>;
    const verified = await verifyPasskeyAuthentication(userId, body.assertionResponse, body.sessionId);
    if (!verified) return { success: false, data: null, message: 'Passkey verification failed' } satisfies ApiResponse<null>;
    const user = await findUserById(userId);
    if (!user) return { success: false, data: null, message: 'User not found' } satisfies ApiResponse<null>;
    const payload = userToPayload(user);
    const accessToken = await jwtAccess.sign(payload);
    const refreshToken = await jwtRefresh.sign(payload);
    await storeRefreshToken(user.id, refreshToken);
    return { success: true, data: { user: sanitiseUser(user), accessToken, refreshToken } } satisfies ApiResponse<unknown>;
  } catch (err: any) {
    return { success: false, data: null, message: err.message || 'Passkey verification failed' } satisfies ApiResponse<null>;
  }
}

export async function handlePasskeyAuthOptions() {
  try {
    const options = await generatePasskeyAuthenticationOptions();
    return { success: true, data: options } satisfies ApiResponse<unknown>;
  } catch { return { success: false, data: null, message: 'Failed to generate passkey auth options' } satisfies ApiResponse<null>; }
}

export async function handlePasskeyAuthOptions2fa() {
  try {
    const options = await generatePasskeyAuthenticationOptions();
    return { success: true, data: options } satisfies ApiResponse<unknown>;
  } catch { return { success: false, data: null, message: 'Failed to generate passkey auth options' } satisfies ApiResponse<null>; }
}

export async function handleLoginPasskey(body: any, jwtAccess: any, jwtRefresh: any) {
  try {
    const verified = await verifyPasskeyAuthentication(null, body.assertionResponse, body.sessionId);
    if (!verified) return { success: false, data: null, message: 'Passkey authentication failed' } satisfies ApiResponse<null>;
    const user = await findUserById(verified.userId);
    if (!user) return { success: false, data: null, message: 'User not found' } satisfies ApiResponse<null>;
    const payload = userToPayload(user);
    const accessToken = await jwtAccess.sign(payload);
    const refreshToken = await jwtRefresh.sign(payload);
    await storeRefreshToken(user.id, refreshToken);
    return { success: true, data: { user: sanitiseUser(user), accessToken, refreshToken } } satisfies ApiResponse<unknown>;
  } catch (err: any) {
    return { success: false, data: null, message: err.message || 'Passkey login failed' } satisfies ApiResponse<null>;
  }
}

export async function handleLoginSso(body: any, jwtAccess: any, jwtRefresh: any) {
  try {
    const { user } = await loginWithPassword(body.email, body.code);
    if (!user.isActive) return { success: false, data: null, message: 'Account deactivated' } satisfies ApiResponse<null>;
    const payload = userToPayload(user);
    const accessToken = await jwtAccess.sign(payload);
    const refreshToken = await jwtRefresh.sign(payload);
    await storeRefreshToken(user.id, refreshToken);
    return { success: true, data: { user: sanitiseUser(user), accessToken, refreshToken, requiresMfaSetup: false } } satisfies ApiResponse<unknown>;
  } catch (err: any) {
    return { success: false, data: null, message: err.message || 'SSO login failed' } satisfies ApiResponse<null>;
  }
}

export async function handleSsoConfig() {
  try {
    const { enabled } = await isPasskeyEnabled();
    return { success: true, data: { enabled, hasPasskeys: false } } satisfies ApiResponse<unknown>;
  } catch { return { success: false, data: null, message: 'Failed to load SSO config' } satisfies ApiResponse<null>; }
}

export async function handleMicrosoftLogin(query: any, set: any) {
  set.redirect = buildAuthorizationUrl(query.returnUrl);
}

export async function handleMicrosoftCallback(query: any, jwtAccess: any, jwtRefresh: any, set: any) {
  return handleOauthMicrosoft(query, jwtAccess, jwtRefresh, set);
}

export async function handleMicrosoftExchange(body: any) {
  const auth = consumeOneTimeCode(body.code);
  if (!auth) return { success: false, data: null, message: 'Invalid or expired code. Please try signing in again.' } satisfies ApiResponse<null>;
  return { success: true, data: { user: auth.user, accessToken: auth.fueldAccessToken, refreshToken: auth.fueldRefreshToken } } satisfies ApiResponse<unknown>;
}

export async function handleRefresh(body: any, jwtAccess: any, jwtRefresh: any) {
  try {
    const decoded = extractPayload(await jwtRefresh.verify(body.refreshToken));
    if (!decoded) return { success: false, data: null, message: 'Invalid or expired refresh token' } satisfies ApiResponse<null>;
    const user = await findUserById(decoded.sub);
    if (!user || user.refreshToken !== body.refreshToken) return { success: false, data: null, message: 'Refresh token revoked or invalid' } satisfies ApiResponse<null>;
    const { requiresMfaSetup } = await getMfaStatus(user);
    const payload = userToPayload(user);
    const newAccessToken = await jwtAccess.sign(payload);
    const newRefreshToken = await jwtRefresh.sign(payload);
    await storeRefreshToken(user.id, newRefreshToken);
    return { success: true, data: { accessToken: newAccessToken, refreshToken: newRefreshToken, requiresMfaSetup } } satisfies ApiResponse<unknown>;
  } catch (err: any) {
    return { success: false, data: null, message: err.message || 'Token refresh failed' } satisfies ApiResponse<null>;
  }
}

export async function handleLogout(body: any, jwtAccess: any) {
  try {
    const decoded = extractPayload(await jwtAccess.verify(body.accessToken));
    if (decoded) await clearRefreshToken(decoded.sub);
    return { success: true, data: null, message: 'Logged out' } satisfies ApiResponse<null>;
  } catch { return { success: true, data: null, message: 'Logged out' } satisfies ApiResponse<null>; }
}

export async function handleGenerate2fa(headers: any, jwtAccess: any) {
  try {
    const token = headers['authorization']?.slice(7);
    const decoded = extractPayload(await jwtAccess.verify(token));
    if (!decoded) return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
    const { secret, qrDataUrl } = await generate2faSecret(decoded.sub);
    return { success: true, data: { secret, qrDataUrl } } satisfies ApiResponse<unknown>;
  } catch (err: any) { return { success: false, data: null, message: err.message || '2FA setup failed' } satisfies ApiResponse<null>; }
}

export async function handleEnable2fa(body: any, headers: any, jwtAccess: any) {
  try {
    const token = headers['authorization']?.slice(7);
    const decoded = extractPayload(await jwtAccess.verify(token));
    if (!decoded) return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
    const enabled = await enable2fa(decoded.sub, body.code);
    if (!enabled) return { success: false, data: null, message: 'Invalid TOTP code — 2FA not enabled' } satisfies ApiResponse<null>;
    return { success: true, data: null, message: '2FA has been enabled' } satisfies ApiResponse<null>;
  } catch (err: any) { return { success: false, data: null, message: err.message || '2FA enable failed' } satisfies ApiResponse<null>; }
}

export async function handleDisable2fa(headers: any, jwtAccess: any) {
  try {
    const token = headers['authorization']?.slice(7);
    const decoded = extractPayload(await jwtAccess.verify(token));
    if (!decoded) return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
    await disable2fa(decoded.sub);
    return { success: true, data: null, message: '2FA has been disabled' } satisfies ApiResponse<null>;
  } catch (err: any) { return { success: false, data: null, message: err.message || '2FA disable failed' } satisfies ApiResponse<null>; }
}

export async function handleMe(headers: any, jwtAccess: any) {
  try {
    const token = headers['authorization']?.slice(7);
    const decoded = extractPayload(await jwtAccess.verify(token));
    if (!decoded) return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
    const user = await findUserById(decoded.sub);
    if (!user) return { success: false, data: null, message: 'User not found' } satisfies ApiResponse<null>;
    return { success: true, data: sanitiseUser(user) } satisfies ApiResponse<unknown>;
  } catch { return { success: false, data: null, message: 'Failed to load profile' } satisfies ApiResponse<null>; }
}

export async function handleGetMe(jwtAccess: any, headers: any) {
  return handleMe(headers, jwtAccess);
}

export async function handleOauthMicrosoft(query: any, jwtAccess: any, jwtRefresh: any, set: any) {
  if (!query.code) {
    set.redirect = buildAuthorizationUrl(query.returnUrl);
    return;
  }
  try {
    const { tokens, state } = await exchangeCodeForTokens(query.code, query.redirectUri);
    const o365User = await validateO365Token(tokens.accessToken);
    const msEmail = (o365User?.mail ?? o365User?.userPrincipalName ?? '').toLowerCase();
    const existingUser = await findUserByEmail(msEmail);
    const microsoftTenantId = tokens.tenantId ?? tokens.realm ?? 'common';
    if (existingUser) {
      await storeMicrosoftRefreshToken(existingUser.id, encryptRefreshToken(tokens.refreshToken));
      await clearRefreshToken(existingUser.id);
    }
    let userId: string, userEmail: string, userName: string, role: string;
    if (existingUser) {
      userId = existingUser.id; userEmail = existingUser.email; userName = existingUser.name; role = existingUser.role;
    } else {
      const newUser = await registerUser({ email: msEmail, name: o365User.displayName ?? msEmail.split('@')[0] ?? 'User', password: crypto.randomUUID(), microsoftTenantId });
      userId = newUser.id; userEmail = newUser.email; userName = newUser.name; role = 'Trader';
      await storeMicrosoftRefreshToken(userId, encryptRefreshToken(tokens.refreshToken));
    }
    const jwtPayload = { sub: userId, email: userEmail, name: userName, role };
    const fueldAccessToken = await jwtAccess.sign(jwtPayload);
    const fueldRefreshToken = await jwtRefresh.sign(jwtPayload);
    await storeRefreshToken(userId, fueldRefreshToken);
    const fullUser = existingUser ?? await findUserById(userId);
    const { requiresMfaSetup } = fullUser ? await getMfaStatus(fullUser) : { requiresMfaSetup: false };
    const oneTimeCode = crypto.randomUUID();
    storeOneTimeCode(oneTimeCode, { user: fullUser ? sanitiseUser(fullUser) : null, fueldAccessToken, fueldRefreshToken });
    const decodedState = verifyAndDecodeState(state);
    const returnUrl = decodedState?.returnUrl ?? '/';
    set.redirect = `${process.env['APP_URL'] || 'http://localhost:4200'}${returnUrl.startsWith('/') ? '' : '/'}${returnUrl}?code=${oneTimeCode}${requiresMfaSetup ? '&mfa=1' : ''}`;
  } catch (err: any) {
    console.error('[Auth] Microsoft OAuth error:', err);
    set.redirect = `${process.env['APP_URL'] || 'http://localhost:4200'}/login?error=${encodeURIComponent(err.message || 'Microsoft sign-in failed')}`;
  }
}

export async function handleMicrosoftConnect(set: any) {
  set.redirect = buildConnectAuthorizationUrl('/settings/account');
}

export async function handleMicrosoftStatus(headers: any, jwtAccess: any) {
  try {
    const token = headers['authorization']?.slice(7);
    const decoded = extractPayload(await jwtAccess.verify(token));
    if (!decoded) return { success: true, data: { connected: false } } satisfies ApiResponse<unknown>;
    const user = await findUserById(decoded.sub);
    return { success: true, data: { connected: !!user?.microsoftRefreshToken } } satisfies ApiResponse<unknown>;
  } catch { return { success: true, data: { connected: false } } satisfies ApiResponse<unknown>; }
}

export async function handleMicrosoftDisconnect(headers: any, jwtAccess: any) {
  try {
    const token = headers['authorization']?.slice(7);
    const decoded = extractPayload(await jwtAccess.verify(token));
    if (!decoded) return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
    await clearMicrosoftRefreshToken(decoded.sub);
    return { success: true, data: null, message: 'Microsoft account disconnected' } satisfies ApiResponse<null>;
  } catch { return { success: false, data: null, message: 'Failed to disconnect' } satisfies ApiResponse<null>; }
}

export async function handlePasskeyRegistrationOptions(headers: any, jwtAccess: any) {
  try {
    const token = headers['authorization']?.slice(7);
    const decoded = extractPayload(await jwtAccess.verify(token));
    if (!decoded) return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
    const options = await generatePasskeyRegistrationOptions(decoded.sub, decoded.email);
    return { success: true, data: options } satisfies ApiResponse<unknown>;
  } catch { return { success: false, data: null, message: 'Failed to generate passkey registration options' } satisfies ApiResponse<null>; }
}

export async function handleVerifyPasskey(body: any, headers: any, jwtAccess: any) {
  try {
    const token = headers['authorization']?.slice(7);
    const decoded = extractPayload(await jwtAccess.verify(token));
    if (!decoded) return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
    await verifyAndStorePasskey(decoded.sub, body);
    return { success: true, data: null, message: 'Passkey registered' } satisfies ApiResponse<null>;
  } catch { return { success: false, data: null, message: 'Failed to verify passkey' } satisfies ApiResponse<null>; }
}

export async function handleListPasskeys(headers: any, jwtAccess: any) {
  try {
    const token = headers['authorization']?.slice(7);
    const decoded = extractPayload(await jwtAccess.verify(token));
    if (!decoded) return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
    return { success: true, data: await listPasskeys(decoded.sub) } satisfies ApiResponse<unknown>;
  } catch { return { success: false, data: null, message: 'Failed to list passkeys' } satisfies ApiResponse<null>; }
}

export async function handleRenamePasskey(params: any, body: any, headers: any, jwtAccess: any) {
  try {
    const token = headers['authorization']?.slice(7);
    const decoded = extractPayload(await jwtAccess.verify(token));
    if (!decoded) return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
    await renamePasskey(params.id, decoded.sub, body.name);
    return { success: true, data: null, message: 'Passkey renamed' } satisfies ApiResponse<null>;
  } catch { return { success: false, data: null, message: 'Failed to rename passkey' } satisfies ApiResponse<null>; }
}

export async function handleDeletePasskey(params: any, headers: any, jwtAccess: any) {
  try {
    const token = headers['authorization']?.slice(7);
    const decoded = extractPayload(await jwtAccess.verify(token));
    if (!decoded) return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
    await deletePasskey(params.id, decoded.sub);
    return { success: true, data: null, message: 'Passkey deleted' } satisfies ApiResponse<null>;
  } catch { return { success: false, data: null, message: 'Failed to delete passkey' } satisfies ApiResponse<null>; }
}

export async function handlePasskeyAuthenticationOptions() {
  try {
    const options = await generatePasskeyAuthenticationOptions();
    return { success: true, data: options } satisfies ApiResponse<unknown>;
  } catch { return { success: false, data: null, message: 'Failed to generate passkey auth options' } satisfies ApiResponse<null>; }
}

export async function handleVerifyPasskeyAuth(body: any, jwtAccess: any, jwtRefresh: any) {
  try {
    const options = await generatePasskeyAuthenticationOptions();
    return { success: true, data: options } satisfies ApiResponse<unknown>;
  } catch { return { success: false, data: null, message: 'Failed to verify passkey auth' } satisfies ApiResponse<null>; }
}

export async function handleVerifyPasskeyAuth2(body: any, jwtAccess: any, jwtRefresh: any) {
  try {
    const result = await verifyPasskeyAuthentication(null, body.assertionResponse, body.sessionId);
    if (!result) return { success: false, data: null, message: 'Passkey authentication failed' } satisfies ApiResponse<null>;
    const user = await findUserById(result.userId);
    if (!user) return { success: false, data: null, message: 'User not found' } satisfies ApiResponse<null>;
    const payload = userToPayload(user);
    const accessToken = await jwtAccess.sign(payload);
    const refreshToken = await jwtRefresh.sign(payload);
    await storeRefreshToken(user.id, refreshToken);
    return { success: true, data: { user: sanitiseUser(user), accessToken, refreshToken, requiresMfaSetup: false } } satisfies ApiResponse<unknown>;
  } catch (err: any) {
    return { success: false, data: null, message: err.message || 'Passkey authentication failed' } satisfies ApiResponse<null>;
  }
}
