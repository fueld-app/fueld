import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { InquiriesListPageComponent } from './inquiries-list-page.component';
import { NewInquiryModalService } from '@app/core/trading/new-inquiry-modal.service';

describe('InquiriesListPageComponent', () => {
  beforeEach(async () => {
    const http = {
      get: (url: string) => {
        if (url.includes('/orders?')) {
          return of({
            success: true,
            data: {
              items: [
                {
                  id: 'order-1',
                  orderNumber: 'ORD-001',
                  status: 'CONFIRMED',
                  clientName: 'Riviera Marine',
                  vesselName: 'M/Y Example',
                  placeName: 'Monaco',
                  salesRepName: 'Patrick',
                  eta: '2026-03-10T00:00:00.000Z',
                  totalValue: 1308000,
                  totalProfit: 32000,
                  totalFinancingCost: 4195.0685,
                  totalNetProfit: 27804.9315,
                  netMarginPct: 2.1258,
                  createdAt: '2026-03-08T00:00:00.000Z',
                  updatedAt: '2026-03-08T00:00:00.000Z',
                },
              ],
              total: 1,
            },
          });
        }

        return of({ success: true, data: { items: [], total: 0 } });
      },
    };

    await TestBed.configureTestingModule({
      imports: [InquiriesListPageComponent],
      providers: [
        provideRouter([]),
        { provide: HttpClient, useValue: http },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: NewInquiryModalService, useValue: { requestId: signal(0) } },
      ],
    }).compileComponents();
  });

  it('shows gross, financing, and net metrics on order lists', async () => {
    const fixture = TestBed.createComponent(InquiriesListPageComponent);
    fixture.componentRef.setInput('mode', 'active-orders');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Gross (USD)');
    expect(text).toContain('Financing (USD)');
    expect(text).toContain('Net (USD)');
    expect(text).toContain('32,000.00');
    expect(text).toContain('4,195.07');
    expect(text).toContain('27,804.93');
    expect(text).toContain('Net Margin 2.13%');
  });
});