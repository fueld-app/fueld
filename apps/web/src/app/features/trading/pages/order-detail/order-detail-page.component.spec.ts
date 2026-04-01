import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import type { BankAccountDto, OwnCompanyDto } from '@fueld/types';
import { OrderDetailPageComponent } from './order-detail-page.component';
import { AuthService } from '../../../../core/auth/auth.service';
import { RiskMonitoringService } from '@app/core/risk-monitoring/risk-monitoring.service';

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
  async function createComponent(): Promise<OrderDetailPageComponent> {
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
            post: () => of({ success: true, data: [] }),
            put: () => of({ success: true, data: [] }),
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
    return fixture.componentInstance;
  }

  it('falls back to the first invoicing company when the current selection is empty', async () => {
    const component = await createComponent();

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
    const component = await createComponent();

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
    const component = await createComponent();

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
    const component = await createComponent();

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
});