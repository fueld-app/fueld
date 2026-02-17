import { expect, type Page, type Response } from '@playwright/test';

export async function waitForPdfResponse(page: Page, urlPart: string): Promise<Response> {
  const response = await page.waitForResponse((res) => {
    if (res.status() !== 200) return false;
    if (!res.url().includes(urlPart)) return false;
    const req = res.request();
    return req.method() === 'GET';
  });

  const body = await response.body();
  expect(body.subarray(0, 4).toString()).toBe('%PDF');

  return response;
}

export async function closePdfPreviewIfOpen(page: Page): Promise<void> {
  const modalBackdrop = page.locator('app-pdf-preview-modal div.fixed.inset-0');
  if (!(await modalBackdrop.isVisible().catch(() => false))) return;

  // Prefer closing by clicking the backdrop (the modal stops propagation on the panel).
  await modalBackdrop.click({ position: { x: 5, y: 5 } });
  await expect(modalBackdrop).toBeHidden();
}
