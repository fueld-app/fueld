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

  it('formats stored ETA dates using the configured date format (default ISO)', async () => {
    // Updated: formatDateLabel now delegates to DateFormatService which defaults
    // to ISO format (YYYY-MM-DD) instead of the old hardcoded en-GB format.
    // formatDateForInput uses the timezone input (defaults to UTC).
    const fixture = await createComponent();
    const component = fixture.componentInstance;
    const storedEta = '2026-04-11T12:00:00.000Z';

    // UTC timezone → same calendar day as the stored ISO date
    expect(component.formatDateForInput(storedEta)).toBe('2026-04-11');
    // DateFormatService defaults to ISO format
    expect(component.formatDateLabel(storedEta)).toBe('2026-04-11');
  });
});