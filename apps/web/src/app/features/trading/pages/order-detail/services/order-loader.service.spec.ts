import { beforeEach, describe, expect, it } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import type { ApiResponse } from '@fueld/types';
import { OrderLoaderService } from './order-loader.service';

/**
 * Regression guard for the Phase 2 supplier credit-note fields.
 *
 * OrderLoaderService builds `result.order` as an explicit literal. It once
 * dropped `orderSuppliers`, `supplierCreditNotes`, `totalSupplierCredits`,
 * `expectedSupplierCredits` and `netProfitAfterCredits` — so the credit-note
 * modal's supplier-leg dropdown was always empty ('Select a supplier leg.')
 * for every order on every tenant (Allan, Riviera Marine — order
 * 20260911-000522, 2026-09-16). These tests fail if the fields are ever
 * dropped from the mapping again.
 */

const ORDER_ID = 'd01a7349-7505-485d-90af-2da3c5f3bdc4';

function detailPayload() {
  return {
    id: ORDER_ID,
    orderNumber: '20260911-000522',
    currency: 'USD',
    status: 'CONFIRMED',
    supplierId: 'supplier-1',
    // fields under test — must survive the loader's order literal
    orderSuppliers: [
      { id: 'leg-1', companyId: 'supplier-1', isPrimary: true, sortOrder: 0 },
      { id: 'leg-2', companyId: 'supplier-2', isPrimary: false, sortOrder: 1 },
    ],
    supplierCreditNotes: [
      { id: 'cn-1', orderSupplierId: 'leg-1', amount: '5.00', currency: 'USD', status: 'EXPECTED' },
    ],
    totalSupplierCredits: '12.50',
    expectedSupplierCredits: '5.00',
    netProfitAfterCredits: '1469.5000',
  };
}

function makeService(payload: Record<string, unknown>) {
  const fakeHttp = {
    get: (url: string) => {
      if (url.includes('/companies/own')) return of({ success: true, data: [] });
      return of({ success: true, data: payload } as ApiResponse<unknown>);
    },
  };
  const injector = Injector.create({ providers: [{ provide: HttpClient, useValue: fakeHttp }] });
  return runInInjectionContext(injector, () => new OrderLoaderService());
}

describe('OrderLoaderService — supplier credit-note field mapping', () => {
  it('passes orderSuppliers, credit notes and credit totals through onto order()', async () => {
    const r = await makeService(detailPayload()).load(ORDER_ID);

    expect(r.order?.orderSuppliers).toEqual(detailPayload().orderSuppliers);
    expect(r.order?.supplierCreditNotes).toEqual(detailPayload().supplierCreditNotes);
    expect(r.order?.totalSupplierCredits).toBe('12.50');
    expect(r.order?.expectedSupplierCredits).toBe('5.00');
    expect(r.order?.netProfitAfterCredits).toBe('1469.5000');
    // legs also remain available on their dedicated field
    expect(r.orderSuppliers.map((s) => s.id)).toEqual(['leg-1', 'leg-2']);
    expect(r.orderSuppliers[0].isPrimary).toBe(true);
  });

  it('degrades gracefully when the payload omits the credit-note fields (legacy/older API)', async () => {
    const { orderSuppliers, supplierCreditNotes, totalSupplierCredits, expectedSupplierCredits, netProfitAfterCredits, ...minimal } =
      detailPayload();
    const r = await makeService(minimal).load(ORDER_ID);

    expect(r.order?.orderSuppliers).toEqual([]);
    expect(r.order?.supplierCreditNotes).toEqual([]);
    expect(r.order?.totalSupplierCredits).toBeUndefined();
    expect(r.order?.expectedSupplierCredits).toBeUndefined();
    expect(r.order?.netProfitAfterCredits).toBeUndefined();
    expect(r.orderSuppliers).toEqual([]);
  });
});