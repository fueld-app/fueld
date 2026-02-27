import { type Page } from '@playwright/test';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface CompanyDto { id: string }
interface VesselDto { id: string }
interface PlaceDto { id: string }
interface BankAccountDto { id: string }

export async function createInquiryViaApi(page: Page): Promise<string> {
  const accessToken = await page.evaluate(() => localStorage.getItem('fueld_access_token'));
  if (!accessToken) {
    throw new Error('Missing access token in browser localStorage.');
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };

  const [clientsRes, vesselsRes, placesRes] = await Promise.all([
    page.request.get('http://localhost:3000/companies/local?type=CLIENT&limit=1', { headers }),
    page.request.get('http://localhost:3000/vessels/local?limit=1', { headers }),
    page.request.get('http://localhost:3000/lloyds/places/local?limit=1', { headers }),
  ]);

  if (!clientsRes.ok() || !vesselsRes.ok() || !placesRes.ok()) {
    throw new Error('Failed to fetch seeded entities from API for inquiry creation.');
  }

  const clientsJson = await clientsRes.json() as ApiResponse<{ companies: CompanyDto[] }>;
  const vesselsJson = await vesselsRes.json() as ApiResponse<{ vessels: VesselDto[] }>;
  const placesJson = await placesRes.json() as ApiResponse<{ places: PlaceDto[] }>;

  const clientId = clientsJson.data?.companies?.[0]?.id;
  const vesselId = vesselsJson.data?.vessels?.[0]?.id;
  const placeId = placesJson.data?.places?.[0]?.id;

  const ownCompaniesRes = await page.request.get('http://localhost:3000/companies/own', { headers });
  if (!ownCompaniesRes.ok()) {
    throw new Error('Failed to fetch own companies for inquiry creation.');
  }
  const ownCompaniesJson = await ownCompaniesRes.json() as ApiResponse<CompanyDto[]>;
  const invoicingCompanyId = ownCompaniesJson.data?.[0]?.id ?? null;

  let bankAccountId: string | null = null;
  if (invoicingCompanyId) {
    const bankAccountsRes = await page.request.get(
      `http://localhost:3000/admin/settings/companies/${invoicingCompanyId}/bank-accounts`,
      { headers },
    );
    if (bankAccountsRes.ok()) {
      const bankAccountsJson = await bankAccountsRes.json() as ApiResponse<BankAccountDto[]>;
      bankAccountId = bankAccountsJson.data?.[0]?.id ?? null;
    }
  }

  if (!clientId || !vesselId || !placeId) {
    throw new Error('Unable to resolve seeded client/vessel/place for inquiry creation.');
  }

  const createRes = await page.request.post('http://localhost:3000/orders', {
    headers,
    data: {
      clientId,
      vesselId,
      placeId,
      ...(invoicingCompanyId ? { invoicingCompanyId } : {}),
      ...(bankAccountId ? { bankAccountId } : {}),
    },
  });
  if (!createRes.ok()) {
    throw new Error(`Failed to create inquiry via API: HTTP ${createRes.status()} ${createRes.statusText()}`);
  }
  const createJson = await createRes.json() as ApiResponse<{ id: string }>;

  const inquiryId = createJson.data?.id;
  if (!createJson.success || !inquiryId) {
    throw new Error(`Failed to create inquiry via API: ${createJson.message ?? createRes.statusText()}`);
  }

  const seedItemsRes = await page.request.put(`http://localhost:3000/orders/${inquiryId}/items`, {
    headers,
    data: {
      items: [
        {
          productType: 'MGO',
          quantity: '100',
          unit: 'MT',
          salesPrice: '500',
          customerNote: 'Seeded by Playwright',
        },
      ],
    },
  });
  if (!seedItemsRes.ok()) {
    throw new Error(`Failed to seed inquiry items via API: HTTP ${seedItemsRes.status()} ${seedItemsRes.statusText()}`);
  }

  return inquiryId;
}
