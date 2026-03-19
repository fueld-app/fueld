import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';
import { selectSearchableDropdownOption } from '../helpers/dropdown';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

type ApiResponse<T> = {
  success: boolean;
  data: T;
  message?: string;
};

type CompanyDto = { id: string; name?: string };
type VesselDto = { id: string; name?: string };
type PlaceDto = { id: string; name?: string; unlocode?: string };

async function authHeaders(page: import('@playwright/test').Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem('fueld_access_token'));
  if (!token) throw new Error('Missing access token in localStorage');
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

async function fetchSeededInquiryEntities(page: import('@playwright/test').Page): Promise<{
  clientLabel: string;
  vesselLabel: string;
  placeLabel: string;
}> {
  const headers = await authHeaders(page);
  const [clientsRes, vesselsRes, placesRes] = await Promise.all([
    page.request.get('http://localhost:3000/companies/local?type=CLIENT&limit=1', { headers }),
    page.request.get('http://localhost:3000/vessels/local?limit=1', { headers }),
    page.request.get('http://localhost:3000/lloyds/places/local?limit=1', { headers }),
  ]);

  expect(clientsRes.ok()).toBe(true);
  expect(vesselsRes.ok()).toBe(true);
  expect(placesRes.ok()).toBe(true);

  const clientsJson = await clientsRes.json() as ApiResponse<{ companies?: CompanyDto[]; items?: CompanyDto[] } | CompanyDto[]>;
  const vesselsJson = await vesselsRes.json() as ApiResponse<{ vessels?: VesselDto[]; items?: VesselDto[] } | VesselDto[]>;
  const placesJson = await placesRes.json() as ApiResponse<{ places?: PlaceDto[]; items?: PlaceDto[] } | PlaceDto[]>;

  const client = (clientsJson.data as { companies?: CompanyDto[]; items?: CompanyDto[] } | undefined)?.companies?.[0]
    ?? (clientsJson.data as { items?: CompanyDto[] } | undefined)?.items?.[0]
    ?? (Array.isArray(clientsJson.data) ? clientsJson.data[0] : undefined);
  const vessel = (vesselsJson.data as { vessels?: VesselDto[]; items?: VesselDto[] } | undefined)?.vessels?.[0]
    ?? (vesselsJson.data as { items?: VesselDto[] } | undefined)?.items?.[0]
    ?? (Array.isArray(vesselsJson.data) ? vesselsJson.data[0] : undefined);
  const place = (placesJson.data as { places?: PlaceDto[]; items?: PlaceDto[] } | undefined)?.places?.[0]
    ?? (placesJson.data as { items?: PlaceDto[] } | undefined)?.items?.[0]
    ?? (Array.isArray(placesJson.data) ? placesJson.data[0] : undefined);

  if (!client?.name || !vessel?.name || !place?.name) {
    throw new Error('Missing seeded client, vessel, or place for inquiry creation test');
  }

  return {
    clientLabel: client.name,
    vesselLabel: vessel.name,
    placeLabel: place.unlocode ? `${place.name} (${place.unlocode.replace(/\s+/g, '')})` : place.name,
  };
}

test('header New Inquiry button opens the inquiry modal on the inquiries page', async ({ page }) => {
  await loginViaUi(page, {
    email: env['E2E_TRADER4_USER_EMAIL'] ?? 'trader4@fueld.local',
    password: env['E2E_TRADER4_USER_PASSWORD'] ?? 'trader4password123',
  });

  await page.goto('/trading/inquiries');
  await expect(page.getByRole('heading', { name: 'Inquiries' })).toBeVisible();

  const headerButton = page.getByRole('button', { name: 'New Inquiry' }).first();
  await expect(headerButton).toBeVisible();
  await headerButton.click();

  await expect(page.getByRole('heading', { name: 'New Inquiry' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Search clients...' })).toBeVisible();
});

test('new inquiry modal accepts and submits older ETA and ETD dates', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: env['E2E_TRADER4_USER_EMAIL'] ?? 'trader4@fueld.local',
    password: env['E2E_TRADER4_USER_PASSWORD'] ?? 'trader4password123',
  });

  const seeded = await fetchSeededInquiryEntities(page);
  const pastEta = '2026-01-15';
  const pastEtd = '2026-01-18';
  let capturedBody: Record<string, unknown> | null = null;

  await page.route('**/orders', async (route) => {
    if (route.request().method() === 'POST') {
      capturedBody = route.request().postDataJSON() as Record<string, unknown>;
    }
    await route.continue();
  });

  await page.goto('/trading/inquiries');
  await expect(page.getByRole('heading', { name: 'Inquiries' })).toBeVisible();

  await page.getByRole('button', { name: 'New Inquiry' }).first().click();
  const modal = page.getByRole('heading', { name: 'New Inquiry' }).locator('..').locator('..');

  await selectSearchableDropdownOption(page, modal, 'Client', seeded.clientLabel);
  await selectSearchableDropdownOption(page, modal, 'Vessel', seeded.vesselLabel);
  await selectSearchableDropdownOption(page, modal, 'Port', seeded.placeLabel);

  const etaInput = page.locator('#new-eta');
  const etdInput = page.locator('#new-etd');

  await etaInput.fill(pastEta);
  await etdInput.fill(pastEtd);

  const createResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && /\/orders$/.test(response.url()),
  );

  await page.getByRole('button', { name: 'Create Inquiry' }).click();
  await createResponse;
  await page.waitForURL(/\/trading\/inquiries\//, { timeout: 15_000 });

  expect(capturedBody).not.toBeNull();
  expect(capturedBody?.['eta']).toBe(pastEta);
  expect(capturedBody?.['etd']).toBe(pastEtd);
});