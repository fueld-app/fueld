import { describe, test, expect } from 'bun:test';
import { renderBookingEmail, formatDates, formatQty, buildBookingSignatureHtml, resolveSignatureUser, buildBookingProductLinesHtml, DEFAULT_BOOKING_FONT } from './booking-email.service';

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

  test('formatQty: fra-til — min-only renders stem range (min - quantity)', () => {
    // Moxie pattern: quantity = target, quantity_min = minimum stem
    expect(formatQty({ productType: 'LSMGO', quantity: '130', quantityMin: '100', unit: 'MT' })).toBe('100 - 130 MT');
    expect(formatQty({ productType: 'VLSFO', quantity: '220', quantityMin: '180', unit: 'MT' })).toBe('180 - 220 MT');
    // min == quantity → single value, no degenerate range
    expect(formatQty({ productType: 'VLSFO', quantity: '400', quantityMin: '400', unit: 'MT' })).toBe('400 MT');
  });

  test('legacy closing: plain Best regards + name when no signature data', () => {
    const { body } = renderBookingEmail(baseOrder, 'Sergiy', undefined, 'Frederik Nissen');
    expect(body).toContain('<p>Best regards,<br/>Frederik Nissen</p>');
    expect(body).not.toContain('Verdana');
  });

  test('signature: full contact block with logo when signature data provided', () => {
    const { body } = renderBookingEmail(baseOrder, 'Sergiy', undefined, {
      name: 'Daniel Kvist',
      email: 'daniel@moxiebrokerage.com',
      phone: '+45 30 497 777',
      skype: 'dkvist77',
    }, buildBookingSignatureHtml({
      name: 'Daniel Kvist',
      email: 'daniel@moxiebrokerage.com',
      phone: '+45 30 497 777',
      skype: 'dkvist77',
    }, { fromEmail: 'happier@moxiebrokerage.com', website: 'www.moxiebrokerage.com', logoUrl: 'https://moxie.fueld.app/moxie-logo.png' }));

    expect(body).toContain('Best regards,');
    expect(body).toContain('Daniel Kvist');
    expect(body).toContain('m: +45 30 497 777 ◦ s: dkvist77');
    expect(body).toContain('happier@moxiebrokerage.com');
    expect(body).toContain('www.moxiebrokerage.com');
    expect(body).toContain('src="https://moxie.fueld.app/moxie-logo.png"');
    expect(body).not.toContain('daniel@moxiebrokerage.com</a>'); // e: line uses the signature from-email override
  });

  test('signature: whatsapp line rendered when provided', () => {
    const { body } = renderBookingEmail(baseOrder, 'Sergiy', undefined, 'Frederik Nissen', buildBookingSignatureHtml({
      name: 'Frederik Nissen',
      phone: '+971 (0) 55 246 8292',
      whatsapp: '+45 60 48 26 16',
      email: 'happier@moxiebrokerage.com',
    }));

    expect(body).toContain('m: +971 (0) 55 246 8292');
    expect(body).toContain('whatsapp: +45 60 48 26 16');
    expect(body).toContain('happier@moxiebrokerage.com');
  });

  test('productLines: line-based product block with fra-til ranges', () => {
    const lines = buildBookingProductLinesHtml([
      { productType: 'VLSFO 0.5%', quantity: '400', quantityMin: '350', quantityMax: '400', unit: 'MT', description: 'ISO 8217 RMK380' },
      { productType: 'LSMGO', quantity: '130', quantityMin: '100', unit: 'MT' },
    ]);
    expect(lines).toContain('Product: VLSFO 0.5% - ISO 8217 RMK380');
    expect(lines).toContain('Qnty: 350 - 400 MT');
    expect(lines).toContain('Product: LSMGO<br/>Qnty: 100 - 130 MT');
  });

  test('resolveSignatureUser: prefers the order\'s responsible (salesRep) over the sender', () => {
    const order = {
      ...baseOrder,
      salesRep: { id: 'u1', name: 'Frederik Nissen', email: 'frederik@moxiebrokerage.com', phone: '+971 (0) 55 246 8292', skype: null, whatsapp: '+45 60 48 26 16' },
    } as any;
    const sig = resolveSignatureUser(order, { name: 'Daniel Kvist' });
    expect(sig?.name).toBe('Frederik Nissen');
    expect(sig?.phone).toBe('+971 (0) 55 246 8292');
  });

  test('resolveSignatureUser: merges sender contact fields when salesRep lacks them', () => {
    const order = {
      ...baseOrder,
      salesRep: { id: 'u1', name: 'Frederik Nissen', email: 'frederik@moxiebrokerage.com', phone: null, skype: null, whatsapp: null },
    } as any;
    const sig = resolveSignatureUser(order, { name: 'Daniel Kvist', phone: '+45 30 497 777', skype: 'dkvist77' });
    expect(sig?.name).toBe('Frederik Nissen');
    expect(sig?.phone).toBe('+45 30 497 777');
    expect(sig?.skype).toBe('dkvist77');
  });

  test('resolveSignatureUser: falls back to sender when no salesRep', () => {
    const sig = resolveSignatureUser(baseOrder as any, { name: 'Daniel Kvist' });
    expect(sig?.name).toBe('Daniel Kvist');
    const sig2 = resolveSignatureUser(baseOrder as any);
    expect(sig2).toBeUndefined();
  });

  test('fontFamily: tenant font flows into body + signature', () => {
    const sig = buildBookingSignatureHtml({ name: 'Daniel Kvist', phone: '+45' }, { fontFamily: "Aptos, 'Segoe UI', Arial, sans-serif" });
    expect(sig).toContain("font-family: Aptos, 'Segoe UI', Arial, sans-serif;");
    const { body } = renderBookingEmail(baseOrder, 'Sergiy', undefined, 'Frederik Nissen', undefined, "Aptos, 'Segoe UI', Arial, sans-serif");
    expect(body).toContain('font-family: Aptos,');
    // default font when not set
    const { body: body2 } = renderBookingEmail(baseOrder, 'Sergiy');
    expect(body2).toContain("font-family: 'Segoe UI', Arial, sans-serif");
  });

  test('signature values are HTML-escaped', () => {
    const { body } = renderBookingEmail(baseOrder, 'Sergiy', undefined, 'Evil <b>Boss</b>', buildBookingSignatureHtml({
      name: 'Evil <b>Boss</b>',
      phone: '<script>alert(1)</script>',
      skype: '&quot;x&quot;',
    }));
    expect(body).toContain('Evil &lt;b&gt;Boss&lt;/b&gt;');
    expect(body).toContain('m: &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(body).not.toContain('<script>');
  });
});