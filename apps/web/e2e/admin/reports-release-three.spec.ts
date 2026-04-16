import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';
import { Role, type ReleaseTwoReportsDto, type ReportScheduleDto } from '@fueld/types';

const adminEmail = process.env['E2E_ADMIN2_EMAIL'] ?? 'admin2@fueld.local';
const adminPassword = process.env['E2E_ADMIN2_PASSWORD'] ?? 'admin2password123';

function buildReportPayload(): ReleaseTwoReportsDto {
  return {
    generatedAt: '2026-03-19T10:00:00.000Z',
    access: {
      scope: 'ALL',
      canViewFinance: true,
      canManageSharedViews: true,
      canManageSchedules: true,
    },
    filtersApplied: {
      from: '2026-03-01',
      to: '2026-03-19',
      traderId: null,
      teamId: null,
      customerId: null,
      productType: null,
    },
    filterOptions: {
      traders: [{ id: 'trader-1', label: 'Admin Trader' }],
      teams: [{ id: 'team-1', label: 'North Sea' }],
      customers: [{ id: 'customer-1', label: 'ACME Shipping' }],
      products: [{ id: 'VLSFO', label: 'VLSFO' }],
    },
    savedViews: [],
    schedules: [],
    traderPerformance: {
      totals: {
        orderCount: 3,
        totalRevenue: '12500.00',
        totalGrossProfit: '2200.00',
        totalNetProfit: '1850.00',
        winRate: 0.66,
        avgDealSize: '4166.67',
      },
      rows: [{
        traderId: 'trader-1',
        traderName: 'Admin Trader',
        traderEmail: 'admin@fueld.test',
        teamName: 'North Sea',
        orderCount: 3,
        totalRevenue: '12500.00',
        totalGrossProfit: '2200.00',
        totalNetProfit: '1850.00',
        winRate: 0.66,
        avgDealSize: '4166.67',
      }],
    },
    invoiceAging: {
      totalInvoices: 2,
      totalOutstanding: '4100.00',
      buckets: [
        { label: 'Current', count: 0, outstandingAmount: '0.00' },
        { label: '1-30', count: 0, outstandingAmount: '0.00' },
        { label: '31-60', count: 0, outstandingAmount: '0.00' },
        { label: '61-90', count: 1, outstandingAmount: '1800.00' },
        { label: '90+', count: 1, outstandingAmount: '2300.00' },
      ],
      rows: [{
        invoiceId: 'invoice-1',
        invoiceNumber: 'INV-2026-001',
        orderId: 'order-1',
        clientName: 'ACME Shipping',
        vesselName: 'MT Horizon',
        traderName: 'Admin Trader',
        dueDate: '2026-01-10',
        status: 'SENT',
        outstandingAmount: '2300.00',
        daysOverdue: 69,
        agingBucket: '61-90',
      }],
    },
    commercialSummary: {
      conversion: {
        totalWon: 2,
        totalLost: 1,
        winRate: 0.66,
        avgDaysToClose: 6,
      },
      lossAnalysis: {
        reasons: [{ reason: 'Price not competitive', count: 1, percentage: 1 }],
      },
      pipeline: [
        { status: 'OFFER', count: 2, totalValue: '5000.00' },
        { status: 'CONFIRMED', count: 3, totalValue: '12500.00' },
      ],
    },
    marginAnalysis: {
      byCustomer: [{ key: 'customer-1', label: 'ACME Shipping', orderCount: 3, totalRevenue: '12500.00', totalNetProfit: '1850.00', netMarginPct: 14.8 }],
      byProduct: [{ key: 'VLSFO', label: 'VLSFO', orderCount: 3, totalRevenue: '12500.00', totalNetProfit: '1850.00', netMarginPct: 14.8 }],
      byVessel: [{ key: 'vessel-1', label: 'MT Horizon', orderCount: 3, totalRevenue: '12500.00', totalNetProfit: '1850.00', netMarginPct: 14.8 }],
      monthlyTrend: [{ month: '2026-03', orderCount: 3, totalRevenue: '12500.00', totalNetProfit: '1850.00', netMarginPct: 14.8 }],
    },
    variance: {
      comparison: {
        mode: 'PREVIOUS_PERIOD',
        label: 'vs previous period',
        currentFrom: '2026-03-01',
        currentTo: '2026-03-19',
        previousFrom: '2026-02-10',
        previousTo: '2026-02-28',
      },
      summary: {
        totalRevenue: { currentValue: '12500.00', previousValue: '9800.00', deltaValue: '2700.00', deltaPct: 27.6, direction: 'UP' },
        totalNetProfit: { currentValue: '1850.00', previousValue: '1120.00', deltaValue: '730.00', deltaPct: 65.2, direction: 'UP' },
        totalOutstanding: { currentValue: '4100.00', previousValue: '3500.00', deltaValue: '600.00', deltaPct: 17.1, direction: 'UP' },
        winRate: { currentValue: '66.0', previousValue: '52.0', deltaValue: '14.0', deltaPct: 26.9, direction: 'UP' },
        avgDealSize: { currentValue: '4166.67', previousValue: '3266.67', deltaValue: '900.00', deltaPct: 27.6, direction: 'UP' },
      },
      topTraderMovers: [{ key: 'trader-1', label: 'Admin Trader', currentValue: '1850.00', previousValue: '1120.00', deltaValue: '730.00', deltaPct: 65.2, direction: 'UP' }],
      topCustomerMovers: [{ key: 'customer-1', label: 'ACME Shipping', currentValue: '1850.00', previousValue: '1120.00', deltaValue: '730.00', deltaPct: 65.2, direction: 'UP' }],
      topProductMovers: [{ key: 'VLSFO', label: 'VLSFO', currentValue: '1850.00', previousValue: '1120.00', deltaValue: '730.00', deltaPct: 65.2, direction: 'UP' }],
    },
    exceptions: {
      totalCount: 2,
      byType: [
        { type: 'SEVERELY_OVERDUE_INVOICE', count: 1 },
        { type: 'LOW_MARGIN_CUSTOMER', count: 1 },
      ],
      rows: [
        {
          type: 'SEVERELY_OVERDUE_INVOICE',
          severity: 'HIGH',
          entityType: 'invoice',
          entityId: 'invoice-1',
          title: 'INV-2026-001',
          description: 'ACME Shipping is 69 days overdue.',
          primaryValue: '2300.00',
          secondaryValue: '61-90',
        },
        {
          type: 'LOW_MARGIN_CUSTOMER',
          severity: 'MEDIUM',
          entityType: 'customer',
          entityId: 'customer-1',
          title: 'ACME Shipping',
          description: 'Customer margin is below the operating threshold.',
          primaryValue: '4.2%',
          secondaryValue: '12500.00 revenue',
        },
      ],
    },
  };
}

function buildExceptionSchedule(): ReportScheduleDto {
  return {
    id: 'schedule-1',
    name: 'Exception Digest',
    description: 'Only high-priority issues',
    reportMode: 'EXCEPTIONS',
    reportType: 'SUMMARY',
    deliveryMode: 'HTML',
    bodyMode: 'HTML_SUMMARY',
    hourUtc: 9,
    recipientRoles: [Role.Admin],
    extraEmails: ['ops@fueld.test'],
    exceptionTypes: ['SEVERELY_OVERDUE_INVOICE'],
    sendOnlyWhenNonEmpty: true,
    filters: {},
    isActive: true,
    lastSentAt: null,
    createdAt: '2026-03-19T10:00:00.000Z',
    updatedAt: '2026-03-19T10:00:00.000Z',
  };
}

test('reports comparison, drilldown, and exception export flows work from the UI', async ({ page }) => {
  await loginViaUi(page, { email: adminEmail, password: adminPassword });

  const payload = buildReportPayload();

  await page.route('**/reports/release-two**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: payload }),
    });
  });

  await page.route('**/reports/drilldown/orders**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          title: 'Orders for Admin Trader',
          dataset: 'ORDERS',
          target: 'TRADER',
          totalCount: 1,
          orders: [{
            orderId: 'order-1',
            traderId: 'trader-1',
            traderName: 'Admin Trader',
            clientId: 'customer-1',
            clientName: 'ACME Shipping',
            vesselId: 'vessel-1',
            vesselName: 'MT Horizon',
            status: 'CONFIRMED',
            createdAt: '2026-03-19T00:00:00.000Z',
            totalQuantity: '10.000',
            totalRevenue: '12500.00',
            totalGrossProfit: '2200.00',
            totalFinancingCost: '350.00',
            totalNetProfit: '1850.00',
            netMarginPct: 14.8,
          }],
          invoices: [],
        },
      }),
    });
  });

  await page.route('**/reports/drilldown/invoices**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          title: 'Invoices in 61-90',
          dataset: 'INVOICES',
          target: 'AGING_BUCKET',
          totalCount: 1,
          orders: [],
          invoices: payload.invoiceAging.rows,
        },
      }),
    });
  });

  await page.route('**/reports/exceptions/export**', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="report-exceptions_2026-03-19.csv"',
      },
      body: 'Type,Severity\nSEVERELY_OVERDUE_INVOICE,HIGH\n',
    });
  });

  await page.route('**/reports/exceptions/export.xlsx**', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': 'attachment; filename="report-exceptions_2026-03-19.xlsx"',
      },
      body: 'xlsx-binary-placeholder',
    });
  });

  await page.goto('/reports');
  await expect(page.getByTestId('reports-filter-bar')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('reports-variance-section')).toBeVisible();
  await expect(page.getByTestId('reports-exceptions-section')).toBeVisible();
  await expect(page.getByTestId('reports-exceptions-total')).toContainText('2 open exceptions');
  await expect(page.getByTestId('reports-exception-row-invoice-1')).toContainText('INV-2026-001');

  const reloadResponse = page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().includes('/reports/release-two') && response.url().includes('comparisonMode=PREVIOUS_YEAR'),
  );
  await page.getByTestId('reports-comparison-mode').selectOption('PREVIOUS_YEAR');
  await reloadResponse;

  const exportResponse = page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().includes('/reports/exceptions/export'),
  );
  await page.getByTestId('reports-exceptions-export-csv').click();
  await exportResponse;

  const exportXlsxResponse = page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().includes('/reports/exceptions/export.xlsx'),
  );
  await page.getByTestId('reports-exceptions-export-xlsx').click();
  await exportXlsxResponse;

  const orderDrilldownResponse = page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().includes('/reports/drilldown/orders') && response.url().includes('dimension=TRADER'),
  );
  await page.getByTestId('reports-trader-drilldown-trader-1').click();
  await orderDrilldownResponse;
  await expect(page.getByTestId('reports-drilldown-panel')).toBeVisible();
  await expect(page.getByTestId('reports-drilldown-panel')).toContainText('Orders for Admin Trader');
  await expect(page.getByTestId('reports-drilldown-panel')).toContainText('ACME Shipping');
  await page.getByTestId('reports-drilldown-close').click();
  await expect(page.getByTestId('reports-drilldown-panel')).toHaveCount(0);

  const invoiceDrilldownResponse = page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().includes('/reports/drilldown/invoices') && response.url().includes('dimension=AGING_BUCKET'),
  );
  await page.getByTestId('reports-invoice-drilldown-61-90').click();
  await invoiceDrilldownResponse;
  await expect(page.getByTestId('reports-drilldown-panel')).toContainText('Invoices in 61-90');
  await expect(page.getByTestId('reports-drilldown-panel')).toContainText('INV-2026-001');
});

test('reports exception schedule UI posts the new mode and filters', async ({ page }) => {
  await loginViaUi(page, { email: adminEmail, password: adminPassword });

  const payload = buildReportPayload();
  let capturedBody: Record<string, unknown> | null = null;

  await page.route('**/reports/release-two**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: payload }),
    });
  });

  await page.route('**/reports/schedules', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    capturedBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [buildExceptionSchedule()] }),
    });
  });

  await page.goto('/reports');
  await expect(page.getByTestId('reports-schedule-mode')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('reports-schedule-mode').selectOption('EXCEPTIONS');
  await page.getByTestId('reports-schedule-name').fill('Exception Digest');
  await page.getByTestId('reports-schedule-description').fill('Only high-priority issues');
  await page.getByTestId('reports-schedule-exception-type-SEVERELY_OVERDUE_INVOICE').click();
  await expect(page.getByTestId('reports-schedule-send-only-non-empty')).toBeChecked();

  const createScheduleResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/reports/schedules'),
  );
  await page.getByTestId('reports-save-schedule').click();
  await createScheduleResponse;

  expect(capturedBody).not.toBeNull();
  expect(capturedBody?.['reportMode']).toBe('EXCEPTIONS');
  expect(capturedBody?.['sendOnlyWhenNonEmpty']).toBe(true);
  expect(capturedBody?.['exceptionTypes']).toEqual(['SEVERELY_OVERDUE_INVOICE']);

  await expect(page.getByTestId('reports-schedule-card-schedule-1')).toContainText('Exception Digest');
  await expect(page.getByTestId('reports-schedule-card-schedule-1')).toContainText('Exceptions');
  await expect(page.getByTestId('reports-schedule-card-schedule-1')).toContainText('Severely overdue invoices');
});