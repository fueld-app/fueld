import { beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DashboardPageComponent } from './dashboard-page.component';
import { AuthService } from '../../core/auth/auth.service';
import { RiskMonitoringService } from '../../core/risk-monitoring/risk-monitoring.service';

describe('DashboardPageComponent — date basis', () => {
  const LS_KEY = 'fueld.dashboard.dateBasis';

  beforeEach(() => {
    localStorage.removeItem(LS_KEY);
  });

  async function createComponent(): Promise<InstanceType<typeof DashboardPageComponent>> {
    await TestBed.configureTestingModule({
      imports: [DashboardPageComponent],
      providers: [
        { provide: AuthService, useValue: { user: () => null, isAdmin: () => false, isCreditManager: () => false } },
        {
          provide: RiskMonitoringService,
          useValue: { batchFrozen: async () => [] },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(DashboardPageComponent);
    return fixture.componentInstance;
  }

  it('defaults to delivery basis', async () => {
    const component = await createComponent();
    expect(component.dateBasis()).toBe('delivery');
    localStorage.removeItem(LS_KEY);
  });

  it('toggleDateBasis switches delivery → created and persists to localStorage', async () => {
    const component = await createComponent();
    component.toggleDateBasis();
    expect(component.dateBasis()).toBe('created');
    expect(localStorage.getItem(LS_KEY)).toBe('created');
    localStorage.removeItem(LS_KEY);
  });

  it('toggleDateBasis switches created → delivery and persists to localStorage', async () => {
    localStorage.setItem(LS_KEY, 'created');
    const component = await createComponent();
    expect(component.dateBasis()).toBe('created');
    component.toggleDateBasis();
    expect(component.dateBasis()).toBe('delivery');
    expect(localStorage.getItem(LS_KEY)).toBe('delivery');
    localStorage.removeItem(LS_KEY);
  });

  it('restore from localStorage prefers created when saved', async () => {
    localStorage.setItem(LS_KEY, 'created');
    const component = await createComponent();
    expect(component.dateBasis()).toBe('created');
    localStorage.removeItem(LS_KEY);
  });

  it('toggleTeamView persists teamView to localStorage (default false)', async () => {
    const component = await createComponent();
    expect(component.teamView()).toBe(false);
    component.toggleTeamView();
    expect(component.teamView()).toBe(true);
    expect(localStorage.getItem('fueld.dashboard.teamView')).toBe('true');
    component.toggleTeamView();
    expect(component.teamView()).toBe(false);
    expect(localStorage.getItem('fueld.dashboard.teamView')).toBe('false');
    localStorage.removeItem('fueld.dashboard.teamView');
  });

  it('teamView restores from localStorage when saved true', async () => {
    localStorage.setItem('fueld.dashboard.teamView', 'true');
    const component = await createComponent();
    expect(component.teamView()).toBe(true);
    localStorage.removeItem('fueld.dashboard.teamView');
  });

  it('buildDateQuery includes the current dateBasis param', async () => {
    const component = await createComponent();
    // component selectedDatePreset defaults to this_month
    const query = (component as unknown as { buildDateQuery(): string }).buildDateQuery();
    expect(query).toContain('dateBasis=delivery');
    component.toggleDateBasis();
    const query2 = (component as unknown as { buildDateQuery(): string }).buildDateQuery();
    expect(query2).toContain('dateBasis=created');
    localStorage.removeItem(LS_KEY);
  });
});