import { describe, test, expect } from 'bun:test';
import { renderBookingEmail, formatDates, formatQty } from './booking-email.service';

const baseOrder = {
  id: 'order-1',
  tenantId: 'tenant-1',
  orderNumber: 'ORD-001',
  vesselId: 'vessel-1',
  vessel: { name: 'M/V Ocean7 Ruby' },
  place: { name: 'Panama' },
  eta: '2026-07-03T00:00:00.000Z',
  etd: '2026-07-07T00:00:00.000Z',
  agent: { name: 'Altarmar' },
  supplier: { name: 'Trafigura' },
  deliveryMethod: 'Via Barge',
  items: [
    { productType: 'VLSFO 0.5%', quantity: '400', quantityMin: '350', quantityMax: '400', unit: 'MT' },
    { productType: 'LSMGO DMA 0.1%', quantity: '75', quantityMin: '60', quantityMax: '75', unit: 'mts' },
  ],
} as any;

describe('booking-email.service (pure rendering)', () => {
  test('renderBookingEmail reproduces the sample-style body', () => {
    const { subject, body } = renderBookingEmail(baseOrder, 'Sergiy');

    expect(subject).toContain('M/V Ocean7 Ruby');
    expect(subject).toContain('Panama');

    expect(body).toContain('Dear Captain Sergiy');
    expect(body).toContain('M/V Ocean7 Ruby');
    expect(body).toContain('Place: Panama');
    expect(body).toContain('Agent: Altarmar');
    expect(body).toContain('Physical: Trafigura');
    expect(body).toContain('Method: Via Barge');
    expect(body).toContain('Product: VLSFO 0.5%');
    expect(body).toContain('Qnty: 350 - 400 MT');
    expect(body).toContain('Product: LSMGO DMA 0.1%');
    expect(body).toContain('Qnty: 60 - 75 mts');
    expect(body).toContain('do the needful');
  });

  test('captain falls back to "Captain" when name empty', () => {
    const { body } = renderBookingEmail(baseOrder, '');
    // Empty captainName → "Dear Captain " (the template hardcodes 'Captain {captainName}')
    expect(body).toContain('Dear Captain');
  });

  test('formatDates: range, single, none', () => {
    expect(formatDates('2026-07-03T00:00:00.000Z', '2026-07-07T00:00:00.000Z')).toMatch(/July/);
    expect(formatDates('2026-07-03T00:00:00.000Z', null)).toMatch(/July/);
    expect(formatDates(null, null)).toBe('TBD');
  });

  test('formatQty: min-max range and single', () => {
    expect(formatQty({ productType: 'VLSFO', quantity: '400', quantityMin: '350', quantityMax: '400', unit: 'MT' })).toBe('350 - 400 MT');
    expect(formatQty({ productType: 'VLSFO', quantity: '400', unit: 'MT' })).toBe('400 MT');
  });
});