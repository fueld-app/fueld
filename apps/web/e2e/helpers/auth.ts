import { expect, type Page } from '@playwright/test';

export async function loginViaUi(page: Page, params: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await page.locator('#email').fill(params.email);
  await page.locator('#password').fill(params.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
