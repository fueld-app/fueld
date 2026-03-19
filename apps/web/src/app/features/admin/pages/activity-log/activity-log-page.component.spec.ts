import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { of } from 'rxjs';
import { ActivityLogPageComponent } from './activity-log-page.component';
import { WebSocketService } from '../../../../core/websocket/websocket.service';

describe('ActivityLogPageComponent', () => {
  async function createComponent() {
    await TestBed.configureTestingModule({
      imports: [ActivityLogPageComponent],
      providers: [
        {
          provide: HttpClient,
          useValue: {
            get: (url: string) => {
              if (url.includes('/admin/users')) {
                return of({ success: true, data: [] });
              }
              if (url.includes('/admin/settings/activity-retention')) {
                return of({ success: true, data: { retentionDays: 90 } });
              }
              if (url.includes('/admin/activity')) {
                return of({ success: true, data: { items: [], total: 0 } });
              }
              return of({ success: true, data: null });
            },
            put: () => of({ success: true, data: { retentionDays: 90 } }),
          },
        },
        {
          provide: WebSocketService,
          useValue: {
            on: () => of([]),
            send: () => undefined,
            sendPresence: () => undefined,
          },
        },
        {
          provide: Title,
          useValue: {
            setTitle: () => undefined,
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ActivityLogPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('renders report entity options in the audit log filter', async () => {
    const fixture = await createComponent();
    const component = fixture.componentInstance;

    component.activeTab.set('log');
    fixture.detectChanges();
    await fixture.whenStable();

    const entityFilter = fixture.nativeElement.querySelector('[data-testid="activity-log-entity-filter"]') as HTMLSelectElement | null;
    expect(entityFilter).not.toBeNull();

    const optionValues = Array.from(entityFilter?.options ?? []).map((option) => option.value);
    expect(optionValues).toContain('report_saved_view');
    expect(optionValues).toContain('report_schedule');
  });

  it('maps report entities to readable labels', async () => {
    const fixture = await createComponent();
    const component = fixture.componentInstance;

    expect(component.formatEntityLabel('report_saved_view')).toBe('Report Saved Views');
    expect(component.formatEntityLabel('report_schedule')).toBe('Report Schedules');
  });
});
