import { describe, expect, it } from 'bun:test';
import { parsePlattsText } from '../src/modules/platts/platts-parser.service';

describe('platts parser service', () => {
  it('joins split trade lines and ignores status lines', () => {
    const parsed = parsePlattsText(
      [
        'Platts European Marketscan March 18, 2026',
        'PLATTS EU MIDDIST BARGE MOC TRADES ON CLOSE',
        'PHILLIPS 66 SELLS TO TRAFIGURA* AT $1.39 FOR',
        '100KB',
        'NO BIDS REPORTED',
      ].join('\n'),
      'platts-20260318.pdf',
    );

    expect(parsed.publicationDate).toBe('2026-03-18');
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]?.entries[0]).toMatchObject({
      company: 'PHILLIPS 66',
      counterparty: 'TRAFIGURA',
      action: 'SELLS',
      price: '$1.39',
      quantity: '100KB',
    });
    expect(parsed.sections[0]?.entries[1]).toEqual({ rawText: 'NO BIDS REPORTED' });
  });

  it('extracts structured trade entries from embedded MOC headers', () => {
    const parsed = parsePlattsText(
      [
        'Platts European Marketscan March 18, 2026',
        'Jet barge commentary PLATTS EU MIDDIST BARGE MOC TRADES ON CLOSE',
        'PHILLIPS 66 SELLS TO TOTAL* AT $1.40 FOR 100KB',
        'NO OFFERS REPORTED',
      ].join('\n'),
      'platts-20260318.pdf',
    );

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]?.type).toBe('TRADES');
    expect(parsed.sections[0]?.entries[0]).toMatchObject({
      company: 'PHILLIPS 66',
      counterparty: 'TOTAL',
      action: 'SELLS',
      price: '$1.40',
      quantity: '100KB',
    });
    expect(parsed.sections[0]?.entries[1]).toEqual({ rawText: 'NO OFFERS REPORTED' });
  });
});