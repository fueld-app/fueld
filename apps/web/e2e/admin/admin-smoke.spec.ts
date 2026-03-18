/**
 * Smoke tests for admin pages that have zero E2E coverage.
 * Verifies each page loads without errors and renders its heading.
 */
import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

const { env } = process;

const adminEmail = env['E2E_ADMIN2_EMAIL'] ?? 'admin2@fueld.local';
const adminPassword = env['E2E_ADMIN2_PASSWORD'] ?? 'admin2password123';

test.describe('Admin page smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
  });

  test('Company Groups page loads', async ({ page }) => {
    await page.goto('/admin/company-groups');
    await expect(page.getByRole('heading', { name: 'Company Groups' })).toBeVisible({ timeout: 15_000 });
  });

  test('Integrations page loads', async ({ page }) => {
    await page.goto('/admin/integrations');
    await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible({ timeout: 15_000 });
  });

  test('Activity Log page loads', async ({ page }) => {
    await page.goto('/admin/activity');
    await expect(page.getByRole('heading', { name: /Activity/i })).toBeVisible({ timeout: 15_000 });
  });

  test('Security page loads', async ({ page }) => {
    await page.goto('/admin/security');
    await expect(page.getByRole('heading', { name: /Authentication.*Security/i, level: 1 })).toBeVisible({ timeout: 15_000 });
  });

  test('General Settings page loads', async ({ page }) => {
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'General Settings' })).toBeVisible({ timeout: 15_000 });
  });

  test('Backup page loads', async ({ page }) => {
    await page.goto('/admin/backup');
    await expect(page.getByRole('heading', { name: 'Backup & Restore', level: 1 })).toBeVisible({ timeout: 15_000 });
  });

  test('Email Settings page loads', async ({ page }) => {
    await page.goto('/admin/email');
    await expect(page.getByRole('heading', { name: /Email Settings/i })).toBeVisible({ timeout: 15_000 });
  });

  test('Credit Settings page loads', async ({ page }) => {
    await page.goto('/admin/credit');
    await expect(page.getByRole('heading', { name: /Credit.*Financing.*Settings/i, level: 1 })).toBeVisible({ timeout: 15_000 });
  });

  test('Vessel Sanctions page loads', async ({ page }) => {
    await page.goto('/admin/vessel-sanctions');
    await expect(page.getByRole('heading', { name: /Vessel Sanctions/i })).toBeVisible({ timeout: 15_000 });
  });

  test('LLM settings page loads', async ({ page }) => {
    await page.goto('/admin/llm');
    // LLM page may have various heading text — just verify page renders
    await expect(page.locator('h1, h2, h3').first()).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/admin\/llm/);
  });
});
