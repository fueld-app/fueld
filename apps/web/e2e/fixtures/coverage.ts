import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';

// JSCoverageEntry was removed as a named export in @playwright/test 1.61;
// derive the entry type from stopJSCoverage()'s return signature instead.
type JSCoverageEntry = Awaited<ReturnType<Page['coverage']['stopJSCoverage']>>[number];

type CoveragePayload = {
  js: JSCoverageEntry[];
  css: Awaited<ReturnType<Page['coverage']['stopCSSCoverage']>>;
};

// Re-export Page so specs that import { type Page } from '../fixtures/coverage'
// continue to resolve (coverage.ts is the shared test fixture entry point).
// (declared once at the bottom alongside `export { expect }`)

const enabled = process.env['PW_COVERAGE'] === '1';
const outputDir = process.env['PW_COVERAGE_DIR'] ?? 'coverage/e2e/raw';

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function writeCoverageFile(testFile: string, projectName: string, testTitle: string, payload: CoveragePayload): void {
  mkdirSync(outputDir, { recursive: true });
  const fileName = [
    sanitizeSegment(projectName),
    sanitizeSegment(testFile),
    sanitizeSegment(testTitle).slice(0, 100),
  ].filter(Boolean).join('__');
  const absolutePath = join(outputDir, `${fileName || 'coverage'}.json`);
  writeFileSync(absolutePath, JSON.stringify(payload), 'utf8');
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    if (!enabled) {
      await use(page);
      return;
    }

    await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: false });
    await page.coverage.startCSSCoverage({ resetOnNavigation: false });

    await use(page);

    const js = await page.coverage.stopJSCoverage();
    const css = await page.coverage.stopCSSCoverage();

    writeCoverageFile(testInfo.file, testInfo.project.name, testInfo.title, { js, css });
  },
});

export { expect };
export type { Page };
