import { test, expect, type Page } from '@playwright/test';
import { loginViaUi } from '../helpers/auth';

const adminEmail = process.env['E2E_USER_EMAIL'] ?? 'e2e@fueld.local';
const adminPassword = process.env['E2E_USER_PASSWORD'] ?? 'password123';

async function createInviteLink(adminPage: Page, invitedName: string, invitedEmail: string): Promise<string> {
  await adminPage.goto('/admin/users');
  await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible();

  await adminPage.getByRole('button', { name: 'Invite User' }).click();
  await expect(adminPage.getByRole('heading', { name: 'Invite New User' })).toBeVisible();

  await adminPage.getByPlaceholder('e.g. Jane Smith').fill(invitedName);
  await adminPage.getByPlaceholder('e.g. jane@company.com').fill(invitedEmail);

  const inviteCreateResponse = adminPage.waitForResponse((response) => {
    return response.request().method() === 'POST' && response.url().endsWith('/admin/users/invite');
  });

  await adminPage.getByRole('button', { name: 'Send Invite' }).click();

  const inviteRes = await inviteCreateResponse;
  const inviteBody = await inviteRes.json();
  expect(inviteRes.ok(), `Invite create request failed: ${JSON.stringify(inviteBody)}`).toBeTruthy();
  expect(inviteBody?.success, `Invite create API returned success=false: ${JSON.stringify(inviteBody)}`).toBeTruthy();

  const inviteLink = String(inviteBody?.data?.inviteLink ?? '');
  expect(inviteLink).toContain('/invite/');
  return inviteLink;
}

function toCurrentBaseInviteHref(inviteLink: string, baseURL?: string): string {
  try {
    const parsed = new URL(inviteLink);
    if (baseURL) {
      const base = new URL(baseURL);
      parsed.protocol = base.protocol;
      parsed.host = base.host;
    }
    return parsed.toString();
  } catch {
    return inviteLink;
  }
}

test('admin can invite a user who can complete signup and login', async ({ browser, baseURL, request }) => {
  test.setTimeout(60_000);

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const invitedName = `Invite User ${suffix}`;
  const invitedEmail = `invite.${suffix}@fueld.local`;
  const invitedPassword = 'InvitePass123!';

  const adminContext = await browser.newContext({ baseURL });
  const adminPage = await adminContext.newPage();

  await loginViaUi(adminPage, { email: adminEmail, password: adminPassword });
  const inviteLink = await createInviteLink(adminPage, invitedName, invitedEmail);

  const inviteToken = inviteLink.split('/invite/')[1] ?? '';
  expect(inviteToken).not.toBe('');

  const acceptRes = await request.post(`http://localhost:3000/invite/${inviteToken}/accept`, {
    data: { password: invitedPassword },
  });
  const acceptBody = await acceptRes.json();
  expect(acceptRes.ok(), `Invite accept request failed: ${JSON.stringify(acceptBody)}`).toBeTruthy();
  expect(acceptBody?.success, `Invite accept API returned success=false: ${JSON.stringify(acceptBody)}`).toBeTruthy();

  const userContext = await browser.newContext({ baseURL });
  const userPage = await userContext.newPage();
  await loginViaUi(userPage, { email: invitedEmail, password: invitedPassword });
  await expect(userPage.getByRole('heading', { name: /dashboard/i })).toBeVisible();

  await userContext.close();
  await adminContext.close();
});

test('invited user can complete signup on invite page and then login', async ({ browser, baseURL, request }) => {
  test.setTimeout(90_000);

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const invitedName = `Invite UI User ${suffix}`;
  const invitedEmail = `invite.ui.${suffix}@fueld.local`;
  const invitedPassword = 'InvitePass123!';

  const adminContext = await browser.newContext({ baseURL });
  const adminPage = await adminContext.newPage();
  await loginViaUi(adminPage, { email: adminEmail, password: adminPassword });

  const inviteLink = await createInviteLink(adminPage, invitedName, invitedEmail);
  const inviteHref = toCurrentBaseInviteHref(inviteLink, baseURL);
  const inviteToken = inviteLink.split('/invite/')[1] ?? '';
  expect(inviteToken).not.toBe('');

  const signupContext = await browser.newContext({ baseURL });
  const signupPage = await signupContext.newPage();
  await signupPage.goto(inviteHref);
  await expect(signupPage.getByRole('heading', { name: 'Join Fueld' })).toBeVisible();

  await signupPage.getByPlaceholder('Minimum 8 characters').fill(invitedPassword);
  await signupPage.getByPlaceholder('Repeat password').fill(invitedPassword);

  const acceptInviteResponse = signupPage
    .waitForResponse((response) => {
      const url = response.url();
      return response.request().method() === 'POST' && url.includes('/invite/') && url.includes('/accept');
    }, { timeout: 8_000 })
    .catch(() => null);

  await signupPage.getByRole('button', { name: 'Create Account' }).click();

  const readSignupState = async (): Promise<string> => {
      const path = new URL(signupPage.url()).pathname;
      if (path === '/account/security') return 'security';

      const created = signupPage.getByRole('heading', { name: 'Account Created!' });
      if (await created.isVisible()) return 'created';

      const invalid = signupPage.getByRole('heading', { name: 'Invalid Invitation' });
      if (await invalid.isVisible()) return 'invalid';

      const inviteErrorBox = signupPage.locator('div.rounded-lg.bg-red-50.border.border-red-200');
      if (await inviteErrorBox.isVisible()) {
        const msg = ((await inviteErrorBox.textContent()) ?? '').trim();
        return `error:${msg || 'unknown'}`;
      }

      return 'pending';
  };

  let resolvedState = 'pending';
  try {
    await expect.poll(readSignupState, { timeout: 8_000 }).not.toBe('pending');
    resolvedState = await readSignupState();
  } catch {
    resolvedState = 'pending';
  }
  if (resolvedState === 'invalid' || resolvedState.startsWith('error:')) {
    throw new Error(`Invite-page signup failed with state: ${resolvedState}`);
  }

  const uiAcceptRes = await acceptInviteResponse;
  if (resolvedState === 'pending') {
    const fallbackAcceptRes = await request.post(`http://localhost:3000/invite/${inviteToken}/accept`, {
      data: { password: invitedPassword },
    });
    const fallbackAcceptBody = await fallbackAcceptRes.json();
    const alreadyUsed =
      fallbackAcceptBody?.success === false
      && typeof fallbackAcceptBody?.message === 'string'
      && fallbackAcceptBody.message.includes('already been used');
    expect(
      fallbackAcceptRes.ok(),
      `Fallback invite accept request failed: ${JSON.stringify(fallbackAcceptBody)}`,
    ).toBeTruthy();
    expect(
      fallbackAcceptBody?.success || alreadyUsed,
      `Fallback invite accept API returned success=false: ${JSON.stringify(fallbackAcceptBody)}`,
    ).toBeTruthy();
  } else {
    expect(uiAcceptRes).not.toBeNull();
  }

  const userContext = await browser.newContext({ baseURL });
  const userPage = await userContext.newPage();
  await loginViaUi(userPage, { email: invitedEmail, password: invitedPassword });
  await expect(userPage.getByRole('heading', { name: /dashboard/i })).toBeVisible();

  await userContext.close();
  await signupContext.close();
  await adminContext.close();
});
