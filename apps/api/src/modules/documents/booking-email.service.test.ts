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
  test('renderBookingEmail produces a structured HTML body', () => {
    const { subject, body } = renderBookingEmail(baseOrder, 'Sergiy', undefined, 'Frederik Nissen');

    expect(subject).toContain('M/V Ocean7 Ruby');
    expect(subject).toContain('Panama');

    // Greeting
    expect(body).toContain('Dear Captain of <strong>M/V Ocean7 Ruby</strong>');

    // Order details table rows
    expect(body).toContain('Place:</td>');
    expect(body).toContain('Panama</td>');
    expect(body).toContain('Physical Supplier:</td>');
    expect(body).toContain('Trafigura</td>');
    expect(body).toContain('Delivery Method:</td>');
    expect(body).toContain('Via Barge</td>');

    // Products table
    expect(body).toContain('Product</th>');
    expect(body).toContain('Quantity</th>');
    expect(body).toContain('VLSFO 0.5%</td>');
    expect(body).toContain('350 - 400 MT</td>');
    expect(body).toContain('LSMGO DMA 0.1%</td>');
    expect(body).toContain('60 - 75 mts</td>');

    // Closing + signature
    expect(body).toContain('do the needful');
    expect(body).toContain('Best regards');
    expect(body).toContain('Frederik Nissen');
  });

  test('signature is omitted when no sender name provided', () => {
    const { body } = renderBookingEmail(baseOrder, 'Sergiy');
    expect(body).toContain('do the needful');
    expect(body).not.toContain('Best regards');
  });

  test('product descriptions and values are HTML-escaped', () => {
    const order = {
      ...baseOrder,
      vessel: { name: 'M/V Ocean<script>' },
      place: { name: 'Panama & "Zone"' },
      items: [{ productType: 'VLSFO <b>', quantity: '100', unit: 'MT', description: 'test & "desc"' }],
    } as any;
    const { subject, body } = renderBookingEmail(order, 'Sergiy');
    expect(body).toContain('VLSFO &lt;b&gt;');
    expect(body).toContain('test &amp; &quot;desc&quot;');
    expect(body).not.toContain('<b>');
    // Vessel name is escaped in the HTML body but plain in the subject
    expect(body).toContain('M/V Ocean&lt;script&gt;');
    expect(body).not.toContain('M/V Ocean<script>');
    expect(subject).toContain('M/V Ocean<script>');
    expect(subject).not.toContain('M/V Ocean&lt;script&gt;');
  });

  test('captain falls back to "Captain" when name empty', () => {
    const { body } = renderBookingEmail(baseOrder, '');
    // Template now uses 'Dear Captain of {vesselName}' — captain name is not in the body anymore
    expect(body).toContain('Dear Captain of <strong>M/V Ocean7 Ruby</strong>');
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