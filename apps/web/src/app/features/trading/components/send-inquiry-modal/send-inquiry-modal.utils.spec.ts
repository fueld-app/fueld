import {
  buildInquiryDeliveryWindowLabel,
  formatInquiryStoredDateLabel,
  syncInquiryMetadataTable,
} from './send-inquiry-modal.utils';

describe('send-inquiry-modal.utils', () => {
  it('formats stored inquiry dates by the UTC calendar day', () => {
    expect(formatInquiryStoredDateLabel('2026-04-11T12:00:00.000Z')).toBe('11 Apr 2026');
  });

  it('builds a delivery window when either or both inquiry dates exist', () => {
    expect(buildInquiryDeliveryWindowLabel('2026-04-15T12:00:00.000Z', '2026-04-16T12:00:00.000Z')).toBe('15 Apr 2026 to 16 Apr 2026');
    expect(buildInquiryDeliveryWindowLabel('2026-04-15T12:00:00.000Z', null)).toBe('15 Apr 2026');
  });

  it('inserts delivery rows and removes reply rows when the deadline is cleared', () => {
    const html = `
      <table>
        <tr><td>Vessel:</td><td>MV TEST</td></tr>
        <tr><td>Place:</td><td>Singapore</td></tr>
        <tr><td>Reply within:</td><td>2 days</td></tr>
        <tr><td>Account:</td><td>Fueld</td></tr>
      </table>
    `;

    const synced = syncInquiryMetadataTable(html, {
      deliveryLabel: '15 Apr 2026',
      responseDeadlineLabel: null,
    });

    expect(synced).toContain('Delivery:');
    expect(synced).toContain('15 Apr 2026');
    expect(synced).not.toContain('Reply within:');
  });

  it('inserts delivery rows for templates that render label and value in a single table cell', () => {
    const html = `
      <table>
        <tr><td>Vessel: Hesperides (navy)</td></tr>
        <tr><td>Place: Recife</td></tr>
        <tr><td>Reply within: 6 hours</td></tr>
        <tr><td>Account: Riviera Marine S.A.M.</td></tr>
      </table>
    `;

    const synced = syncInquiryMetadataTable(html, {
      deliveryLabel: '15 Apr 2026',
      responseDeadlineLabel: '6 hours',
    });

    expect(synced).toContain('Delivery:');
    expect(synced).toContain('15 Apr 2026');
  });
});