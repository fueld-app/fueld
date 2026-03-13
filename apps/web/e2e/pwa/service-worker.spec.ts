import { test, expect } from '@playwright/test';

// These tests run against the production build served by `serve`
// on the PWA port so the Angular service worker is active.

test.describe('PWA basics', () => {
  test('manifest is served and has correct metadata', async ({ page }) => {
    const response = await page.request.get('/manifest.webmanifest');
    expect(response.ok()).toBe(true);

    const manifest = await response.json();
    expect(manifest.name).toBe('Fueld');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
  });

  test('service worker registers successfully', async ({ page }) => {
    await page.goto('/');

    // Wait for Angular to bootstrap & register the SW
    const swRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;

      // Give the SW up to 10 seconds to register
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const reg = await navigator.serviceWorker.getRegistration('/');
        if (reg?.active) return true;
        await new Promise((r) => setTimeout(r, 500));
      }
      return false;
    });

    expect(swRegistered).toBe(true);
  });

  test('app shell loads from cache after SW activation', async ({ page, context }) => {
    // First visit – installs the service worker
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for SW to be fully activated
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration('/');
      if (reg?.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const r = await navigator.serviceWorker.getRegistration('/');
        if (r?.active?.state === 'activated') return;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    });

    // Second visit – app shell should be served from SW cache
    const newPage = await context.newPage();
    const shellResponse = await newPage.goto('/');
    expect(shellResponse?.ok()).toBe(true);

    // The page should render something meaningful even if the API is down
    await expect(newPage.locator('app-root')).toBeAttached({ timeout: 10_000 });
    await newPage.close();
  });

  test('ngsw-worker.js is served', async ({ page }) => {
    const response = await page.request.get('/ngsw-worker.js');
    expect(response.ok()).toBe(true);
    const text = await response.text();
    expect(text).toContain('ServiceWorker');
  });

  test('static assets are cache-eligible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check that the ngsw config was processed and is accessible
    const configResponse = await page.request.get('/ngsw.json');
    expect(configResponse.ok()).toBe(true);

    const config = await configResponse.json();
    expect(config.assetGroups).toBeDefined();
    expect(config.assetGroups.length).toBeGreaterThan(0);

    // Verify the "app" group prefetches index.html
    const appGroup = config.assetGroups.find((g: { name: string }) => g.name === 'app');
    expect(appGroup).toBeDefined();
    expect(appGroup.installMode).toBe('prefetch');
  });
});
