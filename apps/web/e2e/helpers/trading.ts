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

async function ensureOwnCompanyBankAccount(
  page: Page,
  headers: Record<string, string>,
  invoicingCompanyId: string,
): Promise<string | null> {
  const bankAccountsRes = await page.request.get(
    `http://localhost:3000/admin/settings/companies/${invoicingCompanyId}/bank-accounts`,
    { headers },
  );
  if (!bankAccountsRes.ok()) {
    throw new Error('Failed to fetch bank accounts for inquiry creation.');
  }

  const bankAccountsJson = await bankAccountsRes.json() as ApiResponse<BankAccountDto[]>;
  const existingBankAccountId = bankAccountsJson.data?.[0]?.id ?? null;
  if (existingBankAccountId) {
    return existingBankAccountId;
  }

  const createBankAccountRes = await page.request.post(
    `http://localhost:3000/admin/settings/companies/${invoicingCompanyId}/bank-accounts`,
    {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: {
        label: 'E2E Default USD',
        bankName: 'E2E Bank',
        accountName: 'E2E Account',
        accountNumber: '123456789',
        iban: 'NO9386011117947',
        swiftBic: 'DNBANOKKXXX',
        currency: 'USD',
        isDefault: true,
      },
    },
  );

  if (!createBankAccountRes.ok()) {
    throw new Error('Failed to create default bank account for inquiry creation.');
  }

  const createdBankAccountJson = await createBankAccountRes.json() as ApiResponse<BankAccountDto>;
  return createdBankAccountJson.data?.id ?? null;
}

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
    bankAccountId = await ensureOwnCompanyBankAccount(page, headers, invoicingCompanyId);
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

/** Create an inquiry and link supplier companies to it so multi-supplier tabs appear. */
export async function createMultiSupplierInquiryViaApi(
  page: Page,
): Promise<{ inquiryId: string; supplierIds: string[] }> {
  const inquiryId = await createInquiryViaApi(page);

  const accessToken = await page.evaluate(() => localStorage.getItem('fueld_access_token'));
  if (!accessToken) throw new Error('Missing access token');

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };

  // Fetch existing supplier companies to link to this inquiry
  const suppliersRes = await page.request.get(
    'http://localhost:3000/companies/local?type=SUPPLIER&limit=5',
    { headers },
  );
  const suppliersJson = await suppliersRes.json() as ApiResponse<{ companies: CompanyDto[] }>;
  const supplierCompanies = suppliersJson.data?.companies ?? [];

  // We need at least 2 supplier companies
  if (supplierCompanies.length < 2) {
    // Create a second supplier company via the local endpoint
    const createRes = await page.request.post('http://localhost:3000/companies/local', {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: {
        name: `E2E Supplier ${Date.now()}`,
        types: ['SUPPLIER'],
      },
    });
    const createJson = await createRes.json() as ApiResponse<{ id: string }>;
    if (createJson.success && createJson.data) {
      supplierCompanies.push({ id: createJson.data.id });
    }
  }

  const linkedSupplierIds: string[] = [];

  // Link each supplier company to the order via POST /orders/:id/suppliers
  for (let i = 0; i < Math.min(supplierCompanies.length, 3); i++) {
    const companyId = supplierCompanies[i]!.id;
    const addRes = await page.request.post(
      `http://localhost:3000/orders/${inquiryId}/suppliers`,
      {
        headers: { ...headers, 'Content-Type': 'application/json' },
        data: {
          companyId,
          isPrimary: i === 0,
        },
      },
    );
    if (addRes.ok()) {
      linkedSupplierIds.push(companyId);
    }
  }

  return { inquiryId, supplierIds: linkedSupplierIds };
}