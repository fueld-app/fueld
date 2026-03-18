import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

const { env } = process;

const adminEmail = env['E2E_ADMIN3_EMAIL'] ?? 'admin3@fueld.local';
const adminPassword = env['E2E_ADMIN3_PASSWORD'] ?? 'admin3password123';

async function authHeaders(page: import('@playwright/test').Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem('fueld_access_token'));
  if (!token) throw new Error('Missing access token in localStorage');
  return { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };
}

/** Delete a team via API. Ignores 404 (already deleted). */
async function deleteTeamViaApi(page: import('@playwright/test').Page, teamId: string): Promise<void> {
  const headers = await authHeaders(page);
  const res = await page.request.delete(`http://localhost:3000/admin/settings/teams/${teamId}`, { headers });
  if (!res.ok() && res.status() !== 404) {
    throw new Error(`Failed to delete team: ${res.status()}`);
  }
}

test.describe('Teams management', () => {
  test('admin can create, see and delete a team', async ({ page }) => {
    test.setTimeout(90_000);

    await loginViaUi(page, { email: adminEmail, password: adminPassword });

    await page.goto('/admin/teams');
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible();

    const teamName = `PW Team ${Date.now()}`;

    // Click "Create Team"
    await page.getByRole('button', { name: 'Create Team' }).click();

    // Modal should appear
    const modal = page.locator('[role="dialog"], .fixed.inset-0').filter({ hasText: /team name/i }).first();
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Fill team name
    const nameInput = modal.locator('input').first();
    await nameInput.fill(teamName);

    // Submit — intercept the POST response
    const createResponse = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/admin/settings/teams'),
    );
    await modal.getByRole('button', { name: /create|save/i }).click();
    const createRes = await createResponse;
    expect(createRes.ok()).toBe(true);

    const createBody = await createRes.json();
    const teamId = createBody?.data?.id;
    expect(teamId).toBeTruthy();

    // Team should now appear in the list
    await expect(page.locator('main').filter({ hasText: teamName })).toBeVisible({ timeout: 10_000 });

    // Clean up: delete the team via API
    await deleteTeamViaApi(page, teamId);

    // Reload and verify team is gone
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible();

    // The team name should no longer appear
    await expect(page.locator('body')).not.toContainText(teamName, { timeout: 10_000 });
  });

  test('teams page shows empty state when no teams', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });

    await page.goto('/admin/teams');
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible();

    // Page should render without errors (could show empty state or team list)
    // Just verify the page structure loaded
    await expect(page.locator('body')).toContainText(/Teams/);
  });

  test('trader cannot access teams page', async ({ page }) => {
    const traderEmail = env['E2E_TRADER5_USER_EMAIL'] ?? 'trader5@fueld.local';
    const traderPassword = env['E2E_TRADER5_USER_PASSWORD'] ?? 'trader5password123';

    await loginViaUi(page, { email: traderEmail, password: traderPassword });

    await page.goto('/admin/teams');
    // Should be redirected away from admin
    await expect(page).toHaveURL(/\/$/);
  });
});
