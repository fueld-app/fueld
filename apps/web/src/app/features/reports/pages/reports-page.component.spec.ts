import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { Role } from '@fueld/types';
import type { ReleaseTwoReportsDto } from '@fueld/types';
import { ReportsPageComponent } from './reports-page.component';

function buildReportPayload(): ReleaseTwoReportsDto {
  return {
    generatedAt: '2026-03-19T10:00:00.000Z',
    access: {
      role: Role.Admin,
      scope: 'ALL',
      canExport: true,
      canViewFinance: true,
      canViewTeamPerformance: true,
      canViewCollections: true,
      canManageSharedViews: true,
      canManageSchedules: true,
    },
    filtersApplied: {},
    filterOptions: { traders: [], teams: [], customers: [], products: [] },
    savedViews: [{
      id: 'view-1',
      name: 'Base view',
      description: 'Original',
      filters: { productType: 'VLSFO' },
      createdAt: '2026-03-19T10:00:00.000Z',
      updatedAt: '2026-03-19T10:00:00.000Z',
      createdByName: 'Admin',
    }],
    schedules: [{
      id: 'schedule-1',
      name: 'Daily summary',
      description: 'Original schedule',
      reportType: 'SUMMARY',
      deliveryMode: 'HTML',
      bodyMode: 'HTML_SUMMARY',
      hourUtc: 8,
      recipientRoles: [Role.Admin, Role.Finance],
      extraEmails: ['ops@fueld.test'],
      filters: {},
      isActive: true,
      lastSentAt: null,
      createdAt: '2026-03-19T10:00:00.000Z',
      updatedAt: '2026-03-19T10:00:00.000Z',
    }],
    traderPerformance: {
      rows: [],
      totals: {
        orderCount: 0,
        wonCount: 0,
        lostCount: 0,
        winRate: 0,
        totalVolume: '0.000',
        totalRevenue: '0.00',
        totalGrossProfit: '0.00',
        totalFinancingCost: '0.00',
        totalNetProfit: '0.00',
        avgDealSize: '0.00',
      },
    },
    invoiceAging: {
      rows: [],
      buckets: [],
      totalInvoices: 0,
      totalOutstanding: '0.00',
    },
    commercialSummary: {
      conversion: { totalInquiries: 0, totalWon: 0, totalLost: 0, winRate: 0, avgDaysToClose: null },
      lossAnalysis: { totalCancelled: 0, reasons: [] },
      pipeline: [],
    },
    marginAnalysis: {
      byCustomer: [],
      byProduct: [],
      byVessel: [],
      monthlyTrend: [],
    },
  };
}

describe('ReportsPageComponent', () => {
  it('updates an existing saved view through the patch endpoint', async () => {
    const payload = buildReportPayload();
    const patchCalls: Array<{ url: string; body: unknown }> = [];

    await TestBed.configureTestingModule({
      imports: [ReportsPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: HttpClient,
          useValue: {
            get: () => of({ success: true, data: payload }),
            post: () => of({ success: true, data: payload.savedViews }),
            delete: () => of({ success: true, data: payload.savedViews }),
            patch: (url: string, body: any) => {
              patchCalls.push({ url, body });
              return of({
                success: true,
                data: [{ ...payload.savedViews[0], ...body }],
              });
            },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ReportsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.startEditSavedView(payload.savedViews[0]!);
    component.newViewName.set('Updated view');
    await component.saveCurrentView();

    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0]?.url).toContain('/reports/saved-views/view-1');
    expect((patchCalls[0]?.body as { name: string }).name).toBe('Updated view');
    expect(component.data()?.savedViews[0]?.name).toBe('Updated view');
    expect(component.editingViewId()).toBeNull();
  });

  it('updates an existing schedule through the patch endpoint', async () => {
    const payload = buildReportPayload();
    const patchCalls: Array<{ url: string; body: unknown }> = [];

    await TestBed.configureTestingModule({
      imports: [ReportsPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: HttpClient,
          useValue: {
            get: () => of({ success: true, data: payload }),
            post: () => of({ success: true, data: payload.schedules }),
            delete: () => of({ success: true, data: payload.schedules }),
            patch: (url: string, body: any) => {
              patchCalls.push({ url, body });
              return of({
                success: true,
                data: [{ ...payload.schedules[0], ...body }],
              });
            },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ReportsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.startEditSchedule(payload.schedules[0]!);
    component.scheduleDeliveryMode.set('CSV_XLSX');
    component.scheduleBodyMode.set('ATTACHMENT_ONLY');
    component.scheduleActive.set(false);
    await component.saveSchedule();

    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0]?.url).toContain('/reports/schedules/schedule-1');
    expect((patchCalls[0]?.body as { deliveryMode: string }).deliveryMode).toBe('CSV_XLSX');
    expect((patchCalls[0]?.body as { bodyMode: string }).bodyMode).toBe('ATTACHMENT_ONLY');
    expect((patchCalls[0]?.body as { isActive: boolean }).isActive).toBe(false);
    expect(component.data()?.schedules[0]?.deliveryMode).toBe('CSV_XLSX');
    expect(component.editingScheduleId()).toBeNull();
  });

  it('requests XLSX exports from the dedicated endpoint', async () => {
    const payload = buildReportPayload();
    const getCalls: string[] = [];

    await TestBed.configureTestingModule({
      imports: [ReportsPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: HttpClient,
          useValue: {
            get: (url: string) => {
              getCalls.push(url);
              if (url.includes('/reports/release-two')) {
                return of({ success: true, data: payload });
              }
              return of({
                headers: { get: () => 'attachment; filename="margin-analysis.xlsx"' },
                body: new Blob(['xlsx']),
              });
            },
            post: () => of({ success: true, data: payload.schedules }),
            delete: () => of({ success: true, data: payload.schedules }),
            patch: () => of({ success: true, data: payload.schedules }),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ReportsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    let downloadCalled = false;
    (component as any).downloadBlob = () => {
      downloadCalled = true;
    };

    await component.exportReport('margin-analysis', 'xlsx');

    expect(getCalls.some((url) => url.includes('/reports/margin-analysis/export.xlsx'))).toBe(true);
    expect(downloadCalled).toBe(true);
  });
});