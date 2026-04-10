const MOBILE_PDF_USER_AGENT_PATTERN = /android|iphone|ipad/i;

export function isMobilePdfPreviewUserAgent(userAgent: string): boolean {
  return MOBILE_PDF_USER_AGENT_PATTERN.test(userAgent);
}

export function resolvePdfWorkerUrl(baseUri: string): string {
  return new URL('pdf.worker.min.mjs', baseUri).toString();
}