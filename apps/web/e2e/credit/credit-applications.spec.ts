import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';
import { createInquiryViaApi } from '../helpers/trading';
import type { Page } from '@playwright/test';

const env = process.env;
const traderUser = {
  email: env['E2E_TRADER4_USER_EMAIL'] ?? 'trader4@fueld.local',
  password: env['E2E_TRADER4_USER_PASSWORD'] ?? 'trader4password123',
};
const trader2User = {
  email: env['E2E_TRADER5_USER_EMAIL'] ?? 'trader5@fueld.local',
  password: env['E2E_TRADER5_USER_PASSWORD'] ?? 'trader5password123',
};
const creditUser = {
  email: env['E2E_CREDIT_USER_EMAIL'] ?? 'credit@fueld.local',
  password: env['E2E_CREDIT_USER_PASSWORD'] ?? 'creditpassword123',
};
const adminUser = {
  email: env['E2E_ADMIN3_EMAIL'] ?? 'admin3@fueld.local',
  password: env['E2E_ADMIN3_PASSWORD'] ?? 'admin3password123',
};
const seededClientName = env['E2E_CLIENT_NAME'] ?? 'E2E Client Co';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface CompanyDto {
  id: string;
  name: string;
}

interface CreditApplicationDto {
  id: string;
  reason: string | null;
  status: string;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
}

async function getAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('fueld_access_token'));
  if (!token) throw new Error('Missing browser access token');
  return token;
}

async function authHeaders(page: Page): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await getAccessToken(page)}`,
    Accept: 'application/json',
  };
}

async function fetchSeededClientId(page: Page): Promise<string> {
  const res = await page.request.get(
    `http://localhost:3000/companies/local?type=CLIENT&search=${encodeURIComponent(seededClientName)}&limit=10`,
    { headers: await authHeaders(page) },
  );

  if (!res.ok()) {
    throw new Error(`Failed to fetch seeded client: HTTP ${res.status()} ${res.statusText()}`);
  }

  const json = await res.json() as ApiResponse<{ companies: CompanyDto[] }>;
  const company = json.data?.companies?.find((c) => c.name === seededClientName) ?? json.data?.companies?.[0];
  if (!company?.id) throw new Error('Unable to resolve seeded client company id');
  return company.id;
}

async function createCreditApplicationViaApi(
  page: Page,
  body: {
    type: 'CUSTOMER' | 'SUPPLIER';
    counterpartyId: string;
    requestedAmount: string;
    requestedCurrency: string;
    requestedDays?: number;
    reason?: string;
    orderId?: string;
  },
): Promise<CreditApplicationDto> {
  const res = await page.request.post('http://localhost:3000/credit/applications', {
    headers: {
      ...(await authHeaders(page)),
      'Content-Type': 'application/json',
    },
    data: body,
  });

  if (!res.ok()) {
    throw new Error(`Failed to create credit application via API: HTTP ${res.status()} ${res.statusText()}`);
  }

  const json = await res.json() as ApiResponse<CreditApplicationDto>;
  if (!json.success || !json.data?.id) {
    throw new Error(`Failed to create credit application via API: ${json.message ?? 'unknown error'}`);
  }

  return json.data;
}

async function listCreditApplicationsViaApi(
  page: Page,
  query = '',
): Promise<PaginatedResponse<CreditApplicationDto>> {
  const res = await page.request.get(`http://localhost:3000/credit/applications${query}`, {
    headers: await authHeaders(page),
  });

  if (!res.ok()) {
    throw new Error(`Failed to list credit applications via API: HTTP ${res.status()} ${res.statusText()}`);
  }

  const json = await res.json() as ApiResponse<PaginatedResponse<CreditApplicationDto>>;
  if (!json.success || !json.data) {
    throw new Error(`Failed to list credit applications via API: ${json.message ?? 'unknown error'}`);
  }

  return json.data;
}

async function patchCreditSettings(page: Page, body: Record<string, unknown>): Promise<void> {
  const res = await page.request.patch('http://localhost:3000/credit/applications/settings', {
    headers: {
      ...(await authHeaders(page)),
      'Content-Type': 'application/json',
    },
    data: body,
  });

  if (!res.ok()) {
    throw new Error(`Failed to update credit settings via API: HTTP ${res.status()} ${res.statusText()}`);
  }
}

test('trader can submit credit application from company detail and see it in applications list', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, traderUser);
  const clientId = await fetchSeededClientId(page);
  const uniqueReason = `PW company credit ${Date.now()}`;

  await page.goto(`/companies/${clientId}`);
  await expect(page.getByRole('heading', { name: seededClientName })).toBeVisible();

  await page.getByRole('button', { name: 'Request Credit' }).click();
  await expect(page.getByRole('heading', { name: 'Apply for Credit' })).toBeVisible();

  await page.getByPlaceholder('100000').fill('12345');
  await page.getByPlaceholder('Explain why this credit is needed...').fill(uniqueReason);
  const submitResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/credit/applications'),
  );
  await page.getByRole('button', { name: 'Submit Application' }).click();
  const submit = await submitResponse;
  expect(submit.ok()).toBe(true);

  await page.goto('/credit/applications');
  await expect(page.getByRole('heading', { name: 'Credit Applications' })).toBeVisible();

  const listed = await listCreditApplicationsViaApi(page, '?status=PENDING');
  expect(listed.items.some((item) => item.reason === uniqueReason)).toBe(true);
});

test('credit manager can review and approve a trader credit application from the applications page', async ({ browser }) => {
  test.setTimeout(120_000);

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await loginViaUi(adminPage, adminUser);
  await patchCreditSettings(adminPage, {
    requiredApprovals: 1,
    immediateRejection: true,
    autoApplyOnApproval: true,
    notifyCreditManagers: true,
  });
  await adminContext.close();

  const traderContext = await browser.newContext();
  const traderPage = await traderContext.newPage();
  await loginViaUi(traderPage, traderUser);
  const clientId = await fetchSeededClientId(traderPage);
  const uniqueReason = `PW review credit ${Date.now()}`;
  await createCreditApplicationViaApi(traderPage, {
    type: 'CUSTOMER',
    counterpartyId: clientId,
    requestedAmount: '7777.00',
    requestedCurrency: 'USD',
    reason: uniqueReason,
  });
  await traderContext.close();

  const cmContext = await browser.newContext();
  const cmPage = await cmContext.newPage();
  await loginViaUi(cmPage, creditUser);

  await cmPage.goto('/credit/applications');
  await expect(cmPage.getByRole('heading', { name: 'Credit Applications' })).toBeVisible();

  const card = cmPage.locator('div.rounded-xl').filter({ hasText: uniqueReason }).first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Review' }).click();
  await cmPage.getByPlaceholder('Add a note about your decision...').fill('Approved in Playwright');
  const approveResponse = cmPage.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/credit/applications/') && response.url().includes('/review'),
  );
  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  const approve = await approveResponse;
  expect(approve.ok()).toBe(true);

  await cmPage.reload();
  await cmPage.getByRole('button', { name: 'Approved', exact: true }).click();
  const approvedCard = cmPage.locator('div.rounded-xl').filter({ hasText: uniqueReason }).first();
  await expect(approvedCard).toBeVisible();
  await expect(approvedCard).toContainText('APPROVED');
  await expect(approvedCard).toContainText('Approved in Playwright');

  await cmContext.close();
});

test('trader can submit credit application from inquiry detail', async ({ page }) => {
  test.setTimeout(120_000);

  await loginViaUi(page, traderUser);
  const uniqueReason = `PW inquiry credit ${Date.now()}`;
  const inquiryId = await createInquiryViaApi(page);

  await page.goto(`/trading/inquiries/${inquiryId}`);
  await expect(page.getByRole('heading', { name: 'Inquiry Detail' })).toBeVisible();
  await expect(page.getByText('No credit line on file.').first()).toBeVisible();

  await page.getByRole('button', { name: 'Request Credit' }).click();
  await expect(page.getByRole('heading', { name: 'Apply for Credit' })).toBeVisible();

  await page.getByPlaceholder('100000').fill('8888');
  await page.getByPlaceholder('Explain why this credit is needed...').fill(uniqueReason);
  const submitResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/credit/applications'),
  );
  await page.getByRole('button', { name: 'Submit Application' }).click();
  const submit = await submitResponse;
  expect(submit.ok()).toBe(true);

  await page.goto('/credit/applications');
  const listed = await listCreditApplicationsViaApi(page, '?status=PENDING');
  expect(listed.items.some((item) => item.reason === uniqueReason)).toBe(true);
});

test('admin can update and persist credit application settings via UI', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, adminUser);
  await page.goto('/admin/credit');
  await expect(page.getByRole('heading', { name: 'Credit & Financing Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Approval Workflow' })).toBeVisible();

  const approvalsInput = page.locator('input[type="number"]').first();
  const originalValue = await approvalsInput.inputValue();
  const nextValue = originalValue === '1' ? '2' : '1';

  await approvalsInput.fill(nextValue);
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByText('Settings saved successfully.')).toBeVisible();

  await page.reload();
  await expect(page.locator('input[type="number"]').first()).toHaveValue(nextValue);

  await page.locator('input[type="number"]').first().fill(originalValue);
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByText('Settings saved successfully.')).toBeVisible();
});
