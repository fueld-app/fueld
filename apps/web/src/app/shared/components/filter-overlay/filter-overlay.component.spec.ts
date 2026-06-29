import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { vi } from 'vitest';

import { FilterOverlayComponent, EMPTY_FILTERS, type FilterState, type FilterFieldDef } from './filter-overlay.component';
import type { DropdownOption } from '../searchable-dropdown/searchable-dropdown.component';

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

  // ── Gap 4: Date clear button ─────────────────────────────────────

  it('should clear date field via clear button (onFieldChange with empty string)', () => {
    const filters: FilterState = { etaFrom: '2024-01-01', labels: {} };
    const { component } = setup(filters);
    component.toggle();
    expect(component.draft()['etaFrom']).toBe('2024-01-01');

    // Simulate clear button click
    component.onFieldChange('etaFrom', '');

    expect(component.draft()['etaFrom']).toBe('');
  });

  // ── Gap 6: Product filter field ──────────────────────────────────

  it('should show product filter field in dropdown fields', () => {
    const productField: FilterFieldDef = {
      key: 'productType',
      label: 'Product',
      type: 'dropdown',
      options: [{ value: 'ULSD', label: 'ULSD' }, { value: 'VLSFO', label: 'VLSFO' }],
    };
    const { fixture, component } = setup(EMPTY_FILTERS, null);
    fixture.componentRef.setInput('fields', [productField]);
    fixture.detectChanges();

    const dropdowns = component.dropdownFields();
    expect(dropdowns.length).toBe(1);
    expect(dropdowns[0].key).toBe('productType');
    expect(dropdowns[0].label).toBe('Product');
    expect(dropdowns[0].options?.length).toBe(2);
  });

  // ── Gap 8: Apply loading state ───────────────────────────────────

  it('should reflect applying input state', () => {
    const { fixture, component } = setup();
    expect(component.applying()).toBe(false);

    fixture.componentRef.setInput('applying', true);
    fixture.detectChanges();

    expect(component.applying()).toBe(true);
  });

  // ── Gap 2: Async search staleness guard ────────────────────────────

  it('should ignore stale async search responses', async () => {
    let resolveA: (opts: DropdownOption[]) => void = () => {};
    let resolveB: (opts: DropdownOption[]) => void = () => {};
    const promiseA = new Promise<DropdownOption[]>((r) => { resolveA = r; });
    const promiseB = new Promise<DropdownOption[]>((r) => { resolveB = r; });

    const searchFn = (term: string) => term === 'aaa' ? promiseA : promiseB;
    const field: FilterFieldDef = { key: 'raceKey', label: 'Race', type: 'dropdown', searchFn };

    const { fixture, component } = setup(EMPTY_FILTERS, null);
    fixture.componentRef.setInput('fields', [field]);
    fixture.detectChanges();

    // Fire both searches without awaiting
    const p1 = (component as any).doSearch(field, 'aaa');
    const p2 = (component as any).doSearch(field, 'bbb');

    // Resolve second first (out of order)
    resolveB([{ value: 'b-val', label: 'B' }]);
    await p2;

    // Now resolve first (stale — should be ignored)
    resolveA([{ value: 'a-val', label: 'A' }]);
    await p1;

    fixture.detectChanges();

    // asyncOptions should have 'bbb' results, not 'aaa'
    const opts = component.asyncOptions()['raceKey'] ?? [];
    expect(opts.length).toBe(1);
    expect(opts[0].value).toBe('b-val');
  });
});