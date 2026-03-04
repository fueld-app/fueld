import { test, expect, type APIResponse } from '@playwright/test';
import { loginViaUi } from '../helpers/auth';
import { createInquiryViaApi } from '../helpers/trading';

function expectPdfSignature(body: Buffer): void {
  expect(body.subarray(0, 4).toString()).toBe('%PDF');
}

async function getAccessToken(page: import('@playwright/test').Page): Promise<string> {
  const accessToken = await page.evaluate(() => localStorage.getItem('fueld_access_token'));
  if (!accessToken) throw new Error('Missing access token in browser localStorage.');
  return accessToken;
}

function getRequiredHeader(response: APIResponse, name: string): string {
  const value = response.headers()[name.toLowerCase()];
  if (!value) throw new Error(`Expected response header ${name} to be present.`);
  return value;
}

test('offer verification endpoints expose immutable revision by token', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: process.env['E2E_TRADER4_USER_EMAIL'] ?? 'trader4@fueld.local',
    password: process.env['E2E_TRADER4_USER_PASSWORD'] ?? 'trader4password123',
  });

  const orderId = await createInquiryViaApi(page);
  const accessToken = await getAccessToken(page);

  const authenticatedOffer = await page.request.get(`http://localhost:3000/orders/${orderId}/offer/pdf`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  expect(authenticatedOffer.ok()).toBeTruthy();
  expect(authenticatedOffer.headers()['content-type']).toContain('application/pdf');
  expectPdfSignature(await authenticatedOffer.body());

  const verifyToken = getRequiredHeader(authenticatedOffer, 'X-Document-Verify-Token');
  const verificationRef = getRequiredHeader(authenticatedOffer, 'X-Document-Reference');
  const revision = getRequiredHeader(authenticatedOffer, 'X-Document-Revision');

  const publicByOrder = await page.request.get(`http://localhost:3000/verify/${orderId}/offer`);
  expect(publicByOrder.ok()).toBeTruthy();
  expect(publicByOrder.headers()['content-type']).toContain('application/pdf');
  expectPdfSignature(await publicByOrder.body());
  expect(publicByOrder.headers()['x-document-reference']).toBe(verificationRef);
  expect(publicByOrder.headers()['x-document-revision']).toBe(revision);

  const publicByToken = await page.request.get(`http://localhost:3000/verify/token/${verifyToken}`);
  expect(publicByToken.ok()).toBeTruthy();
  expect(publicByToken.headers()['content-type']).toContain('application/pdf');
  expectPdfSignature(await publicByToken.body());
  expect(publicByToken.headers()['x-document-reference']).toBe(verificationRef);
  expect(publicByToken.headers()['x-document-revision']).toBe(revision);

  const invalidToken = await page.request.get('http://localhost:3000/verify/token/invalid-token-e2e');
  expect(invalidToken.status()).toBe(404);
  await expect(invalidToken.json()).resolves.toMatchObject({
    success: false,
    message: 'Document not found',
  });
});
