import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import type { BankAccountDto, OwnCompanyDto } from '@fueld/types';
import { OrderDetailPageComponent } from './order-detail-page.component';
import { AuthService } from '../../../../core/auth/auth.service';
import { RiskMonitoringService } from '../../../../core/risk-monitoring/risk-monitoring.service';

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch {
  // Ignore when another test runner has already initialized the Angular test platform.
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  Object.assign(globalThis, {
    ResizeObserver: ResizeObserverStub,
  });
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener(): void {},
      removeListener(): void {},
      addEventListener(): void {},
      removeEventListener(): void {},
      dispatchEvent(): boolean { return false; },
    }),
  });
}

afterEach(() => {
  TestBed.resetTestingModule();
});

function buildOwnCompany(id: string, name: string): OwnCompanyDto {
  return {
    id,
    name,
    country: null,
    countryIso: null,
    logoUrl: null,
    brandColor: null,
    customerTerms: null,
    supplierTerms: null,
    vatNumber: null,
    companyRegistrationNumber: null,
    fraudPreventionText: null,
    latePaymentInterest: null,
  };
}

function buildBankAccount(id: string, currency: string, isDefault = false): BankAccountDto {
  return {
    id,
    counterpartyId: 'company-1',
    label: `${currency} Account`,
    bankName: 'Bank',
    accountName: null,
    accountNumber: null,
    iban: null,
    swiftBic: null,
    currency,
    branchAddress: null,
    sortCode: null,
    routingNumber: null,
    intermediaryBank: null,
    isDefault,
    notes: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  };
}

describe('OrderDetailPageComponent', () => {
  async function createComponent(options?: {
    onPost?: (url: string, body: unknown) => void;
    onPut?: (url: string, body: unknown) => { success: boolean; data?: unknown; message?: string } | void;
  }): Promise<{
    component: OrderDetailPageComponent;
    fixture: ReturnType<typeof TestBed.createComponent<OrderDetailPageComponent>>;
  }> {
    await TestBed.configureTestingModule({
      imports: [OrderDetailPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: 'order-1' })),
          },
        },
        {
          provide: HttpClient,
          useValue: {
            get: () => of({ success: true, data: [] }),
            post: (url: string, body: unknown) => {
              options?.onPost?.(url, body);
              if (String(url).includes('/inquiry/defaults')) {
                return of({
                  success: true,
                  data: {
                    subject: 'Inquiry Recife - Hesperides (navy)',
                    htmlBody: `
                      <table>
                        <tr><td>Vessel:</td><td>Hesperides (navy)</td></tr>
                        <tr><td>Place:</td><td>Recife</td></tr>
                        <tr><td>Reply within:</td><td>6 hours</td></tr>
                        <tr><td>Account:</td><td>Riviera Marine S.A.M.</td></tr>
                      </table>
                    `,
                    eta: null,
                    etd: null,
                    responseDeadlineAt: '2026-04-17T12:00:00.000Z',
                  },
                });
              }
              return of({ success: true, data: [] });
            },
            put: (url: string, body: unknown) => of(options?.onPut?.(url, body) ?? { success: true, data: [] }),
            patch: () => of({ success: true, data: [] }),
            delete: () => of({ success: true, data: [] }),
          },
        },
        {
          provide: AuthService,
          useValue: {
            user: signal({ id: 'user-1' }),
            userName: signal('Test User'),
            userEmail: signal('test@fueld.local'),
          },
        },
        {
          provide: RiskMonitoringService,
          useValue: {
            isFrozen: async () => false,
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrderDetailPageComponent);
    fixture.detectChanges();
    return { component: fixture.componentInstance, fixture };
  }

  it('falls back to the first invoicing company when the current selection is empty', async () => {
    const { component } = await createComponent();

    component.order.set({
      invoicingCompanyId: null,
      bankAccountId: 'bank-stale',
      currency: 'USD',
    } as any);
    const companies = [
      buildOwnCompany('company-1', 'Alpha Trading'),
      buildOwnCompany('company-2', 'Beta Trading'),
    ];
    component.ownCompanies.set(companies);

    const selectedCompanyId = (component as any).applyPreferredInvoicingCompanySelection(companies);

    expect(selectedCompanyId).toBe('company-1');
    expect(component.order()?.invoicingCompanyId).toBe('company-1');
    expect(component.order()?.bankAccountId).toBeNull();
  });

  it('does not clear the current invoicing company when a blank selection is emitted', async () => {
    const { component } = await createComponent();

    component.order.set({
      invoicingCompanyId: 'company-2',
      bankAccountId: 'bank-1',
      currency: 'USD',
    } as any);
    component.ownCompanies.set([
      buildOwnCompany('company-1', 'Alpha Trading'),
      buildOwnCompany('company-2', 'Beta Trading'),
    ]);

    component.onInvoicingCompanyChange('');

    expect(component.order()?.invoicingCompanyId).toBe('company-2');
    expect(component.order()?.bankAccountId).toBe('bank-1');
  });

  it('does not clear the current bank account when a blank selection is emitted', async () => {
    const { component } = await createComponent();

    component.order.set({
      invoicingCompanyId: 'company-1',
      bankAccountId: 'bank-2',
      currency: 'EUR',
    } as any);
    component.bankAccounts.set([
      buildBankAccount('bank-1', 'USD', true),
      buildBankAccount('bank-2', 'EUR'),
    ]);

    component.onBankAccountChange('');

    expect(component.order()?.bankAccountId).toBe('bank-2');
  });

  it('selects a preferred bank account when accounts exist and the current selection is empty', async () => {
    const { component } = await createComponent();

    component.order.set({
      invoicingCompanyId: 'company-1',
      bankAccountId: null,
      currency: 'EUR',
    } as any);
    const accounts = [
      buildBankAccount('bank-1', 'USD', true),
      buildBankAccount('bank-2', 'EUR'),
    ];

    (component as any).applyPreferredBankAccountSelection(accounts);

    expect(component.order()?.bankAccountId).toBe('bank-2');
  });

  it('builds item payload quantityMax from the current quantity instead of a stale stored quantityMax', async () => {
    const { component } = await createComponent();

    const payload = (component as any).buildItemPayload([
      {
        id: 'item-1',
        orderSupplierId: null,
        productType: 'VLSFO',
        description: 'RMG380',
        quantity: 300,
        quantityMin: 265,
        quantityMax: 265,
        unit: 'MT',
        costUnit: 'MT',
        salesUnit: 'MT',
        costConversionFactor: 1,
        unitConversionFactor: 1,
        costPrice: 0,
        costCurrency: 'USD',
        salesPrice: 0,
        salesCurrency: 'USD',
        profit: 0,
        paymentTerms: '',
        customerNote: null,
        deliveredQuantity: null,
        costPricingModel: 'FIXED',
        costReferenceId: null,
        costPlattsEntryId: null,
        costPremium: null,
        costBarging: null,
        costBargingUnit: null,
        costCreditDays: null,
        costPriceFinalized: false,
        salesPricingModel: 'FIXED',
        salesReferenceId: null,
        salesPlattsEntryId: null,
        salesPremium: null,
        salesBarging: null,
        salesBargingUnit: null,
        salesCreditDays: null,
        salesPriceFinalized: false,
      },
    ]);

    expect(payload[0]?.quantity).toBe('300');
    expect(payload[0]?.quantityMin).toBe('265');
    expect(payload[0]?.quantityMax).toBe('300');
  });

  it('keeps ETA min date aligned with the stored calendar day for positive-offset ports', async () => {
    const { component } = await createComponent();

    component.port.set({ timezone: 'Pacific/Fiji' } as any);
    component.order.set({ eta: '2026-04-11T12:00:00.000Z' } as any);

    expect(component.etaMinDateTime()).toBe('2026-04-11');
  });

  it('keeps delivered-at input aligned with the stored calendar day for positive-offset ports', async () => {
    const { component } = await createComponent();

    component.port.set({ timezone: 'Pacific/Fiji' } as any);
    component.order.set({ deliveredAt: '2026-04-11T12:00:00.000Z' } as any);

    expect(component.deliveredAtLocal()).toBe('2026-04-11');
    expect(component.formatStoredDateOnlyLabel('2026-04-11T12:00:00.000Z')).toBe('11 Apr 2026');
  });

  it('passes the current order eta into the send inquiry modal defaults request', async () => {
    const capturedPosts: Array<{ url: string; body: unknown }> = [];
    const { component, fixture } = await createComponent({
      onPost: (url, body) => {
        capturedPosts.push({ url, body });
      },
    });

    component.order.set({
      id: 'order-1',
      orderNumber: '20260415-000179',
      placeId: 'place-1',
      vesselId: 'vessel-1',
      clientId: 'client-1',
      tenantId: 'tenant-1',
      status: 'INQUIRY',
      invoicingCompanyId: 'company-1',
      bankAccountId: null,
      currency: 'USD',
      eta: '2026-04-15T12:00:00.000Z',
      etd: null,
    } as any);
    component.port.set({ id: 'place-1', name: 'Recife', timezone: 'UTC' } as any);
    component.vessel.set({ id: 'vessel-1', name: 'Hesperides (navy)', imo: null } as any);
    component.ownCompanies.set([buildOwnCompany('company-1', 'Riviera Marine S.A.M.')]);
    component.itemRows.set([
      {
        id: 'item-1',
        orderSupplierId: null,
        productType: 'LSMGO',
        description: 'DMA',
        quantity: 210,
        quantityMin: null,
        quantityMax: 210,
        unit: 'CBM',
        costUnit: 'CBM',
        salesUnit: 'CBM',
        costConversionFactor: 1,
        unitConversionFactor: 1,
        costPrice: 0,
        costCurrency: 'USD',
        salesPrice: 0,
        salesCurrency: 'USD',
        profit: 0,
        paymentTerms: '',
        customerNote: null,
        deliveredQuantity: null,
        costPricingModel: 'FIXED',
        costReferenceId: null,
        costPlattsEntryId: null,
        costPremium: null,
        costBarging: null,
        costBargingUnit: null,
        costCreditDays: null,
        costPriceFinalized: false,
        salesPricingModel: 'FIXED',
        salesReferenceId: null,
        salesPlattsEntryId: null,
        salesPremium: null,
        salesBarging: null,
        salesBargingUnit: null,
        salesCreditDays: null,
        salesPriceFinalized: false,
      },
    ] as any);

    fixture.detectChanges();

    expect(component.inquiryModal()?.eta()).toBe('2026-04-15T12:00:00.000Z');

    component.openSendInquiryModal();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const defaultsCall = capturedPosts.find((entry) => entry.url.includes('/inquiry/defaults'));

    expect(defaultsCall?.body).toEqual({
      eta: '2026-04-15T12:00:00.000Z',
      etd: null,
    });
    expect(component.inquiryModal()?.htmlBody()).toContain('Delivery:');
  });

  it('shows an error when saving order items fails', async () => {
    const putCalls: Array<{ url: string; body: unknown }> = [];
    const { component } = await createComponent({
      onPut: (url, body) => {
        putCalls.push({ url, body });
        if (String(url).includes('/orders/order-1/items')) {
          return { success: false, data: [], message: 'Failed to save items' };
        }
        return { success: true, data: {} };
      },
    });

    component.order.set({
      id: 'order-1',
      clientId: 'client-1',
      vesselId: 'vessel-1',
      placeId: 'place-1',
      salesRepId: 'user-1',
      invoicingCompanyId: 'company-1',
      bankAccountId: 'bank-1',
      currency: 'USD',
      status: 'CONFIRMED',
      eta: '2026-04-15T12:00:00.000Z',
      etd: null,
      customerPaymentTermType: null,
      customerCreditDays: null,
      customerNote: null,
      customerContactId: null,
      supplierId: null,
      supplierPaymentTermType: null,
      supplierCreditDays: null,
      supplierNote: null,
      supplierContactId: null,
      brokerId: null,
      brokerContactId: null,
      brokerGetsAll: false,
      agentId: null,
      agentContactId: null,
      termsAndConditions: null,
      deliveredAt: null,
    } as any);
    component.itemRows.set([
      {
        id: 'item-1',
        orderSupplierId: null,
        productType: 'DMA',
        description: 'DMA 2017',
        quantity: 500,
        quantityMin: null,
        quantityMax: 500,
        unit: 'MT',
        costUnit: 'MT',
        salesUnit: 'MT',
        costConversionFactor: 1,
        unitConversionFactor: 1,
        costPrice: 2662,
        costCurrency: 'USD',
        salesPrice: 2662,
        salesCurrency: 'USD',
        profit: 0,
        paymentTerms: '',
        customerNote: null,
        deliveredQuantity: 500,
        costPricingModel: 'FIXED',
        costReferenceId: null,
        costPlattsEntryId: null,
        costPremium: null,
        costBarging: null,
        costBargingUnit: null,
        costCreditDays: null,
        costPriceFinalized: false,
        salesPricingModel: 'FIXED',
        salesReferenceId: null,
        salesPlattsEntryId: null,
        salesPremium: null,
        salesBarging: null,
        salesBargingUnit: null,
        salesCreditDays: null,
        salesPriceFinalized: false,
      },
    ] as any);

    await component.saveOrder();

    expect(putCalls.some((call) => call.url.includes('/orders/order-1/items'))).toBe(true);
    expect(component.toast()).toEqual({ type: 'error', message: 'Failed to save order.' });
  });
});