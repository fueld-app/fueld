import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { of } from 'rxjs';
import { SendInquiryModalComponent, type SupplierRow } from './send-inquiry-modal.component';

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch {
  // Ignore when another test runner has already initialized the Angular test platform.
}

afterEach(() => {
  TestBed.resetTestingModule();
});

function buildSupplierRow(): SupplierRow {
  return {
    portSupplierId: 'port-supplier-1',
    supplierId: 'supplier-1',
    supplierName: 'Alpha Bunkers',
    contactId: null,
    contactName: null,
    phone: null,
    waContactId: null,
    waContactName: null,
    products: [],
    note: null,
    email: 'ops@alpha.test',
    inquiryStatus: null,
    inquirySentAt: null,
    performance: {
      deliveredCountOverall: 0,
      deliveredCountAtPlace: 0,
      lastDeliveredAtOverall: null,
      lastDeliveredAtPlace: null,
      sentCount: 0,
      quotedCount: 0,
      declinedCount: 0,
      noReplyCount: 0,
      respondedCount: 0,
      deliverableCount: 0,
      nonDeliverableCount: 0,
      averageResponseHours: null,
    },
    companyEmails: [],
    contacts: [],
    selected: true,
    emailOverride: '',
    phoneOverride: '',
    expanded: false,
    ccCompanyEmail: false,
    personalNote: '',
  };
}

describe('SendInquiryModalComponent', () => {
  async function createComponent(options?: {
    defaults?: Record<string, any>;
  }): Promise<{
    component: SendInquiryModalComponent;
    fixture: ReturnType<typeof TestBed.createComponent<SendInquiryModalComponent>>;
  }> {
    const defaults = options?.defaults ?? {
      subject: 'Inquiry Singapore - MV TEST',
      htmlBody: `
        <table>
          <tr><td>Vessel:</td><td>MV TEST</td></tr>
          <tr><td>Place:</td><td>Singapore</td></tr>
          <tr><td>Reply within:</td><td>2 days</td></tr>
          <tr><td>Account:</td><td>Fueld</td></tr>
        </table>
      `,
      eta: '2026-04-15T12:00:00.000Z',
      etd: null,
      responseDeadlineAt: '2026-04-17T12:00:00.000Z',
    };

    await TestBed.configureTestingModule({
      imports: [SendInquiryModalComponent],
      providers: [
        {
          provide: HttpClient,
          useValue: {
            get: () => of({ success: true, data: [] }),
            post: () => of({ success: true, data: defaults }),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SendInquiryModalComponent);
    fixture.componentRef.setInput('orderId', 'order-1');
    fixture.componentRef.setInput('portName', 'Singapore');
    fixture.componentRef.setInput('vesselName', 'MV TEST');
    fixture.componentRef.setInput('senderName', 'Trader');
    fixture.componentRef.setInput('companyName', 'Fueld');
    fixture.componentRef.setInput('eta', '');
    fixture.componentRef.setInput('etd', '');
    fixture.detectChanges();

    return { component: fixture.componentInstance, fixture };
  }

  it('uses resolved inquiry dates from defaults when the bound inputs are blank', async () => {
    const { component, fixture } = await createComponent();

    component.show();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(component.inquiryEta()).toBe('2026-04-15T12:00:00.000Z');
    expect(component.htmlBody()).toContain('Delivery:');
    expect(component.htmlBody()).toContain('15 Apr 2026');
  });

  it('resyncs the inquiry body when eta arrives after the modal is opened', async () => {
    const { component, fixture } = await createComponent({
      defaults: {
        subject: 'Inquiry Recife - Hesperides',
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

    component.show();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(component.htmlBody()).not.toContain('Delivery:');

    fixture.componentRef.setInput('eta', '2026-04-15T12:00:00.000Z');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(component.htmlBody()).toContain('Delivery:');
    expect(component.htmlBody()).toContain('15 Apr 2026');
  });

  it('can disable the response deadline per inquiry and emits a null deadline', async () => {
    const { component, fixture } = await createComponent();

    component.show();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));

    component.suppliers.set([buildSupplierRow()]);

    let emittedPayload: any = null;
    component.sendInquiry.subscribe((payload) => {
      emittedPayload = payload;
    });

    component.onResponseDeadlineToggle(false);
    component.send();

    expect(component.responseDeadlineAt()).toBe('');
    expect(component.htmlBody()).not.toContain('Reply within:');
    expect(emittedPayload?.responseDeadlineAt).toBeNull();
  });
});
