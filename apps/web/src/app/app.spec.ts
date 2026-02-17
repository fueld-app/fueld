import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { AppUpdateService } from './core/pwa/app-update.service';
import { PushService } from './core/pwa/push.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: AppUpdateService, useValue: { init: () => {} } },
        { provide: PushService, useValue: { init: () => {} } },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render router outlet', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });
});
