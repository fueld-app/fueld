import { afterEach, describe, expect, it } from 'bun:test';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { JSDOM } from 'jsdom';
import { OrderFinancingSummaryComponent } from './order-financing-summary.component';

const dom = new JSDOM('<!doctype html><html><body></body></html>');

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  Event: dom.window.Event,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch {
  // Ignore when another test runner has already initialized the Angular test platform.
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('OrderFinancingSummaryComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderFinancingSummaryComponent],
    }).compileComponents();
  });

  it('renders the financing metrics for an order', async () => {
    const fixture = TestBed.createComponent(OrderFinancingSummaryComponent);
    const component = fixture.componentInstance as OrderFinancingSummaryComponent & {
      financingRateAnnual: () => number;
      financingDays: () => number;
      financingDayCountConvention: () => number;
      economics: () => {
        totalQuantity: number;
        totalCost: number;
        totalRevenue: number;
        totalGrossProfit: number;
        totalFinancingCost: number;
        financingCostPerMt: number;
        totalNetProfit: number;
        netMarginPct: number;
      };
    };

    component.financingRateAnnual = () => 0.08;
    component.financingDays = () => 15;
    component.financingDayCountConvention = () => 365;
    component.economics = () => ({
      totalQuantity: 800,
      totalCost: 1276000,
      totalRevenue: 1308000,
      totalGrossProfit: 32000,
      totalFinancingCost: 4195.0685,
      financingCostPerMt: 5.2438,
      totalNetProfit: 27804.9315,
      netMarginPct: 2.1258,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Financing Summary');
    expect(text).toContain('8.00% p.a.');
    expect(text).toContain('15 days');
    expect(text).toContain('32,000.00 USD');
    expect(text).toContain('4,195.07 USD');
    expect(text).toContain('27,804.93 USD');
    expect(text).toContain('2.13%');
    expect(text).toContain('5.24 USD');
    expect(text).toContain('365');
  });
});