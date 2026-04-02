import { describe, expect, it } from 'bun:test';
import { formatActivityMetadataValue } from './activity-timeline.formatters';

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
});