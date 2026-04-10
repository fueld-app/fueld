import {
  isMobilePdfPreviewUserAgent,
  resolvePdfWorkerUrl,
} from './pdf-preview-modal.utils';

describe('pdf-preview-modal.utils', () => {
  it('detects Android and iOS user agents for mobile PDF preview handling', () => {
    expect(
      isMobilePdfPreviewUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/123.0.0.0 Mobile Safari/537.36'),
    ).toBe(true);
    expect(
      isMobilePdfPreviewUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'),
    ).toBe(true);
    expect(
      isMobilePdfPreviewUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36'),
    ).toBe(false);
  });

  it('resolves the PDF worker relative to the application base URL', () => {
    expect(resolvePdfWorkerUrl('https://app.example.com/')).toBe(
      'https://app.example.com/pdf.worker.min.mjs',
    );
    expect(resolvePdfWorkerUrl('https://app.example.com/fueld/')).toBe(
      'https://app.example.com/fueld/pdf.worker.min.mjs',
    );
  });
});