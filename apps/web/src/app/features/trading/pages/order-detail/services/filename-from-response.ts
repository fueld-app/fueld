import type { HttpResponse } from '@angular/common/http';

/**
 * The filename the server stamped on a download.
 *
 * Invoice PDFs are named after the invoice the API actually rendered. For a
 * split-terms order that number only exists server-side (the page has no invoice
 * number of its own), so reading it back is the only way the saved file carries
 * the right tranche. Returns null when the header is absent or unparseable, so
 * callers fall back to whatever they would have used.
 */
export function filenameFromResponse(res: HttpResponse<unknown>): string | null {
  const disposition = res.headers?.get('content-disposition');
  if (!disposition) return null;

  // RFC 5987 form first: filename*=UTF-8''...
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // fall through to the plain form
    }
  }

  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain?.[1]?.trim() || null;
}
