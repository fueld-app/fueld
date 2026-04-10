import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { provideRouter } from '@angular/router';
import { TradingDetailMetaCardsComponent } from './detail-meta-cards.component';

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch {
  // Ignore when another test runner has already initialized the Angular test platform.
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('TradingDetailMetaCardsComponent', () => {
  async function createComponent() {
    await TestBed.configureTestingModule({
      imports: [TradingDetailMetaCardsComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    return TestBed.createComponent(TradingDetailMetaCardsComponent);
  }

  it('renders stored ETA dates as the same calendar day in positive-offset ports', async () => {
    const fixture = await createComponent();
    const component = fixture.componentInstance;
    const storedEta = '2026-04-11T12:00:00.000Z';

    expect(component.formatDateForInput(storedEta)).toBe('2026-04-11');
    expect(component.formatDateLabel(storedEta)).toBe('11 Apr 2026');
  });
});