import {
  extractActivityChangeRows,
  formatActivityMetadataValue,
  getActivityMetadataAction,
  isFinancialField,
} from './activity-timeline.formatters';

describe('activity timeline metadata formatting', () => {
  it('renders nested objects without object coercion', () => {
    expect(formatActivityMetadataValue({
      tradeFlow: 'Spot',
      regions: ['EU', 'US'],
    })).toBe('Trade Flow: Spot, Regions: EU; US');
  });

  it('renders arrays of objects as readable summaries', () => {
    expect(formatActivityMetadataValue([
      { name: 'Diesel', status: 'active' },
      { name: 'VLSFO', status: 'inactive' },
    ])).toBe('Name: Diesel, Status: active; Name: VLSFO, Status: inactive');
  });

  it('extracts structured change rows for compact diffs', () => {
    expect(extractActivityChangeRows({
      action: 'update_order_fields',
      changes: [
        { field: 'eta', from: null, to: '2030-05-02T12:00:00.000Z' },
        { field: 'customerCreditDays', from: null, to: 21 },
      ],
    }, {
      eta: 'ETA',
      customerCreditDays: 'Customer credit days',
    })).toEqual([
      { field: 'ETA', from: 'Empty', to: '2030-05-02T12:00:00.000Z' },
      { field: 'Customer credit days', from: 'Empty', to: '21' },
    ]);
  });

  it('reads the metadata action separately from display entries', () => {
    expect(getActivityMetadataAction({ action: 'save_items', itemCount: 3 })).toBe('save_items');
    expect(getActivityMetadataAction({ itemCount: 3 })).toBeNull();
  });

  it('flags financial fields', () => {
    expect(isFinancialField('creditLimit')).toBe(true);
    expect(isFinancialField('salesPrice')).toBe(true);
    expect(isFinancialField('customerCreditDays')).toBe(true);
    expect(isFinancialField('totalNetProfit')).toBe(true);
    expect(isFinancialField('taxRate')).toBe(true);
    expect(isFinancialField('eta')).toBe(false);
    expect(isFinancialField('status')).toBe(false);
  });

  it('redacts financial change rows for LIGHT users', () => {
    const rows = extractActivityChangeRows({
      action: 'update_order_fields',
      changes: [
        { field: 'eta', from: null, to: '2030-05-02T12:00:00.000Z' },
        { field: 'creditLimit', from: '1000', to: '5000' },
        { field: 'salesPrice', from: '500', to: '520' },
      ],
    }, {}, true);

    expect(rows?.map((r) => r.field)).toEqual(['Eta']);
  });
});