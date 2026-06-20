import { type Page } from '@playwright/test';
import { authHeaders } from './auth';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface CompanyDto { id: string }
interface VesselDto { id: string }
interface PlaceDto { id: string }
interface BankAccountDto { id: string }
interface OrderSupplierRecordDto { id: string; companyId: string }

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
  const headers = await authHeaders(page);

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

/** Create an inquiry with 2+ supplier legs, each with their own dedicated line item. */
export async function createMultiSupplierInquiryViaApi(
  page: Page,
): Promise<{ inquiryId: string; supplierRecordIds: string[] }> {
  const headers = await authHeaders(page);

  // Step 1: create inquiry (no items yet — we'll add per-supplier items)
  const [clientsRes, vesselsRes, placesRes] = await Promise.all([
    page.request.get('http://localhost:3000/companies/local?type=CLIENT&limit=1', { headers }),
    page.request.get('http://localhost:3000/vessels/local?limit=1', { headers }),
    page.request.get('http://localhost:3000/lloyds/places/local?limit=1', { headers }),
  ]);

  if (!clientsRes.ok() || !vesselsRes.ok() || !placesRes.ok()) {
    throw new Error('Failed to fetch seeded entities.');
  }

  const clientId = ((await clientsRes.json()) as ApiResponse<{ companies: CompanyDto[] }>).data?.companies?.[0]?.id;
  const vesselId = ((await vesselsRes.json()) as ApiResponse<{ vessels: VesselDto[] }>).data?.vessels?.[0]?.id;
  const placeId = ((await placesRes.json()) as ApiResponse<{ places: PlaceDto[] }>).data?.places?.[0]?.id;

  const ownCompaniesRes = await page.request.get('http://localhost:3000/companies/own', { headers });
  const invoicingCompanyId = ((await ownCompaniesRes.json()) as ApiResponse<CompanyDto[]>).data?.[0]?.id ?? null;
  const bankAccountId = invoicingCompanyId ? await ensureOwnCompanyBankAccount(page, headers, invoicingCompanyId) : null;

  if (!clientId || !vesselId || !placeId) throw new Error('Unable to resolve seeded entities.');

  const createRes = await page.request.post('http://localhost:3000/orders', {
    headers,
    data: { clientId, vesselId, placeId, ...(invoicingCompanyId ? { invoicingCompanyId } : {}), ...(bankAccountId ? { bankAccountId } : {}) },
  });
  const createJson = await createRes.json() as ApiResponse<{ id: string }>;
  const inquiryId = createJson.data?.id;
  if (!createJson.success || !inquiryId) throw new Error('Failed to create inquiry via API.');

  // Step 2: fetch or create supplier companies, link them, capture record ids
  const suppliersRes = await page.request.get('http://localhost:3000/companies/local?type=SUPPLIER&limit=5', { headers });
  const supplierCompanies: CompanyDto[] = ((await suppliersRes.json()) as ApiResponse<{ companies: CompanyDto[] }>).data?.companies ?? [];

  if (supplierCompanies.length < 2) {
    const createRes = await page.request.post('http://localhost:3000/companies/local', {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { name: `E2E Supplier ${Date.now()}`, types: ['SUPPLIER'] },
    });
    const createJson = await createRes.json() as ApiResponse<{ id: string }>;
    if (createJson.success && createJson.data) supplierCompanies.push({ id: createJson.data.id });
  }

  const supplierRecordIds: string[] = [];

  for (let i = 0; i < Math.min(supplierCompanies.length, 3); i++) {
    const companyId = supplierCompanies[i]!.id;
    const addRes = await page.request.post(`http://localhost:3000/orders/${inquiryId}/suppliers`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { companyId, isPrimary: i === 0 },
    });
    if (addRes.ok()) {
      const addJson = await addRes.json() as ApiResponse<OrderSupplierRecordDto>;
      if (addJson.success && addJson.data?.id) {
        supplierRecordIds.push(addJson.data.id);
      }
    }
  }

  // Step 3: seed per-supplier line items with orderSupplierId pointing to each supplier record
  if (supplierRecordIds.length >= 1) {
    const items = supplierRecordIds.map((recordId, idx) => ({
      orderSupplierId: recordId,
      productType: idx === 0 ? 'MGO' : 'VLSFO',
      quantity: '100',
      unit: 'MT',
      salesPrice: '500',
      customerNote: `Seeded for supplier ${idx + 1}`,
    }));

    await page.request.put(`http://localhost:3000/orders/${inquiryId}/items`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { items },
    });
  }

  return { inquiryId, supplierRecordIds };
}