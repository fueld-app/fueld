import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { vi } from 'vitest';

import { FilterOverlayComponent, EMPTY_FILTERS, type FilterState } from './filter-overlay.component';

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch {
  // Ignore when another test runner has already initialized the Angular test platform.
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('FilterOverlayComponent', () => {
  function setup(filters: FilterState = EMPTY_FILTERS, countFn: ((f: FilterState) => Promise<number>) | null = null) {
    TestBed.configureTestingModule({
      imports: [FilterOverlayComponent],
      schemas: [NO_ERRORS_SCHEMA],
    });
    const fixture = TestBed.createComponent(FilterOverlayComponent);
    fixture.componentRef.setInput('filters', filters);
    fixture.componentRef.setInput('fields', []);
    if (countFn !== null) {
      fixture.componentRef.setInput('countFn', countFn);
    }
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  }

  it('should create with default state — isOpen false, activeCount 0', () => {
    const { component } = setup();
    expect(component).toBeTruthy();
    expect(component.isOpen()).toBe(false);
    expect(component.activeCount()).toBe(0);
  });

  it('should open and populate draft from filters input', () => {
    const filters: FilterState = { clientId: 'abc-123', labels: { clientId: 'Test Client' } };
    const { component } = setup(filters);
    component.toggle();
    expect(component.isOpen()).toBe(true);
    expect(component.draft()['clientId']).toBe('abc-123');
    expect(component.draft().labels['clientId']).toBe('Test Client');
  });

  it('should emit filtersChange on apply with modified draft', () => {
    const { fixture, component } = setup();
    let emitted: FilterState | null = null;
    component.filtersChange.subscribe((state: FilterState) => {
      emitted = state;
    });

    component.toggle();
    component.onFieldChange('clientId', '123');
    component.apply();

    expect(emitted).not.toBeNull();
    expect(emitted!['clientId']).toBe('123');
  });

  it('should clear all filters to empty state', () => {
    const filters: FilterState = { clientId: 'abc', brokerId: 'def', labels: { clientId: 'C', brokerId: 'B' } };
    const { component } = setup(filters);
    component.toggle();
    expect(component.draft()['clientId']).toBe('abc');
    component.clearAll();
    expect(component.draft()['clientId']).toBeUndefined();
    expect(component.draft().labels).toEqual({});
  });

  it('should compute activeCount correctly with multiple filters', () => {
    const filters: FilterState = {
      clientId: 'abc',
      vesselId: 'v1',
      labels: { clientId: 'Client A', vesselId: 'Vessel X' },
    };
    const { component } = setup(filters);
    expect(component.activeCount()).toBe(2);
  });

  it('should suppress result count when no filters are active', async () => {
    const mockCountFn = vi.fn().mockResolvedValue(42);
    const { fixture, component } = setup(EMPTY_FILTERS, mockCountFn);

    component.toggle();
    expect(component.isOpen()).toBe(true);
    // Allow effect to run
    fixture.detectChanges();
    await fixture.whenStable();

    // countFn should NOT have been called because no filters are active
    expect(mockCountFn).not.toHaveBeenCalled();
    // resultCount should remain null (not -1 which means loading)
    expect(component.resultCount()).toBeNull();
  });

  it('should fire result count when filters are active', async () => {
    const mockCountFn = vi.fn().mockResolvedValue(7);
    const filters: FilterState = { clientId: 'abc', labels: {} };
    const { fixture, component } = setup(filters, mockCountFn);

    component.toggle();
    // Modify draft to trigger count
    component.onFieldChange('clientId', 'new-val');
    fixture.detectChanges();
    await fixture.whenStable();

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 600));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockCountFn).toHaveBeenCalled();
  });

  it('should reset async search state and count on close', () => {
    const { component } = setup();
    component.toggle();
    // Simulate some async state
    component.asyncOptions.set({ clientId: [{ value: '1', label: 'A' }] });
    component.asyncLoading.set({ clientId: true });
    component.resultCount.set(42);

    component.close();

    expect(component.isOpen()).toBe(false);
    expect(component.asyncOptions()).toEqual({});
    expect(component.asyncLoading()).toEqual({});
    expect(component.resultCount()).toBeNull();
  });
});