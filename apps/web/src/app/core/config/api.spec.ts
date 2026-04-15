import { toAbsoluteUrl } from './api';

describe('api config', () => {
  it('resolves relative API URLs against the current origin', () => {
    expect(toAbsoluteUrl('/api/verify/token/abc123', 'https://fueld.app')).toBe(
      'https://fueld.app/api/verify/token/abc123',
    );
  });

  it('preserves absolute API URLs', () => {
    expect(toAbsoluteUrl('http://localhost:3000/verify/token/abc123', 'https://fueld.app')).toBe(
      'http://localhost:3000/verify/token/abc123',
    );
  });
});